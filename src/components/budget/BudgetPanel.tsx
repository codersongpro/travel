"use client";

import { Card } from "@/components/ui";
import { BUDGET_LABEL, evaluateBudget } from "@/lib/itinerary/budget";
import { formatKrw, formatKrwShort } from "@/lib/format";
import type { Itinerary } from "@/lib/itinerary/schema";

/**
 * 예산 실시간 배분 패널.
 *
 * 카테고리별 상한과 실제 계획 금액을 나란히 보여주고,
 * 초과한 항목은 즉시 경고와 함께 조정 방법을 제안한다.
 */

const CATEGORY_COLOR = {
  lodging: "bg-indigo-500",
  food: "bg-rose-500",
  activity: "bg-teal-500",
  reserve: "bg-slate-400",
} as const;

/** 초과 시 무엇을 바꾸면 되는지 — 사용자가 다음 행동을 알 수 있게. */
const OVER_HINT = {
  lodging: "숙소 등급을 한 단계 낮추면 여유가 생깁니다.",
  food: "식비 비중이 높습니다. 한 끼를 가벼운 곳으로 바꿔 보세요.",
  activity: "유료 입장 시설이 많습니다. 자연·산책 테마를 늘리면 줄어듭니다.",
} as const;

export function BudgetPanel({ itinerary }: { itinerary: Itinerary }) {
  const { totalKrw, limits, spent } = itinerary.budget;
  const status = evaluateBudget(totalKrw, limits, spent);
  const remaining = totalKrw - status.plannedKrw;

  const categories = (["lodging", "food", "activity"] as const).map((key) => ({
    key,
    label: BUDGET_LABEL[key],
    limit: limits[key],
    used: spent[key],
    ratio: limits[key] > 0 ? Math.min(1.5, spent[key] / limits[key]) : 0,
    over: status.overBy[key],
  }));

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--muted)]">총예산 대비</h2>
          <p className="text-2xl font-bold">
            {formatKrw(status.plannedKrw)}
            <span className="ml-1.5 text-base font-normal text-[var(--muted)]">
              / {formatKrwShort(totalKrw)}
            </span>
          </p>
        </div>
        <p
          className={`text-sm font-semibold ${
            remaining >= 0 ? "text-teal-600 dark:text-teal-400" : "text-rose-600 dark:text-rose-400"
          }`}
        >
          {remaining >= 0
            ? `${formatKrwShort(remaining)} 남음`
            : `${formatKrwShort(-remaining)} 초과`}
        </p>
      </div>

      {/* 전체 사용률 막대 — 카테고리별로 색을 나눠 한눈에 비중이 보이게 */}
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-slate-500/15"
        role="img"
        aria-label={`예산 ${Math.round((status.plannedKrw / Math.max(1, totalKrw)) * 100)}% 사용`}
      >
        {categories.map((c) => (
          <div
            key={c.key}
            className={CATEGORY_COLOR[c.key]}
            style={{ width: `${Math.min(100, (c.used / Math.max(1, totalKrw)) * 100)}%` }}
          />
        ))}
      </div>

      <dl className="flex flex-col gap-3">
        {categories.map((c) => (
          <div key={c.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-sm">
              <dt className="flex items-center gap-1.5 font-medium">
                <span className={`h-2.5 w-2.5 rounded-full ${CATEGORY_COLOR[c.key]}`} aria-hidden />
                {c.label}
              </dt>
              <dd className="tabular-nums text-[var(--muted)]">
                <span className={c.over ? "font-semibold text-rose-600 dark:text-rose-400" : ""}>
                  {formatKrwShort(c.used)}
                </span>
                {" / "}
                {formatKrwShort(c.limit)}
              </dd>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-500/10">
              <div
                className={`h-full ${c.over ? "bg-rose-500" : CATEGORY_COLOR[c.key]}`}
                style={{ width: `${Math.min(100, c.ratio * 100)}%` }}
              />
            </div>
            {c.over && (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                {formatKrwShort(c.over)} 초과 — {OVER_HINT[c.key]}
              </p>
            )}
          </div>
        ))}
      </dl>

      <p className="text-xs text-[var(--muted)]">
        예비비 {formatKrwShort(limits.reserve)}는 교통·기념품 등 계획에 잡히지 않는 지출을 위해
        따로 남겨 둔 금액입니다.
      </p>
    </Card>
  );
}
