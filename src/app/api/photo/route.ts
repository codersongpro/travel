import { NextResponse } from "next/server";
import { fetchPhotoUrl } from "@/lib/providers/places";

/**
 * Places 사진 프록시.
 * 사진 URL을 얻으려면 API 키가 필요한데 키를 브라우저에 내보낼 수 없으므로
 * 서버가 대신 조회해 최종 이미지 URL로 리다이렉트한다.
 */
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name");
  if (!name || !name.startsWith("places/")) {
    return NextResponse.json({ error: "잘못된 사진 이름입니다." }, { status: 400 });
  }

  const url = await fetchPhotoUrl(name);
  if (!url) return NextResponse.json({ error: "사진을 찾을 수 없습니다." }, { status: 404 });

  return NextResponse.redirect(url);
}
