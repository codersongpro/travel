import { getTheme, WEIGHT_FACTOR, type ThemeId } from "@/lib/themes";
import type { RawGeminiPlan } from "@/lib/providers/gemini";
import type { CandidateSet } from "./candidates";
import { PACE_LIMITS, PACE_SLOTS, clusterByGeography, type RoutePoint } from "./routing";
import type { PlaceCandidate, TripRequest } from "./schema";
import { eachDate } from "./schema";
import { partySize } from "./budget";

/**
 * 규칙 기반 폴백 일정.
 *
 * Gemini 키가 없거나 호출이 실패해도 앱이 끝까지 돌아가야 하므로,
 * 같은 형태(RawGeminiPlan)를 규칙만으로 만들어 낸다.
 *
 * 동선이 무너지지 않게 하는 것이 핵심이라, 후보를 그냥 순서대로 꺼내지 않고
 * (1) 날짜별 권역을 클러스터로 나눈 뒤 (2) 그 권역 안에서 가까운 순으로 잇는다.
 * 이후 validate.ts를 똑같이 통과하므로 제약은 동일하게 재검증된다.
 */

/** 가중치를 반영해 테마 슬롯을 배분한다. "집중"일수록 자주 뽑힌다. */
function buildThemeRotation(req: TripRequest, totalSlots: number): ThemeId[] {
  const activity = req.themes.filter((t) => t.id !== "food");
  if (activity.length === 0) return [];

  const weights = activity.map((t) => WEIGHT_FACTOR[t.weight]);
  const sum = weights.reduce((a, b) => a + b, 0);

  // 가중치 비율대로 슬롯을 나누되 모든 테마가 최소 1번은 나오게 한다.
  const quota = activity.map((t, i) =>
    Math.max(1, Math.round((weights[i] / sum) * totalSlots)),
  );

  // 라운드로빈으로 펼쳐서 한 테마가 특정 날짜에 몰리지 않게 한다.
  const rotation: ThemeId[] = [];
  const remaining = [...quota];
  while (rotation.length < totalSlots) {
    let placed = false;
    activity.forEach((t, i) => {
      if (remaining[i] > 0 && rotation.length < totalSlots) {
        rotation.push(t.id);
        remaining[i]--;
        placed = true;
      }
    });
    // 할당량을 다 썼는데 슬롯이 남으면 비율대로 다시 채운다.
    if (!placed) {
      if (rotation.length >= totalSlots) break;
      quota.forEach((q, i) => (remaining[i] = q));
    }
  }

  return rotation;
}

