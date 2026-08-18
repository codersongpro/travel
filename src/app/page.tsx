"use client";

import { useEffect, useState } from "react";
import { TripForm } from "@/components/form/TripForm";
import { ItineraryView } from "@/components/itinerary/ItineraryView";
import { Card, Spinner } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { listSaved, removeSaved, type SavedItinerary } from "@/lib/storage";
import type { Itinerary, TripRequest } from "@/lib/itinerary/schema";

export default function HomePage() {
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedItinerary[]>([]);

  // localStorage는 브라우저에만 있으므로 마운트 후에 읽는다.
  useEffect(() => setSaved(listSaved()), []);

  const handleSubmit = async (req: TripRequest) => {
    setLoading(true);
    setError(null);
    setItinerary(null);

    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "일정을 만들지 못했습니다.");
      }

      setItinerary(data as Itinerary);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  if (itinerary) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <button
          onClick={() => setItinerary(null)}
          className="no-print mb-4 text-sm text-[var(--muted)] hover:text-teal-600"
        >
          ← 조건 바꿔서 다시 만들기
        </button>
        <ItineraryView itinerary={itinerary} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">여행 코스 플래너</h1>
        <p className="mt-2 leading-relaxed text-[var(--muted)]">
          날짜와 총예산, 원하는 코스 테마를 고르면 식당·액티비티·숙소까지 하루 동선으로 짜
          드립니다. 식당은 구글 지도 평점과 리뷰 수를 함께 반영해 고르고, 실제 이동시간을 계산해
          무리한 동선은 만들지 않습니다.
        </p>
      </header>

      {loading ? (
        <Card className="p-5">
          <Spinner label="장소를 찾고 이동 동선을 계산하는 중입니다…" />
        </Card>
      ) : (
        <TripForm onSubmit={handleSubmit} disabled={loading} />
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      {saved.length > 0 && !loading && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-[var(--muted)]">저장한 일정</h2>
          <div className="flex flex-col gap-2">
            {saved.map((s) => (
              <Card key={s.id} className="flex items-center justify-between gap-3 p-3.5">
                <button
                  onClick={() => setItinerary(s.itinerary)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="font-semibold">{s.itinerary.destination}</div>
                  <div className="text-xs text-[var(--muted)]">
                    {formatDate(s.itinerary.startDate)} · {s.itinerary.days.length}일
                  </div>
                </button>
                <button
                  onClick={() => {
                    removeSaved(s.id);
                    setSaved(listSaved());
                  }}
                  aria-label={`${s.itinerary.destination} 일정 삭제`}
                  className="rounded-md px-2 py-1 text-sm text-[var(--muted)] hover:bg-slate-500/10"
                >
                  삭제
                </button>
              </Card>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
