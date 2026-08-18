import type { PlaceCandidate, ThemeId, TravelMode } from "@/lib/itinerary/schema";
import type { Leg, RoutePoint } from "@/lib/itinerary/routing";
import { getTheme } from "@/lib/themes";
import { serverEnv } from "./env";
import { mockGeocode, mockPlaces, THEME_COST_KRW } from "./mock";

/**
 * Google Places API (New) + Routes API 클라이언트 — 서버 전용.
 * 키가 없거나 호출이 실패하면 목업으로 떨어진다 (throw하지 않는다).
 */

const PLACES_BASE = "https://places.googleapis.com/v1";
const ROUTES_BASE = "https://routes.googleapis.com";

/**
 * fieldMask는 Places SKU 등급을 직접 결정한다.
 * rating/userRatingCount를 넣으면 Pro -> Enterprise로 올라가므로,
 * 식당·액티비티 검색처럼 랭킹이 필요한 호출에만 붙인다.
 */
const SEARCH_FIELDS_BASIC = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.formattedAddress",
  "places.primaryType",
  "places.photos",
].join(",");

const SEARCH_FIELDS_RANKED = [
  SEARCH_FIELDS_BASIC,
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
].join(",");

interface RawPlace {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  photos?: { name?: string }[];
}

/** Places는 가격대를 문자열 enum으로 준다. 0~4 숫자로 정규화. */
const PRICE_LEVEL_MAP: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function toCandidate(raw: RawPlace, theme: ThemeId): PlaceCandidate | null {
  const lat = raw.location?.latitude;
  const lng = raw.location?.longitude;
  if (!raw.id || lat === undefined || lng === undefined) return null;

  return {
    placeId: raw.id,
    name: raw.displayName?.text ?? "이름 없는 장소",
    lat,
    lng,
    theme,
    address: raw.formattedAddress,
    rating: raw.rating,
    userRatingCount: raw.userRatingCount,
    priceLevel: raw.priceLevel ? PRICE_LEVEL_MAP[raw.priceLevel] : undefined,
    primaryType: raw.primaryType,
    photoName: raw.photos?.[0]?.name,
    estimatedCostKrw: THEME_COST_KRW[theme],
  };
}

/** 도시명 -> 좌표. Places Text Search 사용. */
export async function geocodeDestination(
  destination: string,
): Promise<{ lat: number; lng: number; name: string; mocked: boolean }> {
  const key = serverEnv.mapsKey;
  if (!key) return { ...mockGeocode(destination), mocked: true };

  try {
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.location",
      },
      body: JSON.stringify({
        textQuery: destination,
        languageCode: "ko",
        maxResultCount: 1,
      }),
    });

    if (!res.ok) throw new Error(`Places searchText ${res.status}`);

    const data = (await res.json()) as { places?: RawPlace[] };
    const first = data.places?.[0];
    const lat = first?.location?.latitude;
    const lng = first?.location?.longitude;
    if (lat === undefined || lng === undefined) throw new Error("좌표를 찾지 못했습니다.");

    return { lat, lng, name: first?.displayName?.text ?? destination, mocked: false };
  } catch (err) {
    console.warn("[places] 지오코딩 실패, 샘플 좌표로 대체:", err);
    return { ...mockGeocode(destination), mocked: true };
  }
}

/**
 * 한 테마의 후보 장소를 검색한다.
 * 고르지 않은 테마는 애초에 호출하지 않으므로 그만큼 SKU 비용이 줄어든다.
 */