export function buildFallbackPlan(req: TripRequest, candidates: CandidateSet): RawGeminiPlan {
  const dates = eachDate(req.startDate, req.endDate);
  const slotsPerDay = PACE_SLOTS[req.pace];
  const legLimit = PACE_LIMITS[req.pace].legMinutes;
  const people = partySize(req);
  const { matrix } = candidates;

  const rotation = buildThemeRotation(req, dates.length * slotsPerDay);
  const used = new Set<string>();

  // 후보 전체(활동 + 식당)를 날짜 수만큼 권역으로 나눈다.
  // 하루 일정은 원칙적으로 한 권역 안에서 구성해 도시를 가로지르지 않게 한다.
  // 식당도 같이 나눠야 그날 동선 근처에서 끼니를 해결할 수 있다.
  const pool = [...candidates.candidatesByTheme.values()].flat();
  const points: RoutePoint[] = dedupe([...pool, ...candidates.rankedRestaurants]).map((c) => ({
    id: c.placeId,
    lat: c.lat,
    lng: c.lng,
  }));
  const clusters = clusterByGeography(points, dates.length)
    // 후보가 많은 권역부터 배정해야 앞쪽 날짜가 알차진다.
    .sort((a, b) => b.points.length - a.points.length);

  /** 기준점에서 가장 가까운, 아직 안 쓴 해당 테마 후보. */
  const nearestActivity = (theme: ThemeId, fromId: string | null, allowed: Set<string> | null) => {
    const pool = (candidates.candidatesByTheme.get(theme) ?? []).filter(
      (c) => !used.has(c.placeId) && (!allowed || allowed.has(c.placeId)),
    );
    if (pool.length === 0) return null;
    if (!fromId) return pool[0];

    return pool.reduce((best, c) =>
      matrix.get(fromId, c.placeId).minutes < matrix.get(fromId, best.placeId).minutes ? c : best,
    );
  };

  /**
   * 날짜별 끼니를 미리 잡아 둔다.
   *
   * 활동을 먼저 채우고 남는 식당을 끼니에 쓰면, 뒷날짜는 멀거나 남지 않은
   * 식당만 받게 되어 점심이 통째로 빠지거나 두 시간 거리 식당이 붙는다.
   * 그래서 각 날짜의 권역에서 상위 2곳을 먼저 예약해 둔다.
   */
  const reserveMeals = (): Map<number, PlaceCandidate[]> => {
    const reserved = new Map<number, PlaceCandidate[]>();
    const taken = new Set<string>();

    // 1차: 각 날짜의 권역 안에서 가중 점수 상위 2곳
    dates.forEach((_, dayIndex) => {
      const zone = clusters[dayIndex]
        ? new Set(clusters[dayIndex].points.map((p) => p.id))
        : null;
      const picks = candidates.rankedRestaurants
        .filter((c) => !taken.has(c.placeId) && (!zone || zone.has(c.placeId)))
        .slice(0, 2);
      for (const p of picks) taken.add(p.placeId);
      reserved.set(dayIndex, picks);
    });

    // 2차: 권역에 식당이 부족했던 날짜를 전체 후보로 메운다
    dates.forEach((_, dayIndex) => {
      const picks = reserved.get(dayIndex) ?? [];
      while (picks.length < 2) {
        const next = candidates.rankedRestaurants.find((c) => !taken.has(c.placeId));
        if (!next) break;
        taken.add(next.placeId);
        picks.push(next);
      }
      reserved.set(dayIndex, picks);
    });

    return reserved;
  };

  const mealsByDay = reserveMeals();

  /** 그날 몫으로 잡아 둔 식당 중, 현재 위치에서 가장 가까운 곳을 꺼낸다. */
  const takeMeal = (dayIndex: number, fromId: string | null) => {
    const reserved = (mealsByDay.get(dayIndex) ?? []).filter((c) => !used.has(c.placeId));
    // 예약분이 떨어지면 전체 후보로 넓힌다 — 끼니를 거르는 것보다 낫다.
    const pool =
      reserved.length > 0
        ? reserved
        : candidates.rankedRestaurants.filter((c) => !used.has(c.placeId));

    if (pool.length === 0) return null;
    if (!fromId) return pool[0];

    // 제한 안에 드는 곳이 있으면 그중 평점 순, 없으면 가장 가까운 곳.
    return (
      pool.find((c) => matrix.get(fromId, c.placeId).minutes <= legLimit) ??
      pool.reduce((best, c) =>
        matrix.get(fromId, c.placeId).minutes < matrix.get(fromId, best.placeId).minutes ? c : best,
      )
    );
  };

  /** 지금까지 일정에 실제로 들어간 테마. */
  const placedThemes = new Set<ThemeId>();

  /** 요청한 테마를 뺀 나머지 선택 테마 (식사 제외). */
  const otherThemes = (exclude: ThemeId): ThemeId[] =>
    req.themes.map((t) => t.id).filter((id) => id !== exclude && id !== "food");

  const days = dates.map((date, dayIndex) => {
    const slots: RawGeminiPlan["days"][number]["slots"] = [];
    const zone = clusters[dayIndex]
      ? new Set(clusters[dayIndex].points.map((p) => p.id))
      : null;

    let cursor: string | null = null;
    let clock = 9 * 60;

    const pushActivity = (requested: ThemeId) => {
      // 1) 그날 권역 안에서 요청한 테마
      let theme = requested;
      let place = nearestActivity(theme, cursor, zone);

      // 2) 권역에 그 테마가 없다면, 도시를 가로지르는 대신
      //    권역 안에 있는 다른 선택 테마로 바꾼다. 동선이 테마 순서보다 중요하다.
      if (!place) {
        // 아직 한 번도 안 나온 테마를 먼저 시도한다 — 대체 때문에
        // 사용자가 고른 테마가 통째로 빠지면 안 된다.
        const alts = otherThemes(requested).sort(
          (a, b) => (placedThemes.has(a) ? 1 : 0) - (placedThemes.has(b) ? 1 : 0),
        );
        for (const alt of alts) {
          const found = nearestActivity(alt, cursor, zone);
          if (found) {
            theme = alt;
            place = found;
            break;
          }
        }
      }

      // 3) 권역 전체가 비었을 때만 범위를 넓힌다.
      //    요청 테마가 소진됐다면 다른 선택 테마로라도 하루를 채운다.
      if (!place) {
        place = nearestActivity(requested, cursor, null);
        if (!place) {
          for (const alt of otherThemes(requested)) {
            const found = nearestActivity(alt, cursor, null);
            if (found) {
              theme = alt;
              place = found;
              break;
            }
          }
        }
      }
      if (!place) return;

      used.add(place.placeId);
      placedThemes.add(theme);
      slots.push({
        placeId: place.placeId,
        kind: "activity",
        theme,
        startTime: toTime(clock),
        stayMinutes: 90,
        costKrw: (place.estimatedCostKrw ?? 0) * people,
        reason: `${getTheme(theme).label} 테마로 고른 곳입니다.`,
      });
      cursor = place.placeId;
      clock += 110;
    };

    const pushMeal = (kind: "lunch" | "dinner", earliest: number, cost: number) => {
      const meal = takeMeal(dayIndex, cursor);
      if (!meal) return;

      used.add(meal.placeId);
      clock = Math.max(clock, earliest);
      slots.push({
        placeId: meal.placeId,
        kind,
        theme: "food",
        startTime: toTime(clock),
        stayMinutes: kind === "lunch" ? 60 : 75,
        costKrw: (meal.estimatedCostKrw ?? cost) * people,
        reason: mealReason(meal.rating, meal.userRatingCount),
      });
      cursor = meal.placeId;
      clock += kind === "lunch" ? 80 : 95;
    };

    // 오전 활동 -> 점심 -> 오후 활동 -> 저녁. 테마는 이 안에서 섞인다.
    const morningCount = Math.ceil(slotsPerDay / 2);
    const dayThemes = rotation.slice(dayIndex * slotsPerDay, (dayIndex + 1) * slotsPerDay);

    dayThemes.slice(0, morningCount).forEach(pushActivity);
    pushMeal("lunch", 12 * 60, 18000);
    dayThemes.slice(morningCount).forEach(pushActivity);
    pushMeal("dinner", 18 * 60, 22000);

    return {
      date,
      dayNumber: dayIndex + 1,
      title: dayTitle(dayThemes),
      lodgingId: nearestHotel(candidates, cursor)?.hotelId,
      slots,
    };
  });

  ensureThemeCoverage(days, req, candidates, used, placedThemes, people);

  return {
    summary: `${candidates.destinationName} ${dates.length}일 일정입니다. 선택하신 ${req.themes
      .map((t) => getTheme(t.id).label)
      .join(", ")} 테마를 하루 동선 안에서 번갈아 배치했습니다.`,
    highlights: req.themes.map((t) => {
      const def = getTheme(t.id);
      return {
        theme: t.id,
        title: HIGHLIGHT_TITLE[t.id] ?? `${def.label} 포인트`,
        body: `${def.label} 테마로 ${def.blurb}.`,
      };
    }),
    days,
  };
}

