import type { MockedSource } from "@/lib/providers/env";
import { computeRouteMatrix, geocodeDestination, searchPlacesForTheme } from "@/lib/providers/places";
import { searchHotels } from "@/lib/providers/amadeus";
import {
  maxLodgingPerNight,
  maxMealCostPerPerson,
  priceLevelCeiling,
  allocateBudget,
} from "./budget";
import { rankRestaurants } from "./restaurants";
import { clusterByGeography, TravelMatrix, type RoutePoint } from "./routing";
import type { BudgetBreakdown, HotelCandidate, PlaceCandidate, ThemeId, TripRequest } from "./schema";
import { dayCount, nightsBetween } from "./schema";

/**
 * 후보 수집 오케스트레이션.
 *
 * 1) 도시 좌표
 * 2) 테마별 장소 + 식당 + 숙소를 병렬 조회
 * 3) 식당을 가중 평점순으로 랭킹
 * 4) 클러스터 단위로만 실제 이동시간 행렬을 구성
 */

export interface CandidateSet {
  center: { lat: number; lng: number };
  destinationName: string;
  candidatesByTheme: Map<ThemeId, PlaceCandidate[]>;
  rankedRestaurants: PlaceCandidate[];
  hotels: HotelCandidate[];
  matrix: TravelMatrix;
  limits: BudgetBreakdown;
  maxLodgingPerNight: number;
  mocked: Set<MockedSource>;
  /** placeId로 후보를 되찾기 위한 색인 — 검증 단계에서 쓴다. */
  byId: Map<string, PlaceCandidate>;
}

/** Routes API는 N x N 과금이라 클러스터당 이만큼만 넘긴다. */
const MAX_POINTS_PER_CLUSTER = 12;

/**
 * 이동 수단별 검색 반경 (m).
 *
 * 도보 여행에 15km 반경으로 후보를 모으면 하나도 이어 붙일 수 없다.
 * 실제로 걸어 다닐 수 있는 범위 안에서만 찾아야 일정이 성립한다.
 */
const SEARCH_RADIUS_M: Record<TripRequest["travelMode"], number> = {
  // 도보 20~45분으로 이어붙이려면 후보가 한 동네 안에 있어야 한다.
  WALK: 1500,
  TRANSIT: 12000,
  DRIVE: 25000,
};

export async function collectCandidates(req: TripRequest): Promise<CandidateSet> {
  const mocked = new Set<MockedSource>();
  const days = dayCount(req.startDate, req.endDate);
  const nights = Math.max(1, nightsBetween(req.startDate, req.endDate));

  // 1) 도시 좌표
  const geo = await geocodeDestination(req.destination);
  if (geo.mocked) mocked.add("places");
  const center = { lat: geo.lat, lng: geo.lng };

  const limits = allocateBudget(req.budgetKrw);
  const lodgingCap = maxLodgingPerNight(req, limits);
  const mealCap = maxMealCostPerPerson(req, limits, days);

  // 2) 병렬 조회 — 고른 테마 + 식사 + 숙소
  const selectedThemes = req.themes.map((t) => t.id);
  const activityThemes = selectedThemes.filter((id) => id !== "food");

  const radiusMeters = SEARCH_RADIUS_M[req.travelMode];

  const [themeResults, foodResult, hotelResult] = await Promise.all([
    Promise.all(
      activityThemes.map(async (id) => ({
        id,
        ...(await searchPlacesForTheme(center, id, geo.name, { radiusMeters })),
      })),
    ),
    // 식사는 테마 선택과 무관하게 항상 필요하다 (점심·저녁 슬롯).
    searchPlacesForTheme(center, "food", geo.name, { maxResults: 20, radiusMeters }),
    searchHotels(center, {
      destination: geo.name,
      checkInDate: req.startDate,
      checkOutDate: req.endDate,
      adults: req.adults,
      tier: req.lodgingTier,
      nights,
      radiusMeters,
    }),
  ]);

  const candidatesByTheme = new Map<ThemeId, PlaceCandidate[]>();
  for (const r of themeResults) {
    if (r.mocked) mocked.add("places");
    candidatesByTheme.set(r.id, r.candidates);
  }
  if (foodResult.mocked) mocked.add("places");
  if (hotelResult.mocked) mocked.add("hotels");

  // 3) 식당 랭킹 — 평점 x 리뷰 수 가중 점수 + 예산 상한 필터
  const rankedRestaurants = rankRestaurants(foodResult.candidates, {
    maxPriceLevel: priceLevelCeiling(mealCap),
  });
  // 미식 테마를 골랐다면 랭킹된 식당이 활동 후보로도 노출되도록 채워 준다.
  if (selectedThemes.includes("food")) {
    candidatesByTheme.set("food", rankedRestaurants);
  }

  // 예산을 넘는 숙소는 후보에서 제외하되, 전부 넘으면 가장 싼 곳들을 남긴다.
  const affordable = hotelResult.hotels.filter((h) => h.pricePerNightKrw <= lodgingCap);
  const hotels = (affordable.length > 0 ? affordable : hotelResult.hotels).slice(0, 8);

  // 4) 이동시간 행렬
  const allPlaces = [...candidatesByTheme.values()].flat();
  const points: RoutePoint[] = dedupeById([...allPlaces, ...rankedRestaurants]).map((c) => ({
    id: c.placeId,
    lat: c.lat,
    lng: c.lng,
  }));

  const matrix = await buildMatrix(points, req, days, mocked);

  return {
    center,
    destinationName: geo.name,
    candidatesByTheme,
    rankedRestaurants,
    hotels,
    matrix,
    limits,
    maxLodgingPerNight: lodgingCap,
    mocked,
    byId: new Map(dedupeById([...allPlaces, ...rankedRestaurants]).map((c) => [c.placeId, c])),
  };
}

function dedupeById(list: readonly PlaceCandidate[]): PlaceCandidate[] {
  const seen = new Map<string, PlaceCandidate>();
  for (const c of list) if (!seen.has(c.placeId)) seen.set(c.placeId, c);
  return [...seen.values()];
}

/**
 * 클러스터 단위로만 Routes API를 호출한다.
 *
 * 전체를 한 번에 요청하면 N x N 과금이 폭증하고, 애초에 도시 반대편끼리의
 * 이동시간은 일정에 쓰이지도 않는다. 클러스터 밖 구간은 조회하지 않고
 * TravelMatrix가 직선거리 추정으로 채운다.
 */
async function buildMatrix(
  points: readonly RoutePoint[],
  req: TripRequest,
  days: number,
  mocked: Set<MockedSource>,
): Promise<TravelMatrix> {
  const matrix = new TravelMatrix(points, req.travelMode);
  if (points.length < 2) return matrix;

  const clusters = clusterByGeography(points, days);

  const results = await Promise.all(
    clusters
      .filter((c) => c.points.length >= 2)
      .map((c) => computeRouteMatrix(c.points.slice(0, MAX_POINTS_PER_CLUSTER), req.travelMode)),
  );

  for (const { legs } of results) {
    for (const { from, to, leg } of legs) matrix.set(from, to, leg);
  }

  if (!matrix.hasRealData) mocked.add("routes");
  return matrix;
}
