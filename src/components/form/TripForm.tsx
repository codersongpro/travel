"use client";

import { useMemo, useState } from "react";
import { ThemePicker } from "./ThemePicker";
import { Card, Field, inputClass } from "@/components/ui";
import { formatKrwShort } from "@/lib/format";
import { dayCount, type Pace, type ThemeSelection, type TravelMode, type TripRequest } from "@/lib/itinerary/schema";

/** 여행 조건 입력. 제출 시 TripRequest 형태로 그대로 넘긴다. */

const PACE_OPTIONS: { value: Pace; label: string; hint: string }[] = [
  { value: "relaxed", label: "여유", hint: "하루 2곳 · 이동 짧게" },
  { value: "normal", label: "보통", hint: "하루 3곳" },
  { value: "packed", label: "빡빡", hint: "하루 4곳 · 부지런히" },
];

const MODE_OPTIONS: { value: TravelMode; label: string; icon: string }[] = [
  { value: "TRANSIT", label: "대중교통", icon: "🚇" },
  { value: "DRIVE", label: "차량", icon: "🚗" },
  { value: "WALK", label: "도보", icon: "🚶" },
];

const TIER_LABELS = ["", "이코노미", "실속", "중급", "상급", "럭셔리"];

function todayPlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export function TripForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (req: TripRequest) => void;
  disabled?: boolean;
}) {
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState(todayPlus(14));
  const [endDate, setEndDate] = useState(todayPlus(16));
  const [adults, setAdults] = useState(2);
  const [childAges, setChildAges] = useState<number[]>([]);
  const [budgetManwon, setBudgetManwon] = useState(80);
  const [themes, setThemes] = useState<ThemeSelection[]>([]);
  const [pace, setPace] = useState<Pace>("normal");
  const [travelMode, setTravelMode] = useState<TravelMode>("TRANSIT");
  const [lodgingTier, setLodgingTier] = useState(3);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(
    () => (endDate >= startDate ? dayCount(startDate, endDate) : 0),
    [startDate, endDate],
  );
  const budgetKrw = budgetManwon * 10_000;
  const perPersonPerDay =
    days > 0 && adults + childAges.length > 0
      ? Math.round(budgetKrw / days / (adults + childAges.length))
      : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!destination.trim()) return setError("여행지를 입력해 주세요.");
    if (endDate < startDate) return setError("도착일이 출발일보다 빠릅니다.");
    if (themes.length === 0) return setError("코스 테마를 하나 이상 골라 주세요.");
    if (budgetKrw <= 0) return setError("총예산을 입력해 주세요.");

    onSubmit({
      destination: destination.trim(),
      startDate,
      endDate,
      adults,
      childAges,
      budgetKrw,
      themes,
      pace,
      travelMode,
      lodgingTier,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <Card className="flex flex-col gap-5 p-5">
        <Field label="어디로 가시나요?" htmlFor="destination" hint="도시나 지역 이름을 자유롭게 입력하세요. 국내·해외 모두 가능합니다.">
          <input
            id="destination"
            className={inputClass}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="예: 교토, 부산, 파리"
            autoComplete="off"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="출발일" htmlFor="start">
            <input
              id="start"
              type="date"
              className={inputClass}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field
            label="도착일"
            htmlFor="end"
            hint={days > 0 ? `${days}일 일정 (${days - 1}박)` : undefined}
          >
            <input
              id="end"
              type="date"
              className={inputClass}
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="성인" htmlFor="adults">
            <input
              id="adults"
              type="number"
              min={1}
              max={20}
              className={inputClass}
              value={adults}
              onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))}
            />
          </Field>

          <Field label="아동" hint="연령을 입력하면 연령에 맞는 관람 포인트를 함께 안내합니다.">
            <div className="flex flex-wrap items-center gap-2">
              {childAges.map((age, i) => (
                <span key={i} className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={18}
                    aria-label={`아동 ${i + 1} 나이`}
                    className={`${inputClass} w-20`}
                    value={age}
                    onChange={(e) =>
                      setChildAges(
                        childAges.map((a, j) =>
                          j === i ? Math.min(18, Math.max(0, Number(e.target.value) || 0)) : a,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label={`아동 ${i + 1} 삭제`}
                    onClick={() => setChildAges(childAges.filter((_, j) => j !== i))}
                    className="rounded-md px-1.5 text-[var(--muted)] hover:bg-slate-500/10"
                  >
                    ×
                  </button>
                </span>
              ))}
              {childAges.length < 10 && (
                <button
                  type="button"
                  onClick={() => setChildAges([...childAges, 8])}
                  className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:border-teal-500 hover:text-teal-600"
                >
                  + 아동 추가
                </button>
              )}
            </div>
          </Field>
        </div>

        <Field
          label={`총예산 · ${formatKrwShort(budgetKrw)}`}
          htmlFor="budget"
          hint={
            perPersonPerDay > 0
              ? `1인 하루 약 ${formatKrwShort(perPersonPerDay)} — 숙소·식비·액티비티를 이 안에서 배분합니다.`
              : undefined
          }
        >
          <div className="flex items-center gap-3">
            <input
              id="budget"
              type="range"
              min={10}
              max={1000}
              step={10}
              value={budgetManwon}
              onChange={(e) => setBudgetManwon(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-slate-500/20 accent-teal-600"
            />
            <input
              type="number"
              aria-label="총예산 (만원)"
              min={1}
              className={`${inputClass} w-28`}
              value={budgetManwon}
              onChange={(e) => setBudgetManwon(Math.max(1, Number(e.target.value) || 1))}
            />
            <span className="text-sm text-[var(--muted)]">만원</span>
          </div>
        </Field>
      </Card>

      <Card className="p-5">
        <ThemePicker value={themes} onChange={setThemes} />
      </Card>

      <Card className="grid gap-5 p-5 sm:grid-cols-3">
        <Field label="여행 페이스">
          <div className="flex gap-1.5">
            {PACE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setPace(o.value)}
                aria-pressed={pace === o.value}
                title={o.hint}
                className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium transition ${
                  pace === o.value
                    ? "bg-teal-600 text-white"
                    : "bg-slate-500/8 text-[var(--muted)] hover:bg-slate-500/15"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="주 이동 수단">
          <div className="flex gap-1.5">
            {MODE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setTravelMode(o.value)}
                aria-pressed={travelMode === o.value}
                className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium transition ${
                  travelMode === o.value
                    ? "bg-teal-600 text-white"
                    : "bg-slate-500/8 text-[var(--muted)] hover:bg-slate-500/15"
                }`}
              >
                <span aria-hidden>{o.icon}</span> {o.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label={`숙소 등급 · ${TIER_LABELS[lodgingTier]}`} htmlFor="tier">
          <input
            id="tier"
            type="range"
            min={1}
            max={5}
            value={lodgingTier}
            onChange={(e) => setLodgingTier(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-500/20 accent-teal-600"
          />
        </Field>
      </Card>

      {error && (
        <p role="alert" className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={disabled}
        className="rounded-xl bg-teal-600 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {disabled ? "일정을 만드는 중…" : "여행 코스 만들기"}
      </button>
    </form>
  );
}
