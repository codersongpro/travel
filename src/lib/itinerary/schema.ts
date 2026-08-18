import { z } from "zod";
import { THEME_IDS } from "@/lib/themes";

/**
 * 여행 계획 도메인 스키마 — TypeScript 타입과 Gemini responseSchema의 단일 출처.
 * 여기서 파생된 타입만 앱 전체에서 쓴다.
 */

export const themeIdSchema = z.enum(THEME_IDS);

export const paceSchema = z.enum(["relaxed", "normal", "packed"]);
export type Pace = z.infer<typeof paceSchema>;

export const travelModeSchema = z.enum(["TRANSIT", "DRIVE", "WALK"]);
export type TravelMode = z.infer<typeof travelModeSchema>;

export const slotKindSchema = z.enum([
  "activity",
  "breakfast",
  "lunch",
  "dinner",
  "lodging",
]);
export type SlotKind = z.infer<typeof slotKindSchema>;

// ── 입력 ──────────────────────────────────────────────────────

export const themeSelectionSchema = z.object({
  id: themeIdSchema,
  weight: z.enum(["light", "normal", "heavy"]).default("normal"),
});

export const tripRequestSchema = z
  .object({
    destination: z.string().min(1, "여행지를 입력해 주세요.").max(120),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않습니다."),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않습니다."),
    adults: z.number().int().min(1).max(20),
    childAges: z.array(z.number().int().min(0).max(18)).max(10).default([]),
    /** 총예산 (KRW) */
    budgetKrw: z.number().int().min(0).max(1_000_000_000),
    themes: z.array(themeSelectionSchema).min(1, "코스 테마를 하나 이상 골라 주세요."),
    pace: paceSchema.default("normal"),
    travelMode: travelModeSchema.default("TRANSIT"),
    /** 1=이코노미 … 5=럭셔리 */
    lodgingTier: z.number().int().min(1).max(5).default(3),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "도착일은 출발일과 같거나 이후여야 합니다.",
    path: ["endDate"],
  })
  .refine((v) => nightsBetween(v.startDate, v.endDate) <= 14, {
    message: "한 번에 최대 15일까지 계획할 수 있습니다.",
    path: ["endDate"],
  });

export type TripRequest = z.infer<typeof tripRequestSchema>;
export type ThemeSelection = z.infer<typeof themeSelectionSchema>;

// ── 장소 후보 ──────────────────────────────────────────────────

export const placeCandidateSchema = z.object({
  placeId: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  /** 이 후보를 끌어온 테마 (식사 후보는 "food") */
  theme: themeIdSchema,
  address: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  userRatingCount: z.number().int().min(0).optional(),
  /** Places priceLevel 0~4 */
  priceLevel: z.number().int().min(0).max(4).optional(),
  primaryType: z.string().optional(),
  photoName: z.string().optional(),
  /** 1인 예상 비용 (KRW). 없으면 카테고리 기본값으로 추정. */
  estimatedCostKrw: z.number().int().min(0).optional(),
  /** restaurants.ts가 계산한 베이지안 가중 평점 */
  weightedScore: z.number().optional(),
});

export type PlaceCandidate = z.infer<typeof placeCandidateSchema>;

export const hotelCandidateSchema = z.object({
  hotelId: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  /** 1박 요금 (KRW). Amadeus 실요금 또는 등급 기반 추정. */
  pricePerNightKrw: z.number().int().min(0),
  /** 실제 요금인지 추정치인지 — UI에서 "추정" 배지로 구분 */
  priceIsEstimate: z.boolean().default(false),
  rating: z.number().min(0).max(5).optional(),
  address: z.string().optional(),
});

export type HotelCandidate = z.infer<typeof hotelCandidateSchema>;

// ── 생성 결과 ─────────────────────────────────────────────────

