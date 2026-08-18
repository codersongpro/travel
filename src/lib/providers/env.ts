/**
 * 키 가용성 판단 — 서버 전용.
 *
 * 이 앱은 키가 하나도 없어도 전부 동작해야 한다.
 * 각 프로바이더는 여기서 키 유무를 확인하고, 없으면 목업으로 떨어진다.
 */

export type MockedSource = "places" | "hotels" | "routes" | "gemini";

function read(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export const serverEnv = {
  get geminiKey() {
    return read("GEMINI_API_KEY");
  },
  /** Places API (New) + Routes API 공용 키 */
  get mapsKey() {
    return read("GOOGLE_MAPS_API_KEY");
  },
  get amadeus() {
    const id = read("AMADEUS_CLIENT_ID");
    const secret = read("AMADEUS_CLIENT_SECRET");
    return id && secret ? { id, secret } : null;
  },
  get amadeusHost() {
    return read("AMADEUS_HOSTNAME") === "production"
      ? "https://api.amadeus.com"
      : "https://test.api.amadeus.com";
  },
};

/** 어떤 소스가 샘플 데이터로 동작 중인지 — UI 배너에 그대로 노출한다. */
export function mockedSources(): MockedSource[] {
  const mocked: MockedSource[] = [];
  if (!serverEnv.mapsKey) mocked.push("places", "routes");
  if (!serverEnv.amadeus) mocked.push("hotels");
  if (!serverEnv.geminiKey) mocked.push("gemini");
  return mocked;
}

export const MOCK_SOURCE_LABEL: Record<MockedSource, string> = {
  places: "장소 검색",
  routes: "이동시간",
  hotels: "숙소 요금",
  gemini: "일정 생성",
};
