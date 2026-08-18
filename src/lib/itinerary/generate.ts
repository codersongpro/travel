import { isThemeId, type ThemeId } from "@/lib/themes";
import { generatePlan, type RawGeminiPlan } from "@/lib/providers/gemini";
import { collectCandidates } from "./candidates";
import { PACE_LIMITS } from "./routing";
import { buildFallbackPlan } from "./fallback";
import { buildPrompt } from "./prompt";
import { emptyReport, refreshDayTravel, validatePlan, type ValidationReport } from "./validate";
import { buildBudgetBlock, enforceBudget, partySize } from "./budget";
import type { CandidateSet } from "./candidates";
import type { Itinerary, Slot, TripRequest } from "./schema";

/**
 * 일정 생성 전체 흐름.
 *
 * 후보 수집 -> 프롬프트 -> Gemini -> 검증 -> (필요 시 1회 재요청) -> 결과 조립
 * 어느 단계가 실패해도 규칙 기반 폴백으로 이어져 항상 일정이 나온다.
 */

export async function generateItinerary(req: TripRequest): Promise<Itinerary> {
  const candidates = await collectCandidates(req);

  const prompt = buildPrompt({
    request: req,
    destination: candidates.destinationName,
    candidatesByTheme: candidates.candidatesByTheme,
    rankedRestaurants: candidates.rankedRestaurants,
    hotels: candidates.hotels,
    matrix: candidates.matrix,
    limits: candidates.limits,
    maxLodgingPerNight: candidates.maxLodgingPerNight,
  });

  let raw: RawGeminiPlan | null = await generatePlan(prompt);
  if (!raw) {
    candidates.mocked.add("gemini");
    raw = buildFallbackPlan(req, candidates);
  }

  let { days, report } = validatePlan(raw, req, candidates, emptyReport());

  // 재요청은 한 번만. 문제가 계속되면 폴백으로 메운다.
  if (needsRetry(report, days.length)) {
    const retried = await generatePlan(`${prompt}\n\n${retryNotes(report)}`);
    if (retried) {
      const second = validatePlan(retried, req, candidates, emptyReport());
      // 더 나아졌을 때만 채택한다.
      if (scorePlan(second.report, second.days.length) > scorePlan(report, days.length)) {
        days = second.days;
        report = second.report;
      }
    }
  }

  // 검증 후 일정이 비었다면(모델이 전부 지어냈다면) 규칙 기반으로 다시 만든다.
  if (days.every((d) => d.slots.length === 0)) {
    candidates.mocked.add("gemini");
    const rescued = validatePlan(buildFallbackPlan(req, candidates), req, candidates, emptyReport());
    days = rescued.days;
    report = rescued.report;
  }

  // 예산 상한 강제 — 비싼 항목부터 같은 테마의 더 싼 곳으로 바꾼다.
  // 교체가 여러 번 일어나므로 사용 목록을 살아 있는 집합으로 들고 다녀야 한다.
  // 매번 days에서 다시 계산하면 직전 교체가 반영되지 않아 같은 곳이 두 번 들어간다.
  const taken = usedPlaceIds(days);
  days = enforceBudget(days, candidates.limits, (slot, maxCost) => {
    const swap = findCheaperAlternative(slot, maxCost, req, candidates, taken);
    if (swap) {
      taken.delete(slot.placeId);
      taken.add(swap.placeId);
    }
    return swap;
  }).days;

  // 여러 교정 단계를 거치면서 같은 장소가 두 번 들어갈 수 있다.
  // 최종 방지선 — 한 여행에 같은 곳이 두 번 나오면 안 된다.
  days = dedupePlaces(days);

  // 예산 조정으로 항목이 빠지거나 바뀌었으므로 이동 정보와 시간표를 다시 계산한다.
  days = refreshDayTravel(days, candidates, PACE_LIMITS[req.pace].legMinutes);

  const highlights = (raw.highlights ?? [])
    .filter((h) => isThemeId(h.theme) && req.themes.some((t) => t.id === h.theme))
    .map((h) => ({ theme: h.theme as ThemeId, title: h.title, body: h.body }));

  return {
    destination: candidates.destinationName,
    startDate: req.startDate,
    endDate: req.endDate,
    summary: raw.summary ?? `${candidates.destinationName} 여행 일정입니다.`,
    highlights,
    days,
    budget: buildBudgetBlock(req.budgetKrw, candidates.limits, days),
    themes: req.themes,
    mockedSources: [...candidates.mocked],
  };
}

