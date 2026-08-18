import { EXTRA_LABEL, getTheme, WEIGHT_LABEL, type ExtraField } from "@/lib/themes";
import { PACE_LIMITS, PACE_SLOTS, type TravelMatrix } from "./routing";
import type {
  BudgetBreakdown,
  HotelCandidate,
  PlaceCandidate,
  TripRequest,
} from "./schema";
import { dayCount, eachDate } from "./schema";
import { partySize } from "./budget";

/**
 * Gemini 프롬프트 빌더.
 *
 * 핵심 방침: 모델에게 "알아서 잘 해줘"라고 맡기는 부분을 최소화한다.
 * 후보 목록, 이동시간 행렬, 예산 상한을 전부 데이터로 넘기고
 * 모델은 그 안에서 조합만 하게 한다.
 */

export interface PromptInput {
  request: TripRequest;
  destination: string;
  candidatesByTheme: Map<string, PlaceCandidate[]>;
  /** 이미 가중 점수순으로 정렬된 식당 후보 */
  rankedRestaurants: PlaceCandidate[];
  hotels: HotelCandidate[];
  matrix: TravelMatrix;
  limits: BudgetBreakdown;
  maxLodgingPerNight: number;
}

/** 후보를 토큰 낭비 없이 표 형태로 압축. */
function formatCandidates(list: readonly PlaceCandidate[]): string {
  return list
    .map((c) => {
      const parts = [
        `id=${c.placeId}`,
        `이름=${c.name}`,
        `좌표=${c.lat.toFixed(4)},${c.lng.toFixed(4)}`,
      ];
      if (c.rating !== undefined) {
        parts.push(`평점=${c.rating}(리뷰 ${c.userRatingCount ?? 0}개)`);
      }
      if (c.weightedScore !== undefined) {
        parts.push(`가중점수=${c.weightedScore.toFixed(2)}`);
      }
      if (c.estimatedCostKrw !== undefined) parts.push(`1인예상=${c.estimatedCostKrw}원`);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}

/**
 * 이동시간 행렬을 프롬프트에 넣는다.
 * 전부 넣으면 토큰이 폭발하므로 30분 이내로 닿는 쌍만 추린다
 * — 어차피 그 밖은 제약상 연결하면 안 되는 구간이다.
 */
function formatMatrix(
  matrix: TravelMatrix,
  places: readonly PlaceCandidate[],
  legLimit: number,
): string {
  const lines: string[] = [];
  for (const from of places) {
    const reachable = places
      .filter((to) => to.placeId !== from.placeId)
      .map((to) => ({ to, leg: matrix.get(from.placeId, to.placeId) }))
      .filter(({ leg }) => leg.minutes <= legLimit)
      .sort((a, b) => a.leg.minutes - b.leg.minutes)
      .slice(0, 8);

    if (reachable.length === 0) continue;
    lines.push(
      `${from.placeId}: ${reachable.map(({ to, leg }) => `${to.placeId}(${leg.minutes}분)`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

/** 선택한 테마들이 요구하는 확장 필드만 설명한다. */
function formatExtras(fields: readonly ExtraField[]): string {
  if (fields.length === 0) return "";
  const guide: Partial<Record<ExtraField, string>> = {
    learningGoal: "이곳에서 무엇을 배우고 알게 되는지 한 문장",
    background: "방문 전에 알고 가면 좋은 배경지식 한 문장",
    ageFit: "동반 아동 연령에 맞춰 어디를 어떻게 보면 좋은지",
    discussionPrompts: "현장에서 아이와 나눌 만한 질문 2~3개",
    signatureDish: "이 집의 대표 메뉴",
    reservationTip: "예약·웨이팅 관련 실용 팁",
    era: "이 유적이 속한 시대",
    historicalContext: "이곳에서 일어난 일과 그 의미",
    bestSeason: "방문하기 좋은 계절",
    difficulty: "도보 난이도 (평이/보통/힘듦)",
    bestTimeOfDay: "사진·감상에 가장 좋은 시간대",
    shootingTip: "촬영 각도나 구도 팁",
    strollerFriendly: "유모차 접근이 가능한지",
    facilities: "수유실·유아의자 등 편의시설",
    bookingRequired: "사전 예약이 필요한지",
    duration: "권장 소요 시간",
  };

  return fields.map((f) => `  - ${f} (${EXTRA_LABEL[f]}): ${guide[f] ?? ""}`).join("\n");
}

export function buildPrompt(input: PromptInput): string {
  const { request: req, matrix, limits } = input;
  const days = dayCount(req.startDate, req.endDate);
  const dates = eachDate(req.startDate, req.endDate);
  const people = partySize(req);
  const pace = PACE_LIMITS[req.pace];
  const slotsPerDay = PACE_SLOTS[req.pace];

  const themeLines = req.themes
    .map((t) => {
      const def = getTheme(t.id);
      const count = input.candidatesByTheme.get(t.id)?.length ?? 0;
      return `- ${def.icon} ${def.label} (id: ${t.id}) — 비중 "${WEIGHT_LABEL[t.weight]}", 후보 ${count}곳`;
    })
    .join("\n");

  const activityCandidates = req.themes
    .filter((t) => t.id !== "food")
    .map((t) => {
      const list = input.candidatesByTheme.get(t.id) ?? [];
      if (list.length === 0) return "";
      return `### ${getTheme(t.id).label} (theme=${t.id})\n${formatCandidates(list)}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const allPlaces = [
    ...[...input.candidatesByTheme.values()].flat(),
    ...input.rankedRestaurants,
  ];

  const extras = formatExtras(
    [...new Set(req.themes.flatMap((t) => getTheme(t.id).extras))],
  );

  const childInfo =
    req.childAges.length > 0
      ? `성인 ${req.adults}명 + 아동 ${req.childAges.length}명(만 ${req.childAges.join(", ")}세)`
      : `성인 ${req.adults}명`;

  return `당신은 실제 데이터만 가지고 여행 일정을 짜는 여행 플래너입니다.
아래 후보 목록에 없는 장소는 절대 만들어내지 마세요.

# 여행 조건
- 여행지: ${input.destination}
- 기간: ${req.startDate} ~ ${req.endDate} (${days}일)
- 날짜별로 반드시 이 순서대로 ${days}일치를 만드세요: ${dates.join(", ")}
- 인원: ${childInfo}
- 이동 수단: ${req.travelMode === "TRANSIT" ? "대중교통" : req.travelMode === "DRIVE" ? "차량" : "도보"}
- 여행 페이스: ${req.pace} (하루 활동 ${slotsPerDay}개 + 점심 1 + 저녁 1)

# 선택한 코스 테마
${themeLines}

**테마 혼합 규칙 (가장 중요)**
- 하루 안에서 여러 테마를 섞으세요. 예: 오전 박물관 → 점심 맛집 → 오후 공원 → 저녁 맛집
- 테마별로 날짜를 통째로 나누지 마세요. "1일차=교육일, 2일차=미식일" 같은 구성은 금지입니다.
- 비중이 "집중"인 테마는 더 자주, "가볍게"인 테마는 드물게 배치하되, 선택한 모든 테마가 최소 1번은 등장해야 합니다.
- 선택하지 않은 테마의 장소는 넣지 마세요.

# 이동거리 제약 (반드시 준수)
- 연속한 두 일정 사이 이동시간은 ${pace.legMinutes}분 이내
- 하루 총 이동시간은 ${pace.dayMinutes}분 이내
- 왔던 곳으로 되돌아가는 왕복 동선 금지. 한 방향으로 흐르게 배치하세요.
- 아래 "이동시간표"에 없는 조합은 ${pace.legMinutes}분을 넘는다는 뜻이므로 연결하지 마세요.

## 이동시간표 (${req.travelMode} 기준, ${pace.legMinutes}분 이내만 표시)
${formatMatrix(matrix, allPlaces, pace.legMinutes) || "(데이터 없음 — 좌표상 가까운 곳끼리 묶으세요)"}

# 예산 제약 (${people}명 전체 기준, 원화)
- 액티비티 총 상한: ${limits.activity.toLocaleString("ko-KR")}원
- 식비 총 상한: ${limits.food.toLocaleString("ko-KR")}원
- costKrw는 1인이 아니라 **일행 ${people}명 전체 비용**으로 적으세요.
- 각 카테고리 합계가 상한을 넘지 않게 하세요.

# 식당 선택 규칙
아래 식당 후보는 이미 "구글 지도 평점 x 리뷰 수"를 반영한 가중점수 내림차순으로 정렬돼 있습니다.
점심(lunch)과 저녁(dinner)은 **목록 위쪽에서 우선 고르되**, 그 시간대 직전 일정에서 이동시간 제약을 만족하는 곳으로 고르세요.
같은 식당을 여행 기간 중 두 번 넣지 마세요.

## 식당 후보 (가중점수 높은 순)
${formatCandidates(input.rankedRestaurants)}

# 활동 후보
${activityCandidates || "(활동 후보 없음)"}

# 숙소 후보 (1박 요금, 1박 상한 ${input.maxLodgingPerNight.toLocaleString("ko-KR")}원)
${input.hotels
  .map((h) => `- id=${h.hotelId} | 이름=${h.name} | 1박=${h.pricePerNightKrw}원 | 좌표=${h.lat.toFixed(4)},${h.lng.toFixed(4)}`)
  .join("\n")}
마지막 날을 제외한 각 날짜에 숙소를 하나씩 배정하세요. 그날 마지막 일정에서 가까운 곳으로 고르세요.

# 각 일정 항목에 채울 확장 정보
선택한 테마에 해당하는 항목에만 아래 필드를 채우세요. 해당 없으면 비워 두세요.
${extras || "  (없음)"}

# 출력 규칙
- placeId는 반드시 위 후보 목록의 id를 그대로 쓰세요. 새로 지어내면 안 됩니다.
- theme은 그 장소가 속한 테마 id를 쓰세요. 식당은 "food"입니다.
- startTime은 "HH:MM" 24시간 형식입니다. 첫 일정은 09:00 이후, 마지막은 21:00 이전으로 잡으세요.
- reason은 왜 이 장소를 여기에 넣었는지 한국어 한 문장으로 쓰세요.
- summary와 highlights는 선택한 테마에 맞춰 쓰세요. 예를 들어 교육 테마를 골랐다면 "이번 여행에서 배우게 될 것"을, 미식을 골랐다면 "꼭 먹어봐야 할 것"을 다루세요.
- 모든 텍스트는 한국어로 작성하세요.`;
}
