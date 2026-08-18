"use client";

import { Badge, Card } from "@/components/ui";
import { EXTRA_LABEL, getTheme, type ExtraField } from "@/lib/themes";
import { formatKrw, formatDistance, formatMinutes, formatRating, TRAVEL_MODE_LABEL } from "@/lib/format";
import type { Slot } from "@/lib/itinerary/schema";

/**
 * 일정 항목 카드.
 *
 * 확장 정보는 해당 테마를 골랐을 때만 채워져 있으므로,
 * 값이 있는 필드만 렌더한다 — 교육을 안 골랐으면 학습 목표 섹션 자체가 없다.
 */

const KIND_LABEL: Record<Slot["kind"], string> = {
  activity: "",
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  lodging: "숙박",
};

/** 배열로 오는 확장 필드 (질문 목록 등) */
const LIST_FIELDS: ReadonlySet<ExtraField> = new Set(["discussionPrompts"]);

export function ActivityCard({ slot }: { slot: Slot }) {
  const theme = getTheme(slot.theme);
  const isMeal = slot.kind === "lunch" || slot.kind === "dinner" || slot.kind === "breakfast";
  const rating = formatRating(slot.rating, slot.userRatingCount);

  const extras = slot.extras
    ? (Object.entries(slot.extras) as [ExtraField, string | string[]][]).filter(
        ([, v]) => v && (Array.isArray(v) ? v.length > 0 : v.trim() !== ""),
      )
    : [];

  return (
    <div className="print-block flex gap-3">
      {/* 타임라인 축 */}
      <div className="flex w-14 shrink-0 flex-col items-center pt-1">
        <time className="text-sm font-bold tabular-nums">{slot.startTime}</time>
        <span className="mt-1 text-lg leading-none" aria-hidden>
          {theme.icon}
        </span>
        <div className="mt-1 w-px flex-1 bg-[var(--border)]" aria-hidden />
      </div>

      <Card className="mb-3 flex-1 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {KIND_LABEL[slot.kind] && <Badge tone="brand">{KIND_LABEL[slot.kind]}</Badge>}
              <Badge>
                {theme.icon} {theme.label}
              </Badge>
            </div>
            <h3 className="mt-1.5 text-base font-bold">{slot.name}</h3>
          </div>

          <div className="text-right text-sm">
            <div className="font-semibold">{formatKrw(slot.costKrw)}</div>
            <div className="text-xs text-[var(--muted)]">{formatMinutes(slot.stayMinutes)} 체류</div>
          </div>
        </div>

        {/* 식당은 추천 근거인 평점·리뷰 수를 반드시 보여준다 */}
        {rating && (
          <p className={`mt-2 text-sm ${isMeal ? "font-medium text-amber-600 dark:text-amber-400" : "text-[var(--muted)]"}`}>
            {rating}
          </p>
        )}

        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{slot.reason}</p>

        {extras.length > 0 && (
          <dl className="mt-3 flex flex-col gap-2 rounded-xl bg-slate-500/5 p-3 text-sm">
            {extras.map(([field, value]) => (
              <div key={field} className="flex flex-col gap-0.5">
                <dt className="text-xs font-semibold text-[var(--muted)]">
                  {EXTRA_LABEL[field] ?? field}
                </dt>
                <dd>
                  {LIST_FIELDS.has(field) || Array.isArray(value) ? (
                    <ul className="list-inside list-disc space-y-0.5">
                      {(Array.isArray(value) ? value : [value]).map((item, i) => (
                        <li key={i} className="leading-relaxed">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="leading-relaxed">{value}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}

/** 일정 사이의 이동 표시. 추정치인지 실제 경로인지 구분해서 보여준다. */
export function TravelLeg({ travel }: { travel: NonNullable<Slot["travelFromPrev"]> }) {
  const mode = TRAVEL_MODE_LABEL[travel.mode];

  return (
    <div
      className={`mb-3 flex flex-wrap items-center gap-2 pl-14 text-xs ${
        travel.exceedsTarget
          ? "font-medium text-amber-600 dark:text-amber-400"
          : "text-[var(--muted)]"
      }`}
    >
      <span aria-hidden>{mode.icon}</span>
      <span>
        {mode.label} {formatMinutes(travel.minutes)}
        {travel.meters > 0 && ` · ${formatDistance(travel.meters)}`}
      </span>
      {travel.isEstimate && <span className="opacity-60">(추정)</span>}
      {/* 더 가까운 대안이 없어 남긴 구간 — 숨기지 않고 알린다 */}
      {travel.exceedsTarget && <span>· 이동이 다소 깁니다</span>}
    </div>
  );
}