/** 재요청할 만한 문제인지. 사소한 결함으로 토큰을 두 배 쓰지는 않는다. */
function needsRetry(report: ValidationReport, dayCount: number): boolean {
  return (
    report.missingThemes.length > 0 ||
    report.hallucinated.length > dayCount ||
    report.droppedForDistance.length > dayCount
  );
}

function retryNotes(report: ValidationReport): string {
  const notes = ["# 직전 응답의 문제를 고쳐서 다시 만드세요"];

  if (report.missingThemes.length > 0) {
    notes.push(
      `- 다음 테마가 일정에 한 번도 등장하지 않았습니다. 반드시 포함하세요: ${report.missingThemes.join(", ")}`,
    );
  }
  if (report.hallucinated.length > 0) {
    notes.push(
      `- 후보 목록에 없는 id를 ${report.hallucinated.length}개 사용했습니다. 반드시 주어진 id만 쓰세요.`,
    );
  }
  if (report.droppedForDistance.length > 0) {
    notes.push(
      `- 이동시간 제약을 넘겨 ${report.droppedForDistance.length}개 항목이 제거됐습니다. 이동시간표 안의 조합만 연결하세요.`,
    );
  }

  return notes.join("\n");
}

/** 두 응답 중 어느 쪽이 나은지 비교하기 위한 단순 점수 (높을수록 좋음). */
function scorePlan(report: ValidationReport, dayCount: number): number {
  return (
    dayCount * 10 -
    report.missingThemes.length * 20 -
    report.hallucinated.length * 3 -
    report.droppedForDistance.length * 2
  );
}

/**
 * 중복 배치를 정리한다.
 *
 * 같은 날 같은 곳을 두 번 가는 것은 언제나 잘못이므로 무조건 지운다.
 * 날짜가 다른 재방문은 지우지 않는다 — 이동시간 교정이 "두 시간 떨어진 새 식당"
 * 대신 "가까운 단골집 재방문"을 고른 결과일 수 있고, 그편이 더 나은 일정이다.
 * 다만 활동은 재방문할 이유가 없으므로 날짜가 달라도 중복을 없앤다.
 */
function dedupePlaces(days: readonly Itinerary["days"][number][]): Itinerary["days"] {
  const seenActivities = new Set<string>();

  return days.map((day) => {
    const seenToday = new Set<string>();

    const slots = day.slots.filter((slot) => {
      if (seenToday.has(slot.placeId)) return false;

      if (slot.kind === "activity") {
        if (seenActivities.has(slot.placeId)) return false;
        seenActivities.add(slot.placeId);
      }

      seenToday.add(slot.placeId);
      return true;
    });

    return { ...day, slots };
  });
}

function usedPlaceIds(days: readonly Itinerary["days"][number][]): Set<string> {
  return new Set(days.flatMap((d) => d.slots.map((s) => s.placeId)));
}

/**
 * 같은 테마 안에서 더 싼 대안을 찾는다.
 * 이동거리까지 다시 흔들지 않도록, 원래 장소에서 15분 이내인 곳만 후보로 본다.
 */
function findCheaperAlternative(
  slot: Slot,
  maxCost: number,
  req: TripRequest,
  candidates: CandidateSet,
  used: ReadonlySet<string>,
): Slot | null {
  const people = partySize(req);
  const isMeal = slot.kind === "lunch" || slot.kind === "dinner" || slot.kind === "breakfast";
  const pool = isMeal
    ? candidates.rankedRestaurants
    : (candidates.candidatesByTheme.get(slot.theme) ?? []);

  const affordable = pool
    .filter((c) => !used.has(c.placeId) && c.placeId !== slot.placeId)
    .filter((c) => (c.estimatedCostKrw ?? 0) * people <= maxCost)
    // 원래 위치에서 멀지 않은 곳만 — 예산을 맞추다 동선을 깨면 안 된다.
    .filter((c) => candidates.matrix.get(slot.placeId, c.placeId).minutes <= 15);

  if (affordable.length === 0) return null;

  // 예산 안에서는 평점이 가장 좋은 곳을 고른다.
  const best = affordable.reduce((a, b) =>
    (b.weightedScore ?? b.rating ?? 0) > (a.weightedScore ?? a.rating ?? 0) ? b : a,
  );

  return {
    ...slot,
    placeId: best.placeId,
    name: best.name,
    lat: best.lat,
    lng: best.lng,
    rating: best.rating,
    userRatingCount: best.userRatingCount,
    photoName: best.photoName,
    costKrw: (best.estimatedCostKrw ?? 0) * people,
    extras: undefined,
    reason: "예산에 맞추기 위해 같은 테마의 더 합리적인 곳으로 바꿨습니다.",
  };
}
