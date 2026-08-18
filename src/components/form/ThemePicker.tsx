"use client";

import { THEMES, WEIGHT_LABEL, type ThemeId, type ThemeWeight } from "@/lib/themes";
import type { ThemeSelection } from "@/lib/itinerary/schema";

/**
 * 코스 테마 선택.
 *
 * 교육을 포함해 14개 테마를 동등하게 늘어놓고 다중 선택하게 한다.
 * 가중치는 "일정에 몇 번 등장할지"만 조절한다 — 테마별로 날짜를
 * 가르는 용도가 아니다.
 */

const WEIGHTS: ThemeWeight[] = ["light", "normal", "heavy"];

export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeSelection[];
  onChange: (next: ThemeSelection[]) => void;
}) {
  const selected = new Map(value.map((v) => [v.id, v.weight]));

  const toggle = (id: ThemeId) => {
    onChange(
      selected.has(id)
        ? value.filter((v) => v.id !== id)
        : [...value, { id, weight: "normal" as ThemeWeight }],
    );
  };

  const setWeight = (id: ThemeId, weight: ThemeWeight) => {
    onChange(value.map((v) => (v.id === id ? { ...v, weight } : v)));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">코스 테마</h2>
          <p className="text-xs text-[var(--muted)]">
            여러 개를 고르면 하루 안에서 섞어서 배치합니다. 테마별로 날짜를 나누지 않습니다.
          </p>
        </div>
        <span className="text-xs text-[var(--muted)]">{value.length}개 선택</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {THEMES.map((theme) => {
          const weight = selected.get(theme.id);
          const isOn = weight !== undefined;

          return (
            <div
              key={theme.id}
              className={`rounded-xl border p-3 transition ${
                isOn
                  ? "border-teal-500 bg-teal-500/8 shadow-sm"
                  : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              <button
                type="button"
                onClick={() => toggle(theme.id)}
                aria-pressed={isOn}
                className="flex w-full flex-col items-start gap-1 text-left"
              >
                <span className="text-xl leading-none" aria-hidden>
                  {theme.icon}
                </span>
                <span className="text-sm font-semibold">{theme.label}</span>
                <span className="text-[11px] leading-snug text-[var(--muted)]">
                  {theme.blurb}
                </span>
              </button>

              {isOn && (
                <div
                  className="mt-2.5 flex gap-1 border-t border-teal-500/20 pt-2"
                  role="group"
                  aria-label={`${theme.label} 비중`}
                >
                  {WEIGHTS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setWeight(theme.id, w)}
                      aria-pressed={weight === w}
                      className={`flex-1 rounded-md px-1 py-1 text-[11px] font-medium transition ${
                        weight === w
                          ? "bg-teal-600 text-white"
                          : "text-[var(--muted)] hover:bg-slate-500/10"
                      }`}
                    >
                      {WEIGHT_LABEL[w]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
