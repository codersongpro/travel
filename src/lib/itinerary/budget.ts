import type { BudgetBreakdown, Day, Itinerary, TripRequest } from "./schema";
import { nightsBetween } from "./schema";

/**
 * 예산 배분 — 총예산을 카테고리 상한으로 먼저 나눈 뒤 후보를 거른다.
 * 이 상한이 Gemini 프롬프트의 하드 제약으로 들어가고,
 * 응답을 받은 뒤 실제 합계로 다시 검증한다.
 */

/** 기본 배분 비율. 합이 1이 되어야 한다. */
export const DEFAULT_SPLIT = {
  lodging: 0.4,
  food: 0.3,
  activity: 0.2,
  reserve: 0.1,
} as const;

export type BudgetSplit = typeof DEFAULT_SPLIT;

export function allocateBudget(
  totalKrw: number,
  split: BudgetSplit = DEFAULT_SPLIT,
): BudgetBreakdown {
  return {
    lodging: Math.floor(totalKrw * split.lodging),
    food: Math.floor(totalKrw * split.food),
    activity: Math.floor(totalKrw * split.activity),
    reserve: Math.floor(totalKrw * split.reserve),
  };
}

export function emptyBreakdown(): BudgetBreakdown {
  return { lodging: 0, food: 0, activity: 0, reserve: 0 };
}

/** 총 인원 (아동 포함). 비용 계산의 기준. */
export function partySize(req: Pick<TripRequest, "adults" | "childAges">): number {
  return req.adults + req.childAges.length;
}

/** 1박 숙소 예산 상한. 숙소 후보를 거를 때 쓴다. */
export function maxLodgingPerNight(req: TripRequest, limits: BudgetBreakdown): number {
  const nights = Math.max(1, nightsBetween(req.startDate, req.endDate));
  return Math.floor(limits.lodging / nights);
}

/** 1인 1끼 식비 상한. 식당 후보의 priceLevel을 거를 때 쓴다. */
export function maxMealCostPerPerson(
  req: TripRequest,
  limits: BudgetBreakdown,
  days: number,
): number {
  // 하루 2끼(점심·저녁)를 기준으로 잡는다.
  const meals = Math.max(1, days * 2 * partySize(req));
  return Math.floor(limits.food / meals);
}

/**
 * 1인 1끼 예산을 Places priceLevel(0~4) 상한으로 환산한다.
 * 이 값을 넘는 가격대의 식당은 후보에서 제외된다.
 */
export function priceLevelCeiling(perPersonKrw: number): number {
  if (perPersonKrw >= 80_000) return 4;
  if (perPersonKrw >= 40_000) return 3;
  if (perPersonKrw >= 18_000) return 2;
  if (perPersonKrw >= 8_000) return 1;
  return 0;
}

/** 완성된 일정의 실제 지출 합계. */
export function sumSpending(days: readonly Day[]): BudgetBreakdown {
  const spent = emptyBreakdown();

  for (const day of days) {
    for (const slot of day.slots) {
      if (slot.kind === "lodging") continue;
      const bucket =
        slot.kind === "breakfast" || slot.kind === "lunch" || slot.kind === "dinner"
          ? "food"
          : "activity";
      spent[bucket] += slot.costKrw;
    }
    if (day.lodging) spent.lodging += day.lodging.pricePerNightKrw;
  }

  return spent;
}

export interface BudgetStatus {
  limits: BudgetBreakdown;
  spent: BudgetBreakdown;
  totalKrw: number;
  plannedKrw: number;
  /** 상한을 넘긴 카테고리 */
  overBy: Partial<Record<keyof BudgetBreakdown, number>>;
  isOverTotal: boolean;
}

export function evaluateBudget(
  totalKrw: number,
  limits: BudgetBreakdown,
  spent: BudgetBreakdown,
): BudgetStatus {
  const overBy: BudgetStatus["overBy"] = {};
  for (const key of ["lodging", "food", "activity"] as const) {
    const diff = spent[key] - limits[key];
    if (diff > 0) overBy[key] = diff;
  }

  const plannedKrw = spent.lodging + spent.food + spent.activity;
  return {
    limits,
    spent,
    totalKrw,
    plannedKrw,
    overBy,
    isOverTotal: plannedKrw > totalKrw,
  };
}

