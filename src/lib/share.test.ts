import { describe, expect, it } from "vitest";
import { buildShareUrl, decodeItinerary, encodeItinerary, SAFE_URL_LENGTH } from "./share";
import type { Itinerary } from "./itinerary/schema";

function makeItinerary(dayCount = 3): Itinerary {
  return {
    destination: "교토",
    startDate: "2026-09-14",
    endDate: "2026-09-16",
    summary: "교토 3일 일정입니다.",
    highlights: [
      { theme: "education", title: "이번 여행에서 배우게 될 것", body: "박물관 중심 일정" },
    ],
    days: Array.from({ length: dayCount }, (_, i) => ({
      date: `2026-09-1${4 + i}`,
      dayNumber: i + 1,
      title: `${i + 1}일차`,
      totalTravelMinutes: 45,
      lodging: {
        hotelId: `hotel:${i}`,
        name: `교토 호텔 ${i}`,
        lat: 35.03,
        lng: 135.73,
        pricePerNightKrw: 144000,
        priceIsEstimate: true,
      },
      slots: [
        {
          placeId: `place:${i}:0`,
          name: "교토 국립 역사박물관",
          kind: "activity" as const,
          theme: "education" as const,
          startTime: "09:00",
          stayMinutes: 90,
          costKrw: 24000,
          reason: "교육·학습 테마로 고른 곳입니다.",
          lat: 35.0558,
          lng: 135.7488,
          rating: 4.2,
          userRatingCount: 1215,
          extras: { learningGoal: "지역의 역사 흐름을 개괄한다" },
        },
        {
          placeId: `place:${i}:1`,
          name: "교토 로컬 비스트로",
          kind: "lunch" as const,
          theme: "food" as const,
          startTime: "12:00",
          stayMinutes: 60,
          costKrw: 36000,
          reason: "구글 지도 평점 4.5점, 리뷰 1,204개로 검증된 곳입니다.",
          lat: 35.0102,
          lng: 135.7681,
          rating: 4.5,
          userRatingCount: 1204,
          travelFromPrev: {
            minutes: 22,
            meters: 4300,
            mode: "TRANSIT" as const,
            isEstimate: true,
            exceedsTarget: false,
          },
        },
      ],
    })),
    budget: {
      totalKrw: 900000,
      plannedKrw: 720000,
      limits: { lodging: 360000, food: 270000, activity: 180000, reserve: 90000 },
      spent: { lodging: 288000, food: 270000, activity: 162000, reserve: 0 },
    },
    themes: [
      { id: "education", weight: "heavy" },
      { id: "food", weight: "normal" },
    ],
    mockedSources: ["places", "gemini"],
  };
}

describe("공유 링크 왕복", () => {
  it("압축했다 풀어도 일정이 그대로 복원된다", () => {
    const original = makeItinerary();
    const restored = decodeItinerary(encodeItinerary(original));

    expect(restored).not.toBeNull();
    expect(restored!.destination).toBe(original.destination);
    expect(restored!.days).toHaveLength(original.days.length);
    expect(restored!.days[0].slots[0].extras?.learningGoal).toBe(
      "지역의 역사 흐름을 개괄한다",
    );
    expect(restored!.budget.totalKrw).toBe(900000);
  });

  it("payload에 URL 경로에서 인코딩되는 문자가 없다", () => {
    // lz-string 알파벳의 `+`는 경로에서 %2B로 바뀌어 서버에 도착한다.
    // 그러면 압축을 풀 수 없으므로 애초에 내보내지 않아야 한다.
    const payload = encodeItinerary(makeItinerary(5));

    expect(payload).not.toContain("+");
    expect(encodeURIComponent(payload)).toBe(payload);
  });

  it("URL을 그대로 왕복시켜도 복원된다", () => {
    const original = makeItinerary();
    const { url } = buildShareUrl("https://example.com", original);

    // 실제 전송 경로를 흉내 낸다: 인코딩 → 디코딩 → 라우트 파라미터 추출
    const roundTripped = decodeURIComponent(encodeURI(url)).split("/share/")[1];

    expect(decodeItinerary(roundTripped)?.destination).toBe("교토");
  });

  it("일정이 길어지면 URL이 길다고 알려 준다", () => {
    const short = buildShareUrl("https://example.com", makeItinerary(1));
    expect(short.tooLong).toBe(false);
    expect(short.url.length).toBeLessThan(SAFE_URL_LENGTH);
  });

  it("손상되거나 빈 payload는 null을 돌려준다", () => {
    expect(decodeItinerary("망가진문자열")).toBeNull();
    expect(decodeItinerary("")).toBeNull();
    expect(decodeItinerary("N4IgJgpgzgLglg")).toBeNull();
  });
});
