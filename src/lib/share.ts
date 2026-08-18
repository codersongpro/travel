import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { itinerarySchema, type Itinerary } from "./itinerary/schema";

/**
 * 공유 링크 — 외부 DB 없이 일정을 URL에 담는다.
 *
 * 전체 일정을 그대로 넣으면 URL이 지나치게 길어지므로,
 * 표시에 꼭 필요한 필드만 남긴 뒤 lz-string으로 압축한다.
 */

/** 대부분의 브라우저·메신저가 안전하게 다루는 URL 길이 한계. */
export const SAFE_URL_LENGTH = 8000;

/** 표시에 쓰이지 않는 필드를 털어낸다. 압축률이 크게 좋아진다. */
function slim(itinerary: Itinerary): Itinerary {
  return {
    ...itinerary,
    days: itinerary.days.map((day) => ({
      ...day,
      slots: day.slots.map((slot) => ({
        ...slot,
        // 사진은 프록시 조회가 필요해 공유 링크에서는 생략한다.
        photoName: undefined,
      })),
    })),
  };
}

/**
 * lz-string의 출력 알파벳은 `A-Za-z0-9+-$`인데, 이 중 `+`가 문제다.
 *
 * URL 경로 세그먼트에 들어간 `+`는 중간 경로에서 `%2B`로 퍼센트 인코딩되고,
 * 서버는 그걸 되돌리지 않은 채로 받는다. 그러면 압축을 풀 수 없다.
 * (실측: 3,440자 payload가 서버에는 3,516자로 도착 — `+` 38개 × 2자)
 *
 * 그래서 URL에 담기 전에 `+`를 알파벳에 없는 `_`로 바꾸고, 풀 때 되돌린다.
 */
function toUrlSafe(compressed: string): string {
  return compressed.replaceAll("+", "_");
}

function fromUrlSafe(payload: string): string {
  // 공백은 `+`가 쿼리스트링 규칙으로 디코딩됐을 때를 대비한 방어책이다.
  return payload.replaceAll("_", "+").replaceAll(" ", "+");
}

export function encodeItinerary(itinerary: Itinerary): string {
  return toUrlSafe(compressToEncodedURIComponent(JSON.stringify(slim(itinerary))));
}

/** 손상되거나 조작된 payload는 null. 스키마 검증까지 통과해야 받아들인다. */
export function decodeItinerary(payload: string): Itinerary | null {
  try {
    const json = decompressFromEncodedURIComponent(fromUrlSafe(payload));
    if (!json) return null;

    const parsed = itinerarySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function buildShareUrl(origin: string, itinerary: Itinerary): {
  url: string;
  tooLong: boolean;
} {
  const url = `${origin}/share/${encodeItinerary(itinerary)}`;
  return { url, tooLong: url.length > SAFE_URL_LENGTH };
}
