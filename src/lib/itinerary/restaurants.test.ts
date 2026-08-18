import { describe, expect, it } from "vitest";
import {
  bayesianScore,
  diversifyByType,
  meanRating,
  pickMealCandidates,
  rankRestaurants,
} from "./restaurants";
import type { PlaceCandidate } from "./schema";

function restaurant(
  placeId: string,
  rating: number,
  userRatingCount: number,
  extra: Partial<PlaceCandidate> = {},
): PlaceCandidate {
  return {
    placeId,
    name: placeId,
    lat: 37.5,
    lng: 127.0,
    theme: "food",
    rating,
    userRatingCount,
    ...extra,
  };
}

describe("bayesianScore", () => {
  it("리뷰가 적으면 점수를 후보군 평균 쪽으로 끌어내린다", () => {
    const pool = 4.2;
    const fewReviews = bayesianScore(5.0, 3, pool);
    const manyReviews = bayesianScore(4.5, 4000, pool);

    expect(fewReviews).toBeLessThan(manyReviews);
    // 리뷰 3개짜리 5.0점은 거의 평균값까지 눌린다
    expect(fewReviews).toBeCloseTo(4.22, 1);
    // 리뷰 4000개짜리는 자기 평점을 거의 그대로 갖는다
    expect(manyReviews).toBeCloseTo(4.49, 1);
  });

  it("평점 정보가 없으면 후보군 평균을 그대로 쓴다", () => {
    expect(bayesianScore(undefined, undefined, 4.1)).toBe(4.1);
  });
});

describe("rankRestaurants", () => {
  it("리뷰 3개 5.0점이 리뷰 4000개 4.5점보다 뒤로 정렬된다", () => {
    const ranked = rankRestaurants([
      restaurant("신생가게", 5.0, 3),
      restaurant("검증된맛집", 4.5, 4000),
      restaurant("평범한곳", 4.0, 500),
    ]);

    expect(ranked[0].placeId).toBe("검증된맛집");
    expect(ranked.map((r) => r.placeId)).not.toContain("신생가게");
  });

  it("리뷰 20개 미만은 표본 부족으로 제외한다", () => {
    const ranked = rankRestaurants([
      restaurant("표본부족", 4.9, 5),
      restaurant("충분함", 4.3, 300),
    ]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].placeId).toBe("충분함");
  });

  it("전부 표본이 부족하면 기준을 풀어 후보를 살린다", () => {
    const ranked = rankRestaurants([
      restaurant("소도시가게A", 4.6, 8),
      restaurant("소도시가게B", 4.1, 3),
    ]);

    expect(ranked).toHaveLength(2);
    expect(ranked[0].placeId).toBe("소도시가게A");
  });

  it("후보가 충분하면 예산 상한을 넘는 가격대를 제외한다", () => {
    // 필터 후에도 MIN_MEAL_CANDIDATES 이상 남아야 필터가 실제로 적용된다.
    const ranked = rankRestaurants(
      [
        restaurant("고급", 4.8, 900, { priceLevel: 4 }),
        ...Array.from({ length: 6 }, (_, i) =>
          restaurant(`보통${i}`, 4.5, 900, { priceLevel: 2 }),
        ),
        restaurant("가격미상", 4.4, 900),
      ],
      { maxPriceLevel: 2 },
    );

    const ids = ranked.map((r) => r.placeId);
    expect(ids).not.toContain("고급");
    expect(ids).toContain("보통0");
    // 가격 정보가 없는 곳은 배제하지 않는다 (Places가 자주 비워둠)
    expect(ids).toContain("가격미상");
  });

  it("가격 필터가 후보를 거의 다 날리면 필터를 풀어 끼니를 지킨다", () => {
    // 예산이 빠듯하면 상한 이하 식당이 거의 없다. 그렇다고 끼니를 못 채우면 안 된다.
    const ranked = rankRestaurants(
      [
        restaurant("비쌈1", 4.8, 900, { priceLevel: 4 }),
        restaurant("비쌈2", 4.7, 900, { priceLevel: 3 }),
        restaurant("저렴", 4.2, 900, { priceLevel: 1 }),
      ],
      { maxPriceLevel: 1 },
    );

    expect(ranked).toHaveLength(3);
    // 필터를 풀 때는 싼 순으로 정렬해 예산 부담을 줄인다
    expect(ranked[0].placeId).toBe("저렴");
  });

  it("weightedScore를 채워서 반환한다", () => {
    const ranked = rankRestaurants([restaurant("가게", 4.5, 200)]);
    expect(ranked[0].weightedScore).toBeGreaterThan(0);
  });
});

describe("meanRating", () => {
  it("평점이 하나도 없으면 중립값 4.0을 쓴다", () => {
    const noRatings: PlaceCandidate[] = [
      { placeId: "a", name: "a", lat: 0, lng: 0, theme: "food" },
    ];
    expect(meanRating(noRatings)).toBe(4.0);
  });
});

describe("pickMealCandidates", () => {
  const ranked = [
    restaurant("멀지만최고", 4.9, 5000),
    restaurant("가까운1", 4.5, 1000),
    restaurant("가까운2", 4.4, 1000),
    restaurant("가까운3", 4.3, 1000),
  ];

  it("이동 범위 밖의 식당은 평점이 높아도 제외한다", () => {
    const reach = new Set(["가까운1", "가까운2", "가까운3"]);
    const picked = pickMealCandidates(ranked, reach, new Set());

    expect(picked.map((p) => p.placeId)).not.toContain("멀지만최고");
    expect(picked).toHaveLength(3);
  });

  it("이미 배정된 식당은 중복 배치하지 않는다", () => {
    const reach = new Set(["가까운1", "가까운2", "가까운3"]);
    const picked = pickMealCandidates(ranked, reach, new Set(["가까운1"]));

    expect(picked.map((p) => p.placeId)).not.toContain("가까운1");
  });

  it("범위 안 후보가 3곳 미만이면 범위를 넓혀 빈 슬롯을 막는다", () => {
    const picked = pickMealCandidates(ranked, new Set(["가까운1"]), new Set());
    expect(picked.length).toBeGreaterThan(1);
  });
});

describe("diversifyByType", () => {
  it("같은 장르가 연달아 나오지 않게 재배열한다", () => {
    const input = [
      restaurant("한식1", 4.5, 100, { primaryType: "korean_restaurant" }),
      restaurant("한식2", 4.4, 100, { primaryType: "korean_restaurant" }),
      restaurant("일식1", 4.3, 100, { primaryType: "japanese_restaurant" }),
    ];

    const out = diversifyByType(input);
    expect(out[0].primaryType).toBe("korean_restaurant");
    expect(out[1].primaryType).toBe("japanese_restaurant");
    expect(out).toHaveLength(3);
  });

  it("전부 같은 장르면 순서를 유지한 채 모두 반환한다", () => {
    const input = [
      restaurant("a", 4.5, 100, { primaryType: "cafe" }),
      restaurant("b", 4.4, 100, { primaryType: "cafe" }),
    ];
    expect(diversifyByType(input).map((c) => c.placeId)).toEqual(["a", "b"]);
  });
});
