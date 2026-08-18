"use client";

import { itinerarySchema, type Itinerary } from "./itinerary/schema";

/**
 * 내 일정 목록 — localStorage 기반. 로그인도 서버도 없다.
 * 브라우저를 바꾸면 목록은 따라가지 않지만, 공유 URL로는 어디서든 열린다.
 */

const KEY = "travel-planner:saved";
const MAX_SAVED = 20;

export interface SavedItinerary {
  id: string;
  savedAt: number;
  itinerary: Itinerary;
}

function read(): SavedItinerary[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];

    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];

    // 앱 업데이트로 스키마가 바뀌었을 수 있으므로 저장본도 검증한다.
    return list.flatMap((entry) => {
      const parsed = itinerarySchema.safeParse(
        (entry as Partial<SavedItinerary>)?.itinerary,
      );
      if (!parsed.success) return [];
      const e = entry as SavedItinerary;
      return [{ id: e.id, savedAt: e.savedAt, itinerary: parsed.data }];
    });
  } catch {
    return [];
  }
}

function write(list: readonly SavedItinerary[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
  } catch (err) {
    // 용량 초과 등 — 저장 실패가 앱을 멈추게 하지는 않는다.
    console.warn("[storage] 일정 저장 실패:", err);
  }
}

export function listSaved(): SavedItinerary[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveItinerary(itinerary: Itinerary): SavedItinerary {
  const entry: SavedItinerary = {
    id: `${itinerary.destination}-${itinerary.startDate}-${Date.now().toString(36)}`,
    savedAt: Date.now(),
    itinerary,
  };

  // 같은 여행지·같은 날짜의 이전 저장본은 덮어쓴다.
  const rest = read().filter(
    (s) =>
      !(
        s.itinerary.destination === itinerary.destination &&
        s.itinerary.startDate === itinerary.startDate
      ),
  );

  write([entry, ...rest]);
  return entry;
}

export function removeSaved(id: string): void {
  write(read().filter((s) => s.id !== id));
}