export const BUDGET_LABEL: Record<keyof BudgetBreakdown, string> = {
  lodging: "숙소",
  food: "식비",
  activity: "액티비티",
  reserve: "예비비",
};

/** 최종 Itinerary에 넣을 예산 블록. */
export function buildBudgetBlock(
  totalKrw: number,
  limits: BudgetBreakdown,
  days: readonly Day[],
): Itinerary["budget"] {
  const spent = sumSpending(days);
  return {
    totalKrw,
    plannedKrw: spent.lodging + spent.food + spent.activity,
    limits,
    spent,
  };
}

/**
 * 예산 상한을 실제로 강제한다.
 *
 * 액티비티·식비가 상한을 넘으면 비싼 항목부터 같은 테마의 더 싼 대안으로 바꾸고,
 * 대안이 없으면 마지막 수단으로 그 항목을 뺀다.
 * 어떤 카테고리를 손댈지는 초과분이 큰 쪽부터 정한다.
 */
export function enforceBudget(
  days: Day[],
  limits: BudgetBreakdown,
  cheaperAlternative: (slot: Day["slots"][number], maxCost: number) => Day["slots"][number] | null,
  /** 하루에 이만큼의 활동은 예산 때문에라도 지운다. 식사만 남은 날은 일정이 아니다. */
  minActivitiesPerDay = 1,
): { days: Day[]; swapped: string[]; removed: string[] } {
  const swapped: string[] = [];
  const removed: string[] = [];
  const working = days.map((d) => ({ ...d, slots: [...d.slots] }));

  for (const category of ["activity", "food"] as const) {
    const kinds =
      category === "food"
        ? (["breakfast", "lunch", "dinner"] as const)
        : (["activity"] as const);

    let guard = 0;
    while (sumSpending(working)[category] > limits[category] && guard++ < 30) {
      const over = sumSpending(working)[category] - limits[category];

      // 테마별 등장 횟수 — 마지막 하나 남은 테마는 지우지 않는다.
      // 사용자가 고른 테마가 예산 조정 때문에 통째로 사라지면 안 된다.
      const themeCounts = new Map<string, number>();
      for (const day of working) {
        for (const slot of day.slots) {
          if (slot.kind !== "activity") continue;
          themeCounts.set(slot.theme, (themeCounts.get(slot.theme) ?? 0) + 1);
        }
      }

      // 가장 비싼 항목부터 손본다 — 한 번에 가장 큰 폭으로 줄어든다.
      // 활동 하한에 이미 닿은 날은 건드리지 않는다 (빈 하루 방지).
      let target: { dayIdx: number; slotIdx: number; cost: number } | null = null;
      working.forEach((day, dayIdx) => {
        if (
          category === "activity" &&
          day.slots.filter((s) => s.kind === "activity").length <= minActivitiesPerDay
        ) {
          return;
        }
        day.slots.forEach((slot, slotIdx) => {
          if (!kinds.includes(slot.kind as never)) return;
          // 그 테마의 마지막 한 개라면 건드리지 않는다.
          if (slot.kind === "activity" && (themeCounts.get(slot.theme) ?? 0) <= 1) return;
          if (!target || slot.costKrw > target.cost) {
            target = { dayIdx, slotIdx, cost: slot.costKrw };
          }
        });
      });

      if (!target) break;
      const { dayIdx, slotIdx, cost } = target;
      const slot = working[dayIdx].slots[slotIdx];

      const replacement = cheaperAlternative(slot, Math.max(0, cost - over));
      if (replacement && replacement.costKrw < cost) {
        working[dayIdx].slots[slotIdx] = replacement;
        swapped.push(slot.placeId);
        continue;
      }

      // 식사는 빼면 하루 구성이 무너지므로 비용만 상한선까지 낮춰 잡는다.
      if (category === "food") {
        working[dayIdx].slots[slotIdx] = {
          ...slot,
          costKrw: Math.max(0, cost - over),
        };
        swapped.push(slot.placeId);
        continue;
      }

      working[dayIdx].slots.splice(slotIdx, 1);
      removed.push(slot.placeId);
    }
  }

  return { days: working, swapped, removed };
}