/**
 * 한 번도 등장하지 않은 선택 테마를 강제로 배치한다.
 *
 * 권역·예산·거리 보정이 겹치면 고른 테마가 통째로 빠질 수 있는데,
 * 사용자가 명시적으로 고른 것이므로 최소 한 번은 나와야 한다.
 * 그 테마의 후보와 가장 가까운 일정 옆에 끼워 넣어 동선 손상을 최소화한다.
 */
function ensureThemeCoverage(
  days: RawGeminiPlan["days"],
  req: TripRequest,
  candidates: CandidateSet,
  used: Set<string>,
  placedThemes: Set<ThemeId>,
  people: number,
): void {
  const { matrix } = candidates;
  const missing = req.themes
    .map((t) => t.id)
    .filter((id) => id !== "food" && !placedThemes.has(id));

  for (const theme of missing) {
    const pool = (candidates.candidatesByTheme.get(theme) ?? []).filter(
      (c) => !used.has(c.placeId),
    );
    if (pool.length === 0) continue;

    // 기존 활동 중 이 테마 후보와 가장 가까운 자리를 찾는다.
    interface Spot {
      dayIdx: number;
      slotIdx: number;
      place: PlaceCandidate;
      minutes: number;
    }
    let best: Spot | null = null;

    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      const daySlots = days[dayIdx].slots;
      for (let slotIdx = 0; slotIdx < daySlots.length; slotIdx++) {
        if (daySlots[slotIdx].kind !== "activity") continue;
        for (const place of pool) {
          const minutes = matrix.get(daySlots[slotIdx].placeId, place.placeId).minutes;
          if (best === null || minutes < best.minutes) {
            best = { dayIdx, slotIdx, place, minutes };
          }
        }
      }
    }

    if (best === null) continue;
    const { dayIdx, slotIdx, place } = best;
    const anchor = days[dayIdx].slots[slotIdx];

    used.add(place.placeId);
    placedThemes.add(theme);
    days[dayIdx].slots.splice(slotIdx + 1, 0, {
      placeId: place.placeId,
      kind: "activity",
      theme,
      startTime: anchor.startTime,
      stayMinutes: 90,
      costKrw: (place.estimatedCostKrw ?? 0) * people,
      reason: `${getTheme(theme).label} 테마도 빠지지 않도록 동선상 가장 가까운 곳에 넣었습니다.`,
    });
  }
}

