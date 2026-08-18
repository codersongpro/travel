import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { serverEnv } from "./env";

/**
 * Gemini 일정 생성 — 서버 전용.
 *
 * responseSchema로 구조를 강제해서 파싱 실패를 없앤다.
 * 키가 없거나 호출이 실패하면 null을 반환하고,
 * 호출자는 규칙 기반 폴백 일정으로 넘어간다.
 */

const MODEL = "gemini-2.5-flash";

/** 모델이 채워야 할 일정 구조. zod 스키마(schema.ts)와 형태를 맞춰 둔다. */
const responseSchema: Schema = {
  type: Type.OBJECT,
  required: ["summary", "highlights", "days"],
  properties: {
    summary: {
      type: Type.STRING,
      description: "이 여행이 어떤 여행인지 2~3문장 한국어 요약",
    },
    highlights: {
      type: Type.ARRAY,
      description: "선택한 테마별 마무리 요약. 고른 테마 수만큼.",
      items: {
        type: Type.OBJECT,
        required: ["theme", "title", "body"],
        properties: {
          theme: { type: Type.STRING },
          title: { type: Type.STRING, description: '예: "이번 여행에서 배우게 될 것"' },
          body: { type: Type.STRING },
        },
      },
    },
    days: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["date", "dayNumber", "title", "slots"],
        properties: {
          date: { type: Type.STRING, description: "YYYY-MM-DD" },
          dayNumber: { type: Type.INTEGER },
          title: { type: Type.STRING, description: "그날의 성격을 담은 짧은 제목" },
          lodgingId: {
            type: Type.STRING,
            description: "그날 묵을 숙소 id. 마지막 날은 비움.",
          },
          slots: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["placeId", "kind", "theme", "startTime", "stayMinutes", "costKrw", "reason"],
              properties: {
                placeId: { type: Type.STRING, description: "후보 목록의 id 그대로" },
                kind: {
                  type: Type.STRING,
                  enum: ["activity", "breakfast", "lunch", "dinner"],
                },
                theme: { type: Type.STRING },
                startTime: { type: Type.STRING, description: "HH:MM" },
                stayMinutes: { type: Type.INTEGER },
                costKrw: { type: Type.INTEGER, description: "일행 전체 비용" },
                reason: { type: Type.STRING },
                extras: {
                  type: Type.OBJECT,
                  description: "선택한 테마에 해당할 때만 채움",
                  properties: {
                    learningGoal: { type: Type.STRING },
                    background: { type: Type.STRING },
                    ageFit: { type: Type.STRING },
                    discussionPrompts: { type: Type.ARRAY, items: { type: Type.STRING } },
                    signatureDish: { type: Type.STRING },
                    reservationTip: { type: Type.STRING },
                    era: { type: Type.STRING },
                    historicalContext: { type: Type.STRING },
                    bestSeason: { type: Type.STRING },
                    difficulty: { type: Type.STRING },
                    bestTimeOfDay: { type: Type.STRING },
                    shootingTip: { type: Type.STRING },
                    strollerFriendly: { type: Type.STRING },
                    facilities: { type: Type.STRING },
                    bookingRequired: { type: Type.STRING },
                    duration: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

/** Gemini가 돌려주는 원시 구조 — 검증 전이라 아직 신뢰할 수 없다. */
export interface RawGeminiPlan {
  summary: string;
  highlights: { theme: string; title: string; body: string }[];
  days: {
    date: string;
    dayNumber: number;
    title: string;
    lodgingId?: string;
    slots: {
      placeId: string;
      kind: string;
      theme: string;
      startTime: string;
      stayMinutes: number;
      costKrw: number;
      reason: string;
      extras?: Record<string, unknown>;
    }[];
  }[];
}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI | null {
  const key = serverEnv.geminiKey;
  if (!key) return null;
  client ??= new GoogleGenAI({ apiKey: key });
  return client;
}

export function isGeminiAvailable(): boolean {
  return serverEnv.geminiKey !== null;
}

/**
 * 프롬프트를 보내고 구조화된 일정을 받는다.
 * 실패하면 null — 호출자가 규칙 기반 폴백으로 넘어간다.
 */
export async function generatePlan(prompt: string): Promise<RawGeminiPlan | null> {
  const ai = getClient();
  if (!ai) return null;

  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.7,
      },
    });

    const text = res.text;
    if (!text) throw new Error("응답이 비어 있습니다.");

    return JSON.parse(text) as RawGeminiPlan;
  } catch (err) {
    console.warn("[gemini] 일정 생성 실패, 규칙 기반 일정으로 대체:", err);
    return null;
  }
}
