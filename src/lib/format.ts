/** 한국어 표시용 포맷터. */

const krw = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

export function formatKrw(value: number): string {
  return krw.format(Math.round(value));
}

/** 큰 금액을 "12만원", "1,240만원"처럼 축약. */
export function formatKrwShort(value: number): string {
  const v = Math.round(value);
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1).replace(/\.0$/, "")}억원`;
  if (v >= 10_000) return `${Math.round(v / 10_000).toLocaleString("ko-KR")}만원`;
  return `${v.toLocaleString("ko-KR")}원`;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters}m` : `${(meters / 1000).toFixed(1)}km`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-09-14" → "9월 14일 (월)" */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEKDAYS[d.getUTCDay()]})`;
}

export const TRAVEL_MODE_LABEL = {
  TRANSIT: { icon: "🚇", label: "대중교통" },
  DRIVE: { icon: "🚗", label: "차량" },
  WALK: { icon: "🚶", label: "도보" },
} as const;

export function formatRating(rating?: number, count?: number): string | null {
  if (rating === undefined) return null;
  const c = count === undefined ? "" : ` (리뷰 ${count.toLocaleString("ko-KR")}개)`;
  return `★ ${rating.toFixed(1)}${c}`;
}