/** 그날 다루는 테마로 제목을 만든다. */
function dayTitle(themes: readonly ThemeId[]): string {
  const unique = [...new Set(themes)];
  if (unique.length === 0) return "자유 일정";
  return unique.map((t) => getTheme(t).label).join(" · ");
}

/** 그날 마지막 일정에서 가장 가까운 숙소. */
function nearestHotel(candidates: CandidateSet, fromId: string | null) {
  const { hotels, matrix } = candidates;
  if (hotels.length === 0) return null;
  if (!fromId) return hotels[0];

  return hotels.reduce((best, h) =>
    matrix.get(fromId, h.hotelId).minutes < matrix.get(fromId, best.hotelId).minutes ? h : best,
  );
}

function dedupe(list: readonly PlaceCandidate[]): PlaceCandidate[] {
  const seen = new Map<string, PlaceCandidate>();
  for (const c of list) if (!seen.has(c.placeId)) seen.set(c.placeId, c);
  return [...seen.values()];
}

function toTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function mealReason(rating?: number, count?: number): string {
  if (rating === undefined) return "동선상 들르기 좋은 식당입니다.";
  return `구글 지도 평점 ${rating.toFixed(1)}점, 리뷰 ${(count ?? 0).toLocaleString("ko-KR")}개로 검증된 곳입니다.`;
}

const HIGHLIGHT_TITLE: Partial<Record<ThemeId, string>> = {
  education: "이번 여행에서 배우게 될 것",
  food: "꼭 먹어봐야 할 것",
  history: "이 도시가 지나온 시간",
  nature: "쉬어가는 자리",
  culture: "만나게 될 작품과 무대",
  activity: "몸으로 즐길 거리",
  shopping: "무엇을 사올까",
  nightlife: "밤에 더 좋은 곳",
  wellness: "회복하는 시간",
  photo: "남길 장면",
  family: "아이와 함께라면",
  local: "현지인처럼 보내기",
  religion: "고요한 자리",
  sports: "움직이는 즐거움",
};
