/**
 * 코스 테마 정의 — 앱 전체의 단일 출처.
 *
 * 사용자가 고른 테마만 Places API로 조회하고(비용 절감), 고른 테마만
 * 일정에 등장하며, 고른 테마의 확장 정보만 Gemini에 요청한다.
 */

export const THEME_IDS = [
  "education",
  "food",
  "history",
  "nature",
  "culture",
  "activity",
  "shopping",
  "nightlife",
  "wellness",
  "photo",
  "family",
  "local",
  "religion",
  "sports",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/** 테마 비중 — 일정에 얼마나 자주 등장할지. 분리 기준이 아니라 빈도 가중치. */
export type ThemeWeight = "light" | "normal" | "heavy";

export const WEIGHT_FACTOR: Record<ThemeWeight, number> = {
  light: 0.5,
  normal: 1,
  heavy: 1.8,
};

export const WEIGHT_LABEL: Record<ThemeWeight, string> = {
  light: "가볍게",
  normal: "보통",
  heavy: "집중",
};

/** 테마별 확장 정보 필드 — 해당 테마를 골랐을 때만 Gemini에 요청하고 UI에 표시한다. */
export type ExtraField =
  | "learningGoal"
  | "background"
  | "ageFit"
  | "discussionPrompts"
  | "signatureDish"
  | "reservationTip"
  | "era"
  | "historicalContext"
  | "bestSeason"
  | "difficulty"
  | "bestTimeOfDay"
  | "shootingTip"
  | "strollerFriendly"
  | "facilities"
  | "bookingRequired"
  | "duration";

export interface ThemeDef {
  id: ThemeId;
  label: string;
  icon: string;
  /** 폼 카드에 보여줄 한 줄 설명 */
  blurb: string;
  /** Places API (New) searchNearby 의 includedTypes */
  placeTypes: string[];
  /** 이 테마 항목에만 채워지는 확장 필드 */
  extras: ExtraField[];
  /** Tailwind 클래스 — 배지/보더 색상 */
  accent: string;
}

export const THEMES: readonly ThemeDef[] = [
  {
    id: "education",
    label: "교육·학습",
    icon: "🎓",
    blurb: "박물관·과학관·미술관에서 배우며 남는 여행",
    placeTypes: ["museum", "art_gallery", "aquarium", "zoo", "library", "planetarium"],
    extras: ["learningGoal", "background", "ageFit", "discussionPrompts"],
    accent: "amber",
  },
  {
    id: "food",
    label: "미식·맛집",
    icon: "🍜",
    blurb: "평점 높고 리뷰 많은 현지 맛집 위주",
    placeTypes: ["restaurant", "cafe", "bakery", "bar"],
    extras: ["signatureDish", "reservationTip"],
    accent: "rose",
  },
  {
    id: "history",
    label: "역사·유적",
    icon: "🏛",
    blurb: "고궁·유적지·기념물로 읽는 그 도시의 시간",
    placeTypes: ["historical_landmark", "historical_place", "monument"],
    extras: ["era", "historicalContext"],
    accent: "stone",
  },
  {
    id: "nature",
    label: "자연·힐링",
    icon: "🌿",
    blurb: "공원·정원·해변에서 천천히 쉬어가기",
    placeTypes: ["park", "national_park", "garden", "beach", "hiking_area"],
    extras: ["bestSeason", "difficulty"],
    accent: "emerald",
  },
  {
    id: "culture",
    label: "문화·예술",
    icon: "🎨",
    blurb: "갤러리·공연장·문화 랜드마크",
    placeTypes: ["art_gallery", "performing_arts_theater", "cultural_landmark"],
    extras: ["background"],
    accent: "violet",
  },
  {
    id: "activity",
    label: "액티비티·테마파크",
    icon: "🎢",
    blurb: "놀이공원·워터파크·액티비티 시설",
    placeTypes: ["amusement_park", "water_park", "adventure_sports_center"],
    extras: ["duration", "bookingRequired"],
    accent: "orange",
  },
  {
    id: "shopping",
    label: "쇼핑",
    icon: "🛍",
    blurb: "쇼핑몰·시장·백화점",
    placeTypes: ["shopping_mall", "market", "department_store"],
    extras: ["duration"],
    accent: "pink",
  },
  {
    id: "nightlife",
    label: "야경·나이트라이프",
    icon: "🌃",
    blurb: "전망대와 밤에 더 좋은 곳들",
    placeTypes: ["night_club", "bar", "observation_deck"],
    extras: ["bestTimeOfDay"],
    accent: "indigo",
  },
  {
    id: "wellness",
    label: "휴양·웰니스",
    icon: "🧘",
    blurb: "스파·온천·웰니스로 회복하는 일정",
    placeTypes: ["spa", "wellness_center"],
    extras: ["duration", "bookingRequired"],
    accent: "teal",
  },
  {
    id: "photo",
    label: "인생샷·포토스팟",
    icon: "📸",
    blurb: "사진이 잘 나오는 뷰포인트 중심",
    placeTypes: ["tourist_attraction", "observation_deck"],
    extras: ["bestTimeOfDay", "shootingTip"],
    accent: "fuchsia",
  },
  {
    id: "family",
    label: "가족·아이동반",
    icon: "👨‍👩‍👧",
    blurb: "아이와 함께 가기 좋은 곳",
    placeTypes: ["zoo", "aquarium", "playground", "amusement_park"],
    extras: ["ageFit", "strollerFriendly", "facilities"],
    accent: "sky",
  },
  {
    id: "local",
    label: "로컬 체험",
    icon: "🏡",
    blurb: "시장·공방·클래스로 현지인처럼",
    placeTypes: ["market", "restaurant", "tourist_attraction"],
    extras: ["bookingRequired", "duration"],
    accent: "lime",
  },
  {
    id: "religion",
    label: "종교·순례",
    icon: "⛩",
    blurb: "사찰·성당·모스크 등 종교 건축",
    placeTypes: ["church", "hindu_temple", "mosque", "synagogue"],
    extras: ["era", "historicalContext"],
    accent: "yellow",
  },
  {
    id: "sports",
    label: "스포츠·레저",
    icon: "⚽",
    blurb: "경기장·골프·스키 등 몸을 쓰는 일정",
    placeTypes: ["stadium", "golf_course", "ski_resort", "sports_complex"],
    extras: ["duration", "bookingRequired"],
    accent: "red",
  },
] as const;

const THEME_MAP = new Map<ThemeId, ThemeDef>(THEMES.map((t) => [t.id, t]));

export function getTheme(id: ThemeId): ThemeDef {
  const theme = THEME_MAP.get(id);
  if (!theme) throw new Error(`알 수 없는 테마: ${id}`);
  return theme;
}

export function isThemeId(value: string): value is ThemeId {
  return THEME_MAP.has(value as ThemeId);
}

/** 선택된 테마들이 요구하는 확장 필드의 합집합. Gemini 스키마를 좁히는 데 쓴다. */
export function extrasForThemes(ids: readonly ThemeId[]): ExtraField[] {
  const set = new Set<ExtraField>();
  for (const id of ids) for (const f of getTheme(id).extras) set.add(f);
  return [...set];
}

/** 선택된 테마들의 Places 조회 타입 합집합 (중복 제거). */
export function placeTypesForThemes(ids: readonly ThemeId[]): string[] {
  const set = new Set<string>();
  for (const id of ids) for (const t of getTheme(id).placeTypes) set.add(t);
  return [...set];
}

/** 확장 필드의 한국어 라벨 — UI 표시용. */
export const EXTRA_LABEL: Record<ExtraField, string> = {
  learningGoal: "여기서 배우는 것",
  background: "알고 가면 좋은 배경",
  ageFit: "연령별 관람 포인트",
  discussionPrompts: "함께 나눌 질문",
  signatureDish: "대표 메뉴",
  reservationTip: "예약 팁",
  era: "시대",
  historicalContext: "역사적 배경",
  bestSeason: "가기 좋은 계절",
  difficulty: "도보 난이도",
  bestTimeOfDay: "좋은 시간대",
  shootingTip: "촬영 팁",
  strollerFriendly: "유모차 접근성",
  facilities: "편의시설",
  bookingRequired: "사전 예약",
  duration: "소요 시간",
};
