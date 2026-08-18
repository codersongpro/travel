import type { PlaceCandidate } from "./schema";

/**
 * 식당 랭킹 — 구글 맵 평점과 리뷰 수를 함께 반영한다.
 *
 * 평점만으로 정렬하면 "리뷰 3개에 5.0점"인 신생 가게가
 * "리뷰 4,000개에 4.5점"인 검증된 맛집을 이겨버린다.
 * 그래서 리뷰 수를 신뢰도로 삼는 베이지안 가중 평점을 쓴다
 * (IMDb 가중 평점과 같은 공식).
 *
 *   score = (v / (v + m)) * R + (m / (v + m)) * C
 *
 *   R = 해당 식당 평점        v = 리뷰 수
 *   m = 신뢰 기준 리뷰 수      C = 후보군 전체 평균 평점
 *
 * 리뷰가 적으면 점수가 평균 쪽으로 끌려 내려가고,
 * 리뷰가 많으면 자기 평점을 온전히 갖는다.
 */

/** 신뢰 기준 리뷰 수. 이 값에 도달해야 자기 평점의 절반 이상을 반영받는다. */
export const CONFIDENCE_THRESHOLD = 100;

/** 표본이 이보다 적으면 아예 후보에서 뺀다. */
export const MIN_REVIEW_COUNT = 20;

/** 가격대 필터를 적용한 뒤 최소 이만큼은 남아야 한다. 안 남으면 필터를 푼다. */
export const MIN_MEAL_CANDIDATES = 6;

/** 후보군의 평균 평점 C. 평점이 있는 항목만으로 계산한다. */
export function meanRating(candidates: readonly PlaceCandidate[]): number {
  const rated = candidates.filter((c) => typeof c.rating === "number");
  if (rated.length === 0) return 4.0; // 평점 정보가 전혀 없을 때의 중립값
  return rated.reduce((sum, c) => sum + (c.rating ?? 0), 0) / rated.length;
}

/** 단일 후보의 베이지안 가중 평점. */
export function bayesianScore(
  rating: number | undefined,
  reviewCount: number | undefined,
  meanOfPool: number,
  m: number = CONFIDENCE_THRESHOLD,
): number {
  if (typeof rating !== "number") return meanOfPool;
  const v = reviewCount ?? 0;
  return (v / (v + m)) * rating + (m / (v + m)) * meanOfPool;
}

/**
 * 식당 후보를 필터링하고 가중 점수순으로 정렬한다.
 * 반환된 각 후보의 `weightedScore`에 계산 결과가 채워진다.
 */
export function rankRestaurants(
  candidates: readonly PlaceCandidate[],
  options: { maxPriceLevel?: number } = {},
): PlaceCandidate[] {
  const pool = candidates.filter((c) => (c.userRatingCount ?? 0) >= MIN_REVIEW_COUNT);

  // 표본 기준을 통과한 곳이 하나도 없으면(소도시 등) 기준을 풀어 전체를 쓴다.
  const usable = pool.length > 0 ? pool : [...candidates];
  const C = meanRating(usable);

  const scored = usable
    .map((c) => ({
      ...c,
      weightedScore: bayesianScore(c.rating, c.userRatingCount, C),
    }))
    .sort((a, b) => (b.weightedScore ?? 0) - (a.weightedScore ?? 0));

  if (options.maxPriceLevel === undefined) return scored;

  const affordable = scored.filter(
    // 가격대 정보가 없는 곳은 배제하지 않는다 (Places가 자주 비워둠).
    (c) => c.priceLevel === undefined || c.priceLevel <= options.maxPriceLevel!,
  );

  // 예산이 빠듯하면 이 필터가 후보를 거의 다 날려서 끼니를 못 채운다.
  // 남는 후보가 너무 적으면 싼 순으로 정렬만 하고 전부 살린다 —
  // 최종 예산 초과는 enforceBudget이 항목 단위로 다시 조정한다.
  if (affordable.length >= MIN_MEAL_CANDIDATES) return affordable;

  return scored.sort(
    (a, b) =>
      (a.priceLevel ?? 2) - (b.priceLevel ?? 2) ||
      (b.weightedScore ?? 0) - (a.weightedScore ?? 0),
  );
}

/**
 * 한 끼니 슬롯에 넘길 식당 후보를 고른다.
 *
 * 아무리 평점이 높아도 그 시간대 직전 일정에서 멀면 동선이 무너지므로,
 * 이동 가능 범위 안의 후보만 남긴 뒤 상위 N개를 반환한다.
 *
 * @param withinReach 이동 가능 범위 안에 있는 placeId 집합
 * @param exclude     이미 다른 끼니에 배정된 placeId (중복 방지)
 */
export function pickMealCandidates(
  ranked: readonly PlaceCandidate[],
  withinReach: ReadonlySet<string>,
  exclude: ReadonlySet<string>,
  limit = 6,
): PlaceCandidate[] {
  const reachable = ranked.filter(
    (c) => withinReach.has(c.placeId) && !exclude.has(c.placeId),
  );

  // 범위 안에 후보가 부족하면 범위를 넓혀서라도 채운다 (빈 슬롯보다는 낫다).
  const fallback = ranked.filter((c) => !exclude.has(c.placeId));
  const pool = reachable.length >= 3 ? reachable : fallback;

  return pool.slice(0, limit);
}

/**
 * 하루 안에서 같은 장르가 연달아 나오지 않게 재배열한다.
 * primaryType이 직전 선택과 같으면 다음 후보로 미룬다.
 */
export function diversifyByType(candidates: readonly PlaceCandidate[]): PlaceCandidate[] {
  const out: PlaceCandidate[] = [];
  const remaining = [...candidates];

  while (remaining.length > 0) {
    const prevType = out.at(-1)?.primaryType;
    const idx = remaining.findIndex((c) => c.primaryType !== prevType);
    // 전부 같은 장르라면 그냥 순서대로 꺼낸다.
    out.push(...remaining.splice(idx === -1 ? 0 : idx, 1));
  }

  return out;
}
