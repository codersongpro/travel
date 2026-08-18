"use client";

import { ActivityCard, TravelLeg } from "./ActivityCard";
import { Badge, Card } from "@/components/ui";
import { formatDate, formatKrw, formatMinutes } from "@/lib/format";
import { getTheme } from "@/lib/themes";
import type { Day } from "@/lib/itinerary/schema";

/** 하루치 일정 — 시간 순 타임라인 + 그날 묵을 숙소. */
export function DayTimeline({ day, isLast }: { day: Day; isLast: boolean }) {
  // 한 날짜에 몇 개 테마가 섞였는지 — 테마 혼합이 실제로 됐는지 눈으로 확인되는 지표
  const themesToday = [...new Set(day.slots.filter((s) => s.theme !== "food").map((s) => s.theme))];

  return (
    <section className={`print-block ${isLast ? "" : ""}`} aria-labelledby={`day-${day.dayNumber}`}>
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] pb-3">
        <div>
          <h2 id={`day-${day.dayNumber}`} className="text-lg font-bold">
            {day.dayNumber}일차 · {formatDate(day.date)}
          </h2>
          <p className="text-sm text-[var(--muted)]">{day.title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {themesToday.map((t) => (
            <Badge key={t}>
              {getTheme(t).icon} {getTheme(t).label}
            </Badge>
          ))}
          {day.totalTravelMinutes > 0 && (
            <Badge tone="neutral">이동 {formatMinutes(day.totalTravelMinutes)}</Badge>
          )}
        </div>
      </header>

      {day.slots.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--muted)]">
          이 날짜에 배치할 수 있는 장소를 찾지 못했습니다.
        </p>
      ) : (
        day.slots.map((slot, i) => (
          <div key={`${slot.placeId}-${i}`}>
            {slot.travelFromPrev && <TravelLeg travel={slot.travelFromPrev} />}
            <ActivityCard slot={slot} />
          </div>
        ))
      )}

      {day.lodging && (
        <div className="flex gap-3">
          <div className="flex w-14 shrink-0 justify-center pt-1">
            <span className="text-lg" aria-hidden>
              🏨
            </span>
          </div>
          <Card className="mb-6 flex-1 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Badge>숙박</Badge>
                <h3 className="mt-1.5 text-base font-bold">{day.lodging.name}</h3>
              </div>
              <div className="text-right text-sm">
                <div className="font-semibold">{formatKrw(day.lodging.pricePerNightKrw)}</div>
                <div className="text-xs text-[var(--muted)]">
                  1박 {day.lodging.priceIsEstimate && "(추정)"}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}
