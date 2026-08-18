import type { RawGeminiPlan } from "@/lib/providers/gemini";
import { isThemeId, type ThemeId } from "@/lib/themes";
import type { CandidateSet } from "./candidates";
import { PACE_LIMITS, orderByNearestNeighbor, totalTravelMinutes } from "./routing";
import type { Day, Extras, PlaceCandidate, Slot, SlotKind, TripRequest } from "./schema";
import { eachDate } from "./schema";

/**
 * Gemini 응답 검증 및 교정.
 *
 * 모델 응답을 그대로 믿지 않는다. 다음을 서버에서 강제한다.
 * - placeId가 실제 후보에 존재하는가 (환각 제거)
 * - 이동시간 제약을 지키는가 (초과 시 순서 재배열, 그래도 안 되면 항목 제거)
 * - 선택한 테마만 등장하는가
 * - 식당이 중복되지 않는가
 */

export interface ValidationReport {
  /** 후보에 없어서 제거된 placeId */
  hallucinated: string[];
  /** 이동시간 초과로 제거된 항목 */
  droppedForDistance: string[];
  /** 중복이라 제거된 식당 */
  duplicateMeals: string[];
  /** 일정에 한 번도 등장하지 않은 테마 */
  missingThemes: ThemeId[];
  /** 순서를 다시 잡은 날 */
  reorderedDays: number[];
}

export function emptyReport(): ValidationReport {
  return {
    hallucinated: [],
    droppedForDistance: [],
    duplicateMeals: [],
    missingThemes: [],
    reorderedDays: [],
  };
}

const MEAL_KINDS: readonly SlotKind[] = ["breakfast", "lunch", "dinner"];

/** 하루에 최소한 이만큼의 활동은 남긴다. 식사만 있는 날은 일정이 아니다. */
const MIN_ACTIVITIES_PER_DAY = 1;

function isMeal(kind: SlotKind): boolean {
  return MEAL_KINDS.includes(kind);
}

function normalizeKind(raw: string): SlotKind {
  const k = raw.toLowerCase();
  if (k === "breakfast" || k === "lunch" || k === "dinner" || k === "lodging") return k;
  return "activity";
}

/** 확장 정보 중 문자열/문자열배열만 통과시킨다. 모델이 이상한 타입을 넣어도 안전하게. */
function sanitizeExtras(raw: unknown): Extras | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    } else if (Array.isArray(value)) {
      const items = value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
      if (items.length > 0) out[key] = items;
    }
  }

  return Object.keys(out).length > 0 ? (out as Extras) : undefined;
}

/**
 * 원시 응답을 검증된 Day[]로 바꾼다.
 * 어떤 항목을 왜 걷어냈는지 report에 남겨 디버깅과 UI 안내에 쓴다.
 */
