import type { HotelCandidate } from "@/lib/itinerary/schema";
import { serverEnv } from "./env";
import { mockHotels } from "./mock";

/**
 * Amadeus Self-Service — 숙소 검색과 실제 1박 요금.
 *
 * Google에는 개발자용 공개 호텔 API가 없어서(파트너 전용 Travel Partner API뿐)
 * 실제 객실 요금은 여기서 가져온다.
 *
 * 흐름: OAuth2 토큰 -> by-geocode로 hotelId 목록 -> hotel-offers로 요금 조회
 */

let cachedToken: { value: string; expiresAt: number } | null = null;

/** 토큰은 30분 유효. 매 요청마다 재발급하지 않도록 모듈 스코프에 캐시한다. */
async function getAccessToken(): Promise<string | null> {
  const creds = serverEnv.amadeus;
  if (!creds) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  try {
    const res = await fetch(`${serverEnv.amadeusHost}/v1/security/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: creds.id,
        client_secret: creds.secret,
      }),
    });

    if (!res.ok) throw new Error(`Amadeus 토큰 발급 ${res.status}`);

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error("토큰이 응답에 없습니다.");

    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 1800) * 1000,
    };
    return cachedToken.value;
  } catch (err) {
    console.warn("[amadeus] 토큰 발급 실패:", err);
    return null;
  }
}

/**
 * 통화 환산 — Amadeus는 목적지 통화로 요금을 준다.
 * 실시간 환율 API를 붙이면 정확해지지만, MVP에서는 고정 근사치를 쓰고
 * UI에 "추정" 표기를 남긴다.
 */
const FX_TO_KRW: Record<string, number> = {
  KRW: 1,
  USD: 1380,
  EUR: 1490,
  JPY: 9.2,
  GBP: 1750,
  CNY: 190,
  THB: 40,
  SGD: 1020,
  TWD: 43,
  AUD: 900,
  HKD: 177,
  VND: 0.055,
};

function toKrw(amount: number, currency: string): { krw: number; exact: boolean } {
  const rate = FX_TO_KRW[currency.toUpperCase()];
  // 모르는 통화는 USD로 가정 — 값을 버리는 것보다는 추정이라도 남기는 게 낫다.
  return { krw: Math.round(amount * (rate ?? FX_TO_KRW.USD)), exact: currency === "KRW" };
}

interface HotelListEntry {
  hotelId?: string;
  name?: string;
  geoCode?: { latitude?: number; longitude?: number };
  address?: { countryCode?: string };
}

interface HotelOffer {
  hotel?: { hotelId?: string; name?: string; latitude?: number; longitude?: number };
  offers?: { price?: { total?: string; currency?: string } }[];
}

/**
 * 좌표 주변 호텔과 요금을 조회한다.
 * 어느 단계든 실패하면 등급 기반 추정 요금의 샘플 숙소로 폴백한다.
 */
export async function searchHotels(
  center: { lat: number; lng: number },
  params: {
    destination: string;
    checkInDate: string;
    checkOutDate: string;
    adults: number;
    tier: number;
    nights: number;
    radiusMeters?: number;
  },
): Promise<{ hotels: HotelCandidate[]; mocked: boolean }> {
  const radiusKm = Math.max(2, Math.round((params.radiusMeters ?? 12000) / 1000));
  const fallback = () => ({
    hotels: mockHotels(center, params.destination, params.tier, 10, radiusKm * 0.7),
    mocked: true,
  });

  const token = await getAccessToken();
  if (!token) return fallback();

  const auth = { Authorization: `Bearer ${token}` };

  try {
    // 1) 좌표 주변 호텔 id 목록
    const listUrl = new URL(
      `${serverEnv.amadeusHost}/v1/reference-data/locations/hotels/by-geocode`,
    );
    listUrl.searchParams.set("latitude", String(center.lat));
    listUrl.searchParams.set("longitude", String(center.lng));
    listUrl.searchParams.set("radius", String(Math.min(20, radiusKm)));
    listUrl.searchParams.set("radiusUnit", "KM");
    listUrl.searchParams.set("hotelSource", "ALL");

    const listRes = await fetch(listUrl, { headers: auth });
    if (!listRes.ok) throw new Error(`Amadeus by-geocode ${listRes.status}`);

    const listData = (await listRes.json()) as { data?: HotelListEntry[] };
    const hotelIds = (listData.data ?? [])
      .map((h) => h.hotelId)
      .filter((id): id is string => Boolean(id))
      // hotel-offers는 한 번에 조회 가능한 id 수가 제한적이다.
      .slice(0, 20);

    if (hotelIds.length === 0) return fallback();

    // 2) 실제 1박 요금
    const offersUrl = new URL(`${serverEnv.amadeusHost}/v3/shopping/hotel-offers`);
    offersUrl.searchParams.set("hotelIds", hotelIds.join(","));
    offersUrl.searchParams.set("checkInDate", params.checkInDate);
    offersUrl.searchParams.set("checkOutDate", params.checkOutDate);
    offersUrl.searchParams.set("adults", String(Math.min(9, params.adults)));
    offersUrl.searchParams.set("currency", "KRW");
    offersUrl.searchParams.set("bestRateOnly", "true");

    const offersRes = await fetch(offersUrl, { headers: auth });
    if (!offersRes.ok) throw new Error(`Amadeus hotel-offers ${offersRes.status}`);

    const offersData = (await offersRes.json()) as { data?: HotelOffer[] };
    const geoById = new Map(
      (listData.data ?? []).map((h) => [h.hotelId, h.geoCode] as const),
    );

    const hotels: HotelCandidate[] = [];
    for (const entry of offersData.data ?? []) {
      const id = entry.hotel?.hotelId;
      const offer = entry.offers?.[0];
      const total = Number.parseFloat(offer?.price?.total ?? "");
      if (!id || !Number.isFinite(total)) continue;

      const geo = geoById.get(id);
      const lat = entry.hotel?.latitude ?? geo?.latitude;
      const lng = entry.hotel?.longitude ?? geo?.longitude;
      if (lat === undefined || lng === undefined) continue;

      // price.total은 전체 숙박 기간 합계이므로 1박 단가로 나눈다.
      const { krw, exact } = toKrw(total, offer?.price?.currency ?? "KRW");
      hotels.push({
        hotelId: id,
        name: entry.hotel?.name ?? "이름 없는 숙소",
        lat,
        lng,
        pricePerNightKrw: Math.round(krw / Math.max(1, params.nights)),
        priceIsEstimate: !exact,
      });
    }

    if (hotels.length === 0) return fallback();
    return { hotels: hotels.sort((a, b) => a.pricePerNightKrw - b.pricePerNightKrw), mocked: false };
  } catch (err) {
    console.warn("[amadeus] 숙소 조회 실패, 샘플 숙소로 대체:", err);
    return fallback();
  }
}

/** 테스트에서 토큰 캐시를 비우기 위한 훅. */
export function __resetTokenCache(): void {
  cachedToken = null;
}
