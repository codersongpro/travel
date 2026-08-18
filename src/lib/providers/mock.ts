import type { HotelCandidate, PlaceCandidate, ThemeId } from "@/lib/itinerary/schema";
import { THEMES } from "@/lib/themes";

/**
 * 샘플 데이터 — API 키가 없을 때 앱을 끝까지 돌리기 위한 폴백.
 *
 * 실제 좌표를 쓰되 도시 중심에서 결정론적으로 퍼뜨린다.
 * 랜덤을 쓰지 않으므로 새로고침해도 같은 후보가 나온다.
 */

/** 문자열 → 0~1 사이 안정적인 의사난수. 같은 입력이면 항상 같은 값. */
function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** 도시 중심에서 반경 안으로 결정론적으로 흩뿌린 좌표. */
function scatter(
  center: { lat: number; lng: number },
  seed: string,
  radiusKm: number,
): { lat: number; lng: number } {
  const angle = hashUnit(`${seed}-angle`) * Math.PI * 2;
  const dist = Math.sqrt(hashUnit(`${seed}-dist`)) * radiusKm;
  const latDeg = dist / 111;
  const lngDeg = dist / (111 * Math.cos((center.lat * Math.PI) / 180));
  return {
    lat: +(center.lat + Math.sin(angle) * latDeg).toFixed(6),
    lng: +(center.lng + Math.cos(angle) * lngDeg).toFixed(6),
  };
}

/**
 * 테마별 샘플 장소 이름 — 실제 장소를 지어내지 않고 유형만 드러낸다.
 * 개수는 Places API가 실제로 돌려주는 규모(12~20곳)에 맞춘다.
 * 후보가 모자라면 일정에 빈 날이 생기고 이동 제약도 못 지킨다.
 */
const SAMPLE_NAMES: Record<ThemeId, string[]> = {
  education: [
    "시립 과학관", "국립 역사박물관", "현대미술관", "자연사박물관", "천문대",
    "시립 도서관", "민속박물관", "어린이 과학체험관", "산업기술관", "고고학박물관",
    "문학관", "화폐박물관",
  ],
  food: [
    "현지 인기 식당", "노포 국숫집", "로컬 비스트로", "시장 골목 식당",
    "가정식 백반집", "브런치 카페", "야시장 포차", "미슐랭 추천 식당",
    "노포 만둣집", "해산물 전문점", "숯불구이 전문점", "면요리 노포",
    "베이커리 카페", "스페셜티 커피", "가성비 정식집", "루프탑 다이닝",
    "골목 선술집", "채식 레스토랑",
  ],
  history: [
    "구 시가지 고성", "옛 관청 터", "독립운동 기념관", "성곽길", "왕릉",
    "역사 거리", "옛 성문", "고택 마을", "전적지 기념관", "근대건축 거리",
  ],
  nature: [
    "중앙 공원", "강변 산책로", "식물원", "전망 언덕", "해안 산책길",
    "호수 공원", "수목원", "습지 생태공원", "폭포 계곡", "숲길 트레일",
  ],
  culture: [
    "시립 갤러리", "공연예술극장", "문화의 거리", "아트센터", "복합문화공간",
    "전통예술 공연장", "사진 갤러리", "조각 공원", "디자인 뮤지엄", "콘서트홀",
  ],
  activity: [
    "대형 놀이공원", "워터파크", "실내 클라이밍장", "짚라인 파크",
    "카트 서킷", "실내 서핑장", "트램펄린 파크", "VR 체험관",
    "루지 체험장", "번지점프 타워",
  ],
  shopping: [
    "중앙 쇼핑몰", "재래시장", "백화점 본점", "빈티지 거리", "아울렛 타운",
    "지하상가", "수공예 마켓", "면세점", "서점 거리", "플리마켓 광장",
  ],
  nightlife: [
    "시티 전망대", "루프탑 바", "야경 명소 다리", "라이브 음악 클럽",
    "야시장 거리", "강변 야경 산책로", "재즈 바", "전망 카페",
    "네온 골목", "야간 개장 정원",
  ],
  wellness: [
    "도심 스파", "온천 리조트", "요가 스튜디오", "찜질 시설", "아유르베다 센터",
    "족욕 카페", "명상 센터", "타이 마사지 하우스", "웰니스 클리닉", "사우나 클럽",
  ],
  photo: [
    "파노라마 전망대", "벽화 골목", "일몰 포인트", "유리 전망교", "감성 카페 거리",
    "레트로 골목", "구름다리 전망", "리버뷰 데크", "야경 스카이덱", "핑크빛 정원",
  ],
  family: [
    "어린이 동물원", "아쿠아리움", "키즈 체험관", "가족 놀이터", "미니 기차 공원",
    "어린이 박물관", "동물 교감 농장", "실내 놀이시설", "곤충 생태관", "가족 물놀이터",
  ],
  local: [
    "전통 공방 체험", "쿠킹 클래스", "아침 재래시장", "동네 골목투어",
    "도자기 공방", "차 문화 체험관", "전통주 양조장", "직조 공방",
    "로컬 푸드 투어", "농장 체험장",
  ],
  religion: [
    "고찰", "대성당", "도심 사원", "순례길 성지", "산중 암자",
    "옛 수도원", "종교 유적지", "탑 유적", "신전 터", "기도의 언덕",
  ],
  sports: [
    "시립 경기장", "골프 클럽", "스키 리조트", "스포츠 콤플렉스", "실내 수영장",
    "자전거 대여소", "테니스 센터", "볼링 파크", "야구 연습장", "요트 마리나",
  ],
};

