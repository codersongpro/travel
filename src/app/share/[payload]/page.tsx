import Link from "next/link";
import { ItineraryView } from "@/components/itinerary/ItineraryView";
import { Card } from "@/components/ui";
import { decodeItinerary } from "@/lib/share";

/**
 * 공유 링크 — 일정 전체가 URL 안에 압축돼 있다.
 * 서버도 DB도 필요 없고, 링크를 가진 사람이면 누구나 열 수 있다.
 */
export default async function SharePage({
  params,
}: {
  params: Promise<{ payload: string }>;
}) {
  const { payload } = await params;
  const itinerary = decodeItinerary(payload);

  if (!itinerary) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <Card className="p-8 text-center">
          <h1 className="text-xl font-bold">일정을 불러올 수 없습니다</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            링크가 잘렸거나 손상된 것 같습니다. 공유해 준 사람에게 링크를 다시 받아 보세요.
          </p>
          <Link
            href="/"
            className="mt-5 inline-block rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700"
          >
            새 일정 만들기
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/" className="no-print mb-4 inline-block text-sm text-[var(--muted)] hover:text-teal-600">
        ← 나도 일정 만들기
      </Link>
      <ItineraryView itinerary={itinerary} readOnly />
    </main>
  );
}
