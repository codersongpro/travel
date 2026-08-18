"use client";

import { useState } from "react";
import { DayTimeline } from "./DayTimeline";
import { BudgetPanel } from "@/components/budget/BudgetPanel";
import { MapView } from "@/components/map/MapView";
import { Badge, Card } from "@/components/ui";
import { getTheme } from "@/lib/themes";
import { MOCK_SOURCE_LABEL } from "@/lib/providers/env";
import { formatDate, formatKrwShort } from "@/lib/format";
import { buildShareUrl } from "@/lib/share";
import { saveItinerary } from "@/lib/storage";
import type { Itinerary } from "@/lib/itinerary/schema";

type Tab = "days" | "map" | "budget";

const TABS: { id: Tab; label: string }[] = [
  { id: "days", label: "일정" },
  { id: "map", label: "지도" },
  { id: "budget", label: "예산" },
];

export function ItineraryView({
  itinerary,
  readOnly = false,
}: {
  itinerary: Itinerary;
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("days");
  const [notice, setNotice] = useState<string | null>(null);

  const handleShare = async () => {
    const { url, tooLong } = buildShareUrl(window.location.origin, itinerary);
    try {
      await navigator.clipboard.writeText(url);
      setNotice(
        tooLong
          ? "링크를 복사했지만 일정이 길어 URL이 깁니다. 일부 메신저에서 잘릴 수 있습니다."
          : "공유 링크를 복사했습니다.",
      );
    } catch {
      // 클립보드 권한이 없는 환경 — 링크를 직접 보여준다.
      setNotice(url);
    }
  };

  const handleSave = () => {
    saveItinerary(itinerary);
    setNotice("이 브라우저에 일정을 저장했습니다.");
  };

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{itinerary.destination} 여행</h1>
            <p className="text-sm text-[var(--muted)]">
              {formatDate(itinerary.startDate)} – {formatDate(itinerary.endDate)} ·{" "}
              {itinerary.days.length}일 · 예산 {formatKrwShort(itinerary.budget.totalKrw)}
            </p>
          </div>

          <div className="no-print flex flex-wrap gap-2">
            {!readOnly && (
              <button
                onClick={handleSave}
                className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-sm font-medium hover:bg-slate-500/8"
              >
                저장
              </button>
            )}
            <button
              onClick={handleShare}
              className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-sm font-medium hover:bg-slate-500/8"
            >
              공유 링크
            </button>
            <button
              onClick={() => window.print()}
              className="rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              PDF로 저장
            </button>
          </div>
        </div>

        <p className="mt-3 leading-relaxed">{itinerary.summary}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {itinerary.themes.map((t) => (
            <Badge key={t.id} tone="brand">
              {getTheme(t.id).icon} {getTheme(t.id).label}
            </Badge>
          ))}
        </div>

        {itinerary.mockedSources.length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <strong>샘플 데이터 사용 중</strong> —{" "}
            {itinerary.mockedSources.map((s) => MOCK_SOURCE_LABEL[s]).join(", ")}은(는) 실제 API
            대신 샘플로 동작했습니다. .env에 해당 키를 넣으면 실제 데이터로 바뀝니다.
          </p>
        )}
      </Card>

      {notice && (
        <p
          role="status"
          className="no-print rounded-xl bg-teal-500/10 px-4 py-3 text-sm break-all text-teal-700 dark:text-teal-300"
        >
          {notice}
        </p>
      )}

      <div className="no-print flex gap-1.5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.id
                ? "bg-teal-600 text-white"
                : "bg-slate-500/8 text-[var(--muted)] hover:bg-slate-500/15"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 인쇄할 때는 탭과 무관하게 일정 전체가 나와야 한다 */}
      <div className={tab === "days" ? "" : "hidden print:block"}>
        <div className="flex flex-col gap-2">
          {itinerary.days.map((day, i) => (
            <DayTimeline key={day.date} day={day} isLast={i === itinerary.days.length - 1} />
          ))}
        </div>

        {itinerary.highlights.length > 0 && (
          <Card className="print-block mt-4 flex flex-col gap-4 p-5">
            <h2 className="text-lg font-bold">여행을 마치며</h2>
            {itinerary.highlights.map((h, i) => (
              <div key={i}>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <span aria-hidden>{getTheme(h.theme).icon}</span>
                  {h.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{h.body}</p>
              </div>
            ))}
          </Card>
        )}
      </div>

      {tab === "map" && (
        <div className="no-print">
          <MapView days={itinerary.days} />
        </div>
      )}

      {tab === "budget" && (
        <div className="no-print">
          <BudgetPanel itinerary={itinerary} />
        </div>
      )}
    </div>
  );
}