/** 테마별 확장 정보. 전부 optional — 해당 테마를 고르지 않으면 비어 있다. */
export const extrasSchema = z.object({
  learningGoal: z.string().optional(),
  background: z.string().optional(),
  ageFit: z.string().optional(),
  discussionPrompts: z.array(z.string()).optional(),
  signatureDish: z.string().optional(),
  reservationTip: z.string().optional(),
  era: z.string().optional(),
  historicalContext: z.string().optional(),
  bestSeason: z.string().optional(),
  difficulty: z.string().optional(),
  bestTimeOfDay: z.string().optional(),
  shootingTip: z.string().optional(),
  strollerFriendly: z.string().optional(),
  facilities: z.string().optional(),
  bookingRequired: z.string().optional(),
  duration: z.string().optional(),
});

export type Extras = z.infer<typeof extrasSchema>;

export const slotSchema = z.object({
  placeId: z.string(),
  name: z.string(),
  kind: slotKindSchema,
  theme: themeIdSchema,
  /** "09:30" */
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  /** 체류 시간(분) */
  stayMinutes: z.number().int().min(15).max(600),
  /** 1인 기준이 아닌 일행 전체 예상 비용 (KRW) */
  costKrw: z.number().int().min(0),
  /** 왜 이 장소인지 한 문장 */
  reason: z.string(),
  lat: z.number(),
  lng: z.number(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  photoName: z.string().optional(),
  extras: extrasSchema.optional(),
  /** 직전 일정에서 여기까지 오는 이동 (첫 일정은 없음) */
  travelFromPrev: z
    .object({
      minutes: z.number().int().min(0),
      meters: z.number().int().min(0),
      mode: travelModeSchema,
      /** 실제 경로 API 결과인지 직선거리 추정인지 */
      isEstimate: z.boolean(),
      /**
       * 페이스 기준 이동시간을 넘긴 구간.
       * 더 가까운 대안이 없어 어쩔 수 없이 남긴 경우이며,
       * 숨기지 않고 UI에서 눈에 띄게 표시한다.
       */
      exceedsTarget: z.boolean().optional(),
    })
    .optional(),
});

export type Slot = z.infer<typeof slotSchema>;

export const daySchema = z.object({
  date: z.string(),
  dayNumber: z.number().int().min(1),
  title: z.string(),
  slots: z.array(slotSchema),
  lodging: hotelCandidateSchema.nullable().optional(),
  /** 그날 총 이동시간(분) — 검증 단계에서 채운다 */
  totalTravelMinutes: z.number().int().min(0).default(0),
});

export type Day = z.infer<typeof daySchema>;

export const budgetBreakdownSchema = z.object({
  lodging: z.number().int().min(0),
  food: z.number().int().min(0),
  activity: z.number().int().min(0),
  reserve: z.number().int().min(0),
});

export type BudgetBreakdown = z.infer<typeof budgetBreakdownSchema>;

export const itinerarySchema = z.object({
  destination: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  summary: z.string(),
  /** 선택한 테마에 반응하는 마무리 요약 (예: "이번 여행에서 배우게 될 것") */
  highlights: z.array(z.object({ theme: themeIdSchema, title: z.string(), body: z.string() })),
  days: z.array(daySchema),
  budget: z.object({
    totalKrw: z.number().int().min(0),
    plannedKrw: z.number().int().min(0),
    limits: budgetBreakdownSchema,
    spent: budgetBreakdownSchema,
  }),
  themes: z.array(themeSelectionSchema),
  /** 실제 API를 쓰지 못하고 샘플 데이터로 만든 부분 */
  mockedSources: z.array(z.enum(["places", "hotels", "routes", "gemini"])),
});

export type Itinerary = z.infer<typeof itinerarySchema>;

// ── 유틸 ──────────────────────────────────────────────────────

export function nightsBetween(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** 여행 일수 (1박2일 = 2일). */
export function dayCount(start: string, end: string): number {
  return nightsBetween(start, end) + 1;
}

export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const total = dayCount(start, end);
  const base = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < total; i++) {
    out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** themes.ts의 ThemeId를 스키마 모듈에서도 그대로 재노출한다 (import 경로 단일화). */
export type { ThemeId } from "@/lib/themes";