export function validatePlan(
  raw: RawGeminiPlan,
  req: TripRequest,
  candidates: CandidateSet,
  report: ValidationReport = emptyReport(),
): { days: Day[]; report: ValidationReport } {
  const selectedThemes = new Set<ThemeId>(req.themes.map((t) => t.id));
  const limits = PACE_LIMITS[req.pace];
  const expectedDates = eachDate(req.startDate, req.endDate);
  const usedMeals = new Set<string>();
  const seenThemes = new Set<ThemeId>();
  /**
   * 여행 전체에서 이미 쓴 장소 — 교체 후보를 고를 때 중복을 막는다.
   *
   * 아직 처리하지 않은 뒷날짜의 장소까지 미리 넣어 둔다.
   * 그러지 않으면 1일차 교체가 3일차에 쓸 식당을 가져가 버리고,
   * 3일차는 중복으로 제거되어 끼니가 통째로 사라진다.
   */
  const usedPlaces = new Set<string>(
    (raw.days ?? []).flatMap((d) => (d.slots ?? []).map((s) => s.placeId)),
  );

  /** 테마별 잔여 개수 — 거리 때문에 마지막 하나까지 지우지 않도록 센다. */
  const themeBudget = new Map<ThemeId, number>();
  for (const rawDay of raw.days ?? []) {
    for (const rawSlot of rawDay.slots ?? []) {
      if (!isThemeId(rawSlot.theme)) continue;
      themeBudget.set(rawSlot.theme, (themeBudget.get(rawSlot.theme) ?? 0) + 1);
    }
  }

  const days: Day[] = [];

  expectedDates.forEach((date, index) => {
    // 모델이 날짜를 빠뜨리거나 순서를 바꿨을 수 있으므로 날짜로 맞춰 찾는다.
    const rawDay =
      raw.days?.find((d) => d.date === date) ?? raw.days?.[index] ?? { slots: [] as never[] };

    const slots: Slot[] = [];

    for (const rawSlot of rawDay.slots ?? []) {
      const candidate = candidates.byId.get(rawSlot.placeId);
      if (!candidate) {
        // 후보에 없는 id = 모델이 지어낸 장소. 버린다.
        report.hallucinated.push(rawSlot.placeId);
        continue;
      }

      const kind = normalizeKind(rawSlot.kind);

      // 식당 중복 방지
      if (isMeal(kind)) {
        if (usedMeals.has(rawSlot.placeId)) {
          report.duplicateMeals.push(rawSlot.placeId);
          continue;
        }
        usedMeals.add(rawSlot.placeId);
      }

      // 고르지 않은 테마의 장소는 넣지 않는다. 식사는 예외(항상 필요).
      const theme: ThemeId =
        isThemeId(rawSlot.theme) && selectedThemes.has(rawSlot.theme)
          ? rawSlot.theme
          : candidate.theme;
      if (!isMeal(kind) && !selectedThemes.has(theme)) continue;

      slots.push({
        placeId: candidate.placeId,
        name: candidate.name,
        kind,
        theme,
        startTime: /^\d{2}:\d{2}$/.test(rawSlot.startTime) ? rawSlot.startTime : "10:00",
        stayMinutes: clamp(rawSlot.stayMinutes ?? 90, 15, 600),
        costKrw: Math.max(0, Math.round(rawSlot.costKrw ?? 0)),
        reason: rawSlot.reason?.trim() || "추천 장소입니다.",
        lat: candidate.lat,
        lng: candidate.lng,
        rating: candidate.rating,
        userRatingCount: candidate.userRatingCount,
        photoName: candidate.photoName,
        extras: sanitizeExtras(rawSlot.extras),
      });
    }

    const fixed = enforceTravelLimits(
      slots,
      candidates,
      limits,
      index + 1,
      report,
      usedPlaces,
      themeBudget,
    );

    // 교체·제거 이후에 남은 것만 "실제로 등장한 테마"로 친다.
    for (const slot of fixed.slots) seenThemes.add(slot.theme);

    days.push({
      date,
      dayNumber: index + 1,
      title: rawDay.title?.trim() || `${index + 1}일차`,
      slots: fixed.slots,
      lodging: resolveLodging(rawDay.lodgingId, candidates, index, expectedDates.length),
      totalTravelMinutes: fixed.totalMinutes,
    });
  });

  report.missingThemes = [...selectedThemes].filter((t) => !seenThemes.has(t));
  return { days, report };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

function resolveLodging(
  lodgingId: string | undefined,
  candidates: CandidateSet,
  dayIndex: number,
  totalDays: number,
) {
  // 마지막 날은 숙박하지 않는다.
  if (dayIndex >= totalDays - 1) return null;
  const byId = candidates.hotels.find((h) => h.hotelId === lodgingId);
  return byId ?? candidates.hotels[0] ?? null;
}

/**
 * 이동시간 제약을 실제로 강제한다.
 *
 * 1) 최근접 이웃으로 순서를 정리한다.
 * 2) 구간 상한(legMinutes)을 넘는 항목은 같은 테마의 더 가까운 후보로 교체한다.
 *    교체할 후보가 없을 때만 제거하고, 식사는 끝까지 살리려 한다.
 * 3) 하루 총량(dayMinutes)이 남으면 가장 먼 구간의 활동부터 뺀다.
 * 4) 확정된 순서로 travelFromPrev를 채운다.
 */
function enforceTravelLimits(
  slots: readonly Slot[],
  candidates: CandidateSet,
  limits: { legMinutes: number; dayMinutes: number },
  dayNumber: number,
  report: ValidationReport,
  usedPlaces: Set<string>,
  /** 일정 전체에서 각 테마가 몇 번 등장하는지 — 마지막 하나는 지우지 않는다. */
  themeBudget?: Map<ThemeId, number>,
): { slots: Slot[]; totalMinutes: number } {
  if (slots.length <= 1) {
    return { slots: [...slots], totalMinutes: 0 };
  }

  const { matrix } = candidates;
  // 1) 하루의 의미 있는 순서(오전 → 점심 → 오후 → 저녁)는 지키면서
  //    활동 구간 안에서만 동선을 최적화한다.
  let working = orderWithinBands(slots, matrix, dayNumber, report);

  // 2) 구간 상한 강제 — 교체를 먼저 시도하고, 안 되면 제거한다.
  for (let i = 1; i < working.length; ) {
    const leg = matrix.get(working[i - 1].placeId, working[i].placeId);
    if (leg.minutes <= limits.legMinutes) {
      i++;
      continue;
    }

    const replacement = findNearerAlternative(
      working[i],
      working[i - 1].placeId,
      working[i + 1]?.placeId,
      candidates,
      limits.legMinutes,
      usedPlaces,
    );

    if (replacement) {
      usedPlaces.delete(working[i].placeId);
      usedPlaces.add(replacement.placeId);
      working[i] = replacement;
      i++;
      continue;
    }

    // 식사는 하루 구성상 반드시 필요하다. 제한을 만족하는 대안이 없으면
    // 끼니를 없애는 대신 가장 가까운 식당으로 바꿔서라도 남긴다.
    if (isMeal(working[i].kind)) {
      const nearest = findNearestAlternative(
        working[i],
        working[i - 1].placeId,
        candidates,
        usedPlaces,
        new Set(working.map((s) => s.placeId)),
      );
      if (nearest) {
        usedPlaces.delete(working[i].placeId);
        usedPlaces.add(nearest.placeId);
        working[i] = nearest;
      }
      i++;
      continue;
    }

    // 활동을 전부 걷어내면 식사만 남은 빈 하루가 된다.
    // 그럴 바에는 조금 먼 곳이라도 남기고, UI가 이동시간을 정직하게 보여 준다.
    const activityCount = working.filter((s) => !isMeal(s.kind)).length;
    if (activityCount <= MIN_ACTIVITIES_PER_DAY) {
      i++;
      continue;
    }

    // 이게 그 테마의 마지막 한 개라면, 거리를 감수하고 남긴다.
    // 사용자가 고른 테마가 통째로 사라지는 것이 더 나쁘다.
    const remainingOfTheme = themeBudget?.get(working[i].theme) ?? Infinity;
    if (remainingOfTheme <= 1) {
      i++;
      continue;
    }
    themeBudget?.set(working[i].theme, remainingOfTheme - 1);

    report.droppedForDistance.push(working[i].placeId);
    usedPlaces.delete(working[i].placeId);
    working.splice(i, 1);
  }

  // 3) 하루 총량이 여전히 초과면 가장 먼 구간의 활동부터 뺀다.
  let total = totalTravelMinutes(
    matrix,
    working.map((s) => s.placeId),
  );

  while (
    total > limits.dayMinutes &&
    working.filter((s) => !isMeal(s.kind)).length > MIN_ACTIVITIES_PER_DAY
  ) {
    let worstIdx = -1;
    let worstMinutes = -1;

    for (let i = 1; i < working.length; i++) {
      // 끼니는 절대 빼지 않는다. 하루 이동시간을 줄이자고 저녁을 없앨 수는 없다.
      // (루프 조건은 활동 수만 세므로, 여기서 걸러 두지 않으면 식사가 희생된다.)
      if (isMeal(working[i].kind)) continue;

      const minutes = matrix.get(working[i - 1].placeId, working[i].placeId).minutes;
      if (minutes > worstMinutes) {
        worstMinutes = minutes;
        worstIdx = i;
      }
    }

    if (worstIdx === -1) break;
    report.droppedForDistance.push(working[worstIdx].placeId);
    usedPlaces.delete(working[worstIdx].placeId);
    working.splice(worstIdx, 1);
    total = totalTravelMinutes(
      matrix,
      working.map((s) => s.placeId),
    );
  }

  // 순서와 구성이 바뀌었으므로 시작 시간을 다시 부여한다.
  working = reassignTimes(working);

  // 4) 확정된 순서로 이동 정보 부여
  const withTravel = working.map((slot, i) => {
    if (i === 0) return { ...slot, travelFromPrev: undefined };
    const leg = matrix.get(working[i - 1].placeId, slot.placeId);
    return {
      ...slot,
      travelFromPrev: {
        minutes: leg.minutes,
        meters: leg.meters,
        mode: matrix.mode,
        isEstimate: leg.isEstimate,
      },
    };
  });

  return { slots: withTravel, totalMinutes: total };
}

/**
 * 하루를 시간대 구간으로 나누고, 각 구간 "안에서만" 동선을 최적화한다.
 *
 * 하루 전체를 최근접 이웃으로 재배열하면 이동시간은 줄지만
 * 저녁이 점심보다 먼저 오거나 밤 8시에 박물관이 배치되는 일이 생긴다.
 * 끼니 시각과 활동의 앞뒤 관계는 고정하고, 활동끼리의 순서만 바꾼다.
 */
function orderWithinBands(
  slots: readonly Slot[],
  matrix: CandidateSet["matrix"],
  dayNumber: number,
  report: ValidationReport,
): Slot[] {
  const lunchIdx = slots.findIndex((s) => s.kind === "lunch");
  const dinnerIdx = slots.findIndex((s) => s.kind === "dinner");

  /** 0=오전 활동, 1=점심, 2=오후 활동, 3=저녁, 4=저녁 이후 활동 */
  const bandOf = (slot: Slot, i: number): number => {
    if (slot.kind === "lunch") return 1;
    if (slot.kind === "dinner") return 3;
    if (slot.kind === "breakfast") return 0;

    // 저녁 이후 시간대가 어울리는 테마만 밤에 남기고, 나머지는 오후로 당긴다.
    if (dinnerIdx !== -1 && i > dinnerIdx) {
      return slot.theme === "nightlife" || slot.theme === "photo" ? 4 : 2;
    }
    if (lunchIdx !== -1 && i > lunchIdx) return 2;
    return 0;
  };

  const bands = new Map<number, Slot[]>();
  slots.forEach((slot, i) => {
    const band = bandOf(slot, i);
    bands.set(band, [...(bands.get(band) ?? []), slot]);
  });

  const ordered: Slot[] = [];
  let reordered = false;

  for (const band of [0, 1, 2, 3, 4]) {
    const group = bands.get(band);
    if (!group || group.length === 0) continue;

    // 활동 구간만 최적화한다 (끼니는 어차피 1개씩이다).
    if (group.length > 2) {
      const ids = group.map((s) => s.placeId);
      // 직전 구간의 마지막 장소에서 이어지도록 시작점을 잡는다.
      const from = ordered.at(-1)?.placeId;
      const start = from
        ? ids.reduce((a, b) => (matrix.get(from, b).minutes < matrix.get(from, a).minutes ? b : a))
        : ids[0];

      const optimized = orderByNearestNeighbor(matrix, ids, start);
      if (totalTravelMinutes(matrix, optimized) < totalTravelMinutes(matrix, ids)) {
        const byId = new Map(group.map((s) => [s.placeId, s]));
        ordered.push(...optimized.map((id) => byId.get(id)!).filter(Boolean));
        reordered = true;
        continue;
      }
    }

    ordered.push(...group);
  }

  if (reordered) report.reorderedDays.push(dayNumber);
  return ordered;
}

/**
 * 같은 테마의 후보 중, 앞뒤 일정 모두에서 제한 시간 안에 닿는 곳을 찾는다.
 * 식당이면 가중 점수 순서를 유지한 채 (이미 정렬돼 있음) 가장 앞선 후보를 고른다.
 */
function findNearerAlternative(
  slot: Slot,
  prevId: string,
  nextId: string | undefined,
  candidates: CandidateSet,
  legLimit: number,
  usedPlaces: ReadonlySet<string>,
): Slot | null {
  const { matrix } = candidates;
  const pool = isMeal(slot.kind)
    ? candidates.rankedRestaurants
    : (candidates.candidatesByTheme.get(slot.theme) ?? []);

  for (const c of pool) {
    if (usedPlaces.has(c.placeId) || c.placeId === slot.placeId) continue;
    if (matrix.get(prevId, c.placeId).minutes > legLimit) continue;
    if (nextId && matrix.get(c.placeId, nextId).minutes > legLimit) continue;

    return {
      ...slot,
      placeId: c.placeId,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      rating: c.rating,
      userRatingCount: c.userRatingCount,
      photoName: c.photoName,
      // 장소가 바뀌었으므로 원래 장소를 설명하던 확장 정보는 버린다.
      extras: undefined,
      reason: isMeal(slot.kind)
        ? mealReason(c.rating, c.userRatingCount)
        : "동선을 지키기 위해 가까운 같은 테마 장소로 대체했습니다.",
    };
  }

  return null;
}

/**
 * 제한을 만족하는 후보가 없을 때 쓰는 최후 수단 — 가장 가까운 식당.
 *
 * 아직 안 쓴 식당을 먼저 보고, 그마저 멀면 **다른 날 갔던 식당의 재방문**까지
 * 허용한다. 좋았던 집을 한 번 더 가는 것이 두 시간을 이동하는 것보다 낫다.
 * 같은 날 안에서의 중복은 허용하지 않는다.
 */
function findNearestAlternative(
  slot: Slot,
  prevId: string,
  candidates: CandidateSet,
  usedPlaces: ReadonlySet<string>,
  sameDayPlaces: ReadonlySet<string>,
): Slot | null {
  const { matrix } = candidates;
  const currentMinutes = matrix.get(prevId, slot.placeId).minutes;

  const nearestOf = (pool: readonly PlaceCandidate[]) => {
    if (pool.length === 0) return null;
    const best = pool.reduce((a, c) =>
      matrix.get(prevId, c.placeId).minutes < matrix.get(prevId, a.placeId).minutes ? c : a,
    );
    // 원래 장소보다 가깝지 않으면 굳이 바꾸지 않는다.
    return matrix.get(prevId, best.placeId).minutes < currentMinutes ? best : null;
  };

  const selectable = candidates.rankedRestaurants.filter(
    (c) => c.placeId !== slot.placeId && !sameDayPlaces.has(c.placeId),
  );

  const fresh = nearestOf(selectable.filter((c) => !usedPlaces.has(c.placeId)));
  const revisit = fresh ?? nearestOf(selectable);
  if (!revisit) return null;

  const isRevisit = usedPlaces.has(revisit.placeId);

  return {
    ...slot,
    placeId: revisit.placeId,
    name: revisit.name,
    lat: revisit.lat,
    lng: revisit.lng,
    rating: revisit.rating,
    userRatingCount: revisit.userRatingCount,
    photoName: revisit.photoName,
    extras: undefined,
    reason: isRevisit
      ? `동선상 가장 가까운 식당이라 다시 찾았습니다. ${mealReason(revisit.rating, revisit.userRatingCount)}`
      : mealReason(revisit.rating, revisit.userRatingCount),
  };
}

function mealReason(rating?: number, count?: number): string {
  if (rating === undefined) return "동선상 들르기 좋은 식당입니다.";
  return `구글 지도 평점 ${rating.toFixed(1)}점, 리뷰 ${(count ?? 0).toLocaleString("ko-KR")}개로 검증된 곳입니다.`;
}

/**
 * 순서를 바꾼 뒤 시작 시간을 09:00부터 체류+이동 시간만큼 밀어가며 다시 매긴다.
 *
 * 끼니는 시간대가 정해져 있으므로 그 시각까지 당기거나 민다.
 * 저녁 이후 일정은 22시를 넘기지 않게 체류 시간을 줄여서라도 맞춘다.
 */
function reassignTimes(slots: readonly Slot[]): Slot[] {
  const DAY_END = 22 * 60;
  let minutes = 9 * 60;

  return slots.map((slot) => {
    if (slot.kind === "lunch") minutes = Math.max(minutes, 12 * 60);
    if (slot.kind === "dinner") minutes = Math.max(minutes, 18 * 60);

    // 하루 끝을 넘기면 더 밀지 않고 마지막 시간대에 붙인다.
    const start = Math.min(minutes, DAY_END - 30);
    const startTime = `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(
      start % 60,
    ).padStart(2, "0")}`;

    minutes = start + slot.stayMinutes + 20; // 20분은 이동 여유
    return { ...slot, startTime };
  });
}

/**
 * 일정 항목이 바뀐 뒤 이동 정보와 시작 시간을 다시 계산한다.
 *
 * 예산 조정으로 항목이 빠지면 남은 항목의 travelFromPrev가 사라진 장소를
 * 가리킨 채 남는다. 결과를 확정하기 전에 반드시 한 번 돌려 줘야 한다.
 */
export function refreshDayTravel(
  days: readonly Day[],
  candidates: CandidateSet,
  legLimit?: number,
): Day[] {
  const { matrix } = candidates;

  return days.map((day) => {
    const slots = reassignTimes(day.slots).map((slot, i, arr) => {
      if (i === 0) return { ...slot, travelFromPrev: undefined };

      const leg = matrix.get(arr[i - 1].placeId, slot.placeId);
      return {
        ...slot,
        travelFromPrev: {
          minutes: leg.minutes,
          meters: leg.meters,
          mode: matrix.mode,
          isEstimate: leg.isEstimate,
          exceedsTarget: legLimit !== undefined && leg.minutes > legLimit,
        },
      };
    });

    return {
      ...day,
      slots,
      totalTravelMinutes: totalTravelMinutes(
        matrix,
        slots.map((s) => s.placeId),
      ),
    };
  });
}
