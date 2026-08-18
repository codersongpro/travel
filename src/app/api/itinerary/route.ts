import { NextResponse } from "next/server";
import { generateItinerary } from "@/lib/itinerary/generate";
import { tripRequestSchema } from "@/lib/itinerary/schema";

/** 일정 생성 — 외부 API 키는 전부 여기(서버)에서만 쓰인다. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }

  const parsed = tripRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "입력값을 확인해 주세요.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const itinerary = await generateItinerary(parsed.data);
    return NextResponse.json(itinerary);
  } catch (err) {
    console.error("[api/itinerary] 생성 실패:", err);
    return NextResponse.json(
      { error: "일정을 만드는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
