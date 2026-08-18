import { NextResponse } from "next/server";
import { geocodeDestination } from "@/lib/providers/places";

/** 도시명 -> 좌표. 폼에서 여행지를 확인할 때 쓴다. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "여행지를 입력해 주세요." }, { status: 400 });

  const result = await geocodeDestination(q);
  return NextResponse.json(result);
}