/** 테마별 1인 예상 비용(KRW) — 실제 요금이 없을 때의 추정 기준. */
export const THEME_COST_KRW: Record<ThemeId, number> = {
  education: 12000,
  food: 18000,
  history: 8000,
  nature: 3000,
  culture: 20000,
  activity: 55000,
  shopping: 0,
  nightlife: 25000,
  wellness: 40000,
  photo: 10000,
  family: 30000,
  local: 45000,
  religion: 3000,
  sports: 35000,
};

export function mockPlaces(
  center: { lat: number; lng: number },
  themeId: ThemeId,
  destination: string,
  count = 12,
  radiusKm = 8,
): PlaceCandidate[] {
  const names = SAMPLE_NAMES[themeId];
  const primaryType = THEMES.find((t) => t.id === themeId)?.placeTypes[0];

  return Array.from({ length: Math.min(count, names.length) }, (_, i) => {
    const seed = `${destination}-${themeId}-${i}`;
    const { lat, lng } = scatter(center, seed, radiusKm);

    // 평점 3.9~4.8, 리뷰 30~4000 — 랭킹 로직이 의미 있게 동작할 만큼 분산시킨다.
    const rating = +(3.9 + hashUnit(`${seed}-rating`) * 0.9).toFixed(1);
    const userRatingCount = Math.round(30 + hashUnit(`${seed}-reviews`) ** 2 * 3970);

    return {
      placeId: `mock:${themeId}:${i}`,
      name: `${destination} ${names[i]}`,
      lat,
      lng,
      theme: themeId,
      address: `${destination} 샘플 주소 ${i + 1}`,
      rating,
      userRatingCount,
      priceLevel: Math.round(hashUnit(`${seed}-price`) * 3) + 1,
      primaryType: themeId === "food" ? `sample_cuisine_${i % 4}` : primaryType,
      estimatedCostKrw: THEME_COST_KRW[themeId],
    } satisfies PlaceCandidate;
  });
}

/** 등급별 1박 요금 추정 (KRW) — Amadeus 키가 없을 때 쓴다. */
const TIER_PRICE_KRW = [0, 55_000, 90_000, 150_000, 260_000, 450_000];

export function mockHotels(
  center: { lat: number; lng: number },
  destination: string,
  tier: number,
  count = 10,
  radiusKm = 6,
): HotelCandidate[] {
  const base = TIER_PRICE_KRW[Math.min(5, Math.max(1, tier))];

  return Array.from({ length: count }, (_, i) => {
    const seed = `${destination}-hotel-${i}`;
    const { lat, lng } = scatter(center, seed, radiusKm);
    const swing = 0.8 + hashUnit(`${seed}-price`) * 0.5;

    return {
      hotelId: `mock:hotel:${i}`,
      name: `${destination} 샘플 호텔 ${i + 1}`,
      lat,
      lng,
      pricePerNightKrw: Math.round((base * swing) / 1000) * 1000,
      priceIsEstimate: true,
      rating: +(3.8 + hashUnit(`${seed}-rating`) * 1.0).toFixed(1),
      address: `${destination} 샘플 호텔 주소 ${i + 1}`,
    } satisfies HotelCandidate;
  });
}

/** 알려진 도시의 좌표 — Places 키가 없을 때 지오코딩 대체. */
const KNOWN_CITIES: Record<string, { lat: number; lng: number }> = {
  서울: { lat: 37.5665, lng: 126.978 },
  부산: { lat: 35.1796, lng: 129.0756 },
  제주: { lat: 33.4996, lng: 126.5312 },
  경주: { lat: 35.8562, lng: 129.2247 },
  강릉: { lat: 37.7519, lng: 128.8761 },
  전주: { lat: 35.8242, lng: 127.148 },
  여수: { lat: 34.7604, lng: 127.6622 },
  도쿄: { lat: 35.6762, lng: 139.6503 },
  오사카: { lat: 34.6937, lng: 135.5023 },
  교토: { lat: 35.0116, lng: 135.7681 },
  후쿠오카: { lat: 33.5904, lng: 130.4017 },
  타이베이: { lat: 25.033, lng: 121.5654 },
  방콕: { lat: 13.7563, lng: 100.5018 },
  싱가포르: { lat: 1.3521, lng: 103.8198 },
  파리: { lat: 48.8566, lng: 2.3522 },
  런던: { lat: 51.5074, lng: -0.1278 },
  로마: { lat: 41.9028, lng: 12.4964 },
  뉴욕: { lat: 40.7128, lng: -74.006 },
};

/** 도시명 → 좌표. 모르는 도시는 이름 해시로 안정적인 가짜 좌표를 만든다. */
export function mockGeocode(destination: string): {
  lat: number;
  lng: number;
  name: string;
} {
  const key = Object.keys(KNOWN_CITIES).find((city) => destination.includes(city));
  if (key) return { ...KNOWN_CITIES[key], name: destination };

  return {
    lat: +(33 + hashUnit(`${destination}-lat`) * 20).toFixed(4),
    lng: +(100 + hashUnit(`${destination}-lng`) * 40).toFixed(4),
    name: destination,
  };
}