export async function searchPlacesForTheme(
  center: { lat: number; lng: number },
  themeId: ThemeId,
  destination: string,
  options: { radiusMeters?: number; maxResults?: number; ranked?: boolean } = {},
): Promise<{ candidates: PlaceCandidate[]; mocked: boolean }> {
  const key = serverEnv.mapsKey;
  const maxResults = options.maxResults ?? 12;
  const radiusMeters = options.radiusMeters ?? 15000;
  if (!key) {
    return {
      candidates: mockPlaces(center, themeId, destination, maxResults, radiusMeters / 1000),
      mocked: true,
    };
  }

  try {
    const res = await fetch(`${PLACES_BASE}/places:searchNearby`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          options.ranked === false ? SEARCH_FIELDS_BASIC : SEARCH_FIELDS_RANKED,
      },
      body: JSON.stringify({
        includedTypes: getTheme(themeId).placeTypes,
        maxResultCount: Math.min(20, maxResults),
        languageCode: "ko",
        rankPreference: "POPULARITY",
        locationRestriction: {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius: radiusMeters,
          },
        },
      }),
    });

    if (!res.ok) throw new Error(`Places searchNearby ${res.status}`);

    const data = (await res.json()) as { places?: RawPlace[] };
    const candidates = (data.places ?? [])
      .map((p) => toCandidate(p, themeId))
      .filter((c): c is PlaceCandidate => c !== null);

    // 결과가 너무 적으면 일정을 못 채우므로 샘플로 보강한다.
    if (candidates.length < 3) {
      return {
        candidates: [
          ...candidates,
          ...mockPlaces(center, themeId, destination, maxResults, radiusMeters / 1000),
        ],
        mocked: true,
      };
    }

    return { candidates, mocked: false };
  } catch (err) {
    console.warn(`[places] ${themeId} 검색 실패, 샘플로 대체:`, err);
    return {
      candidates: mockPlaces(center, themeId, destination, maxResults, radiusMeters / 1000),
      mocked: true,
    };
  }
}

/** Places 사진 URL. 키가 서버에만 있으므로 /api/photo 프록시를 통해 부른다. */
export async function fetchPhotoUrl(
  photoName: string,
  maxWidth = 800,
): Promise<string | null> {
  const key = serverEnv.mapsKey;
  if (!key) return null;

  try {
    const res = await fetch(
      `${PLACES_BASE}/${photoName}/media?maxWidthPx=${maxWidth}&skipHttpRedirect=true&key=${key}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { photoUri?: string };
    return data.photoUri ?? null;
  } catch {
    return null;
  }
}

// -- Routes API ---------------------------------------------------

interface RouteMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  distanceMeters?: number;
  condition?: string;
}

/**
 * 실제 이동시간 행렬. N x N 과금이라 호출 전에 지점을 잘라서 넘겨야 한다.
 * 실패하면 빈 배열을 반환하고, 호출자는 Haversine 추정으로 폴백한다.
 */
export async function computeRouteMatrix(
  points: readonly RoutePoint[],
  mode: TravelMode,
): Promise<{ legs: { from: string; to: string; leg: Leg }[]; mocked: boolean }> {
  const key = serverEnv.mapsKey;
  // Routes API는 TRANSIT일 때 원점 x 목적지 100개, 그 외 625개까지 허용한다.
  const limit = mode === "TRANSIT" ? 10 : 25;

  if (!key || points.length < 2 || points.length > limit) {
    return { legs: [], mocked: true };
  }

  const waypoints = points.map((p) => ({
    waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
  }));

  try {
    const res = await fetch(`${ROUTES_BASE}/distanceMatrix/v2:computeRouteMatrix`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,duration,distanceMeters,condition",
      },
      body: JSON.stringify({
        origins: waypoints,
        destinations: waypoints,
        travelMode: mode,
        languageCode: "ko",
        units: "METRIC",
      }),
    });

    if (!res.ok) throw new Error(`Routes computeRouteMatrix ${res.status}`);

    const elements = (await res.json()) as RouteMatrixElement[];
    const legs: { from: string; to: string; leg: Leg }[] = [];

    for (const el of elements) {
      if (el.condition !== "ROUTE_EXISTS") continue;
      const from = points[el.originIndex ?? -1];
      const to = points[el.destinationIndex ?? -1];
      if (!from || !to || from.id === to.id) continue;

      // duration은 "1234s" 형태의 문자열로 온다.
      const seconds = Number.parseInt(el.duration ?? "0", 10);
      legs.push({
        from: from.id,
        to: to.id,
        leg: {
          minutes: Math.max(1, Math.round(seconds / 60)),
          meters: el.distanceMeters ?? 0,
          isEstimate: false,
        },
      });
    }

    return { legs, mocked: legs.length === 0 };
  } catch (err) {
    console.warn("[routes] 이동시간 행렬 실패, 직선거리 추정으로 대체:", err);
    return { legs: [], mocked: true };
  }
}
