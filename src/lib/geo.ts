/** 지리 계산 유틸 — 순수 함수만. */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** 두 좌표 사이 직선(대권) 거리, 미터. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 직선거리를 실제 이동거리로 보정하는 우회계수.
 * 도로·강·건물 때문에 실제 경로는 항상 직선보다 길다.
 */
export const DETOUR_FACTOR = {
  WALK: 1.3,
  DRIVE: 1.4,
  TRANSIT: 1.45,
} as const;

/** 이동 수단별 평균 속도 (m/분). 대기·환승 시간을 감안한 실효 속도. */
export const SPEED_M_PER_MIN = {
  WALK: 75,
  DRIVE: 400,
  TRANSIT: 300,
} as const;

/** Routes API를 못 쓸 때의 이동시간 추정 (분). */
export function estimateTravelMinutes(
  a: LatLng,
  b: LatLng,
  mode: keyof typeof SPEED_M_PER_MIN,
): { minutes: number; meters: number } {
  const meters = Math.round(haversineMeters(a, b) * DETOUR_FACTOR[mode]);
  // 대중교통/차량은 승하차·주차에 고정 오버헤드가 붙는다.
  const overhead = mode === "WALK" ? 0 : mode === "TRANSIT" ? 7 : 4;
  const minutes = Math.max(1, Math.round(meters / SPEED_M_PER_MIN[mode]) + overhead);
  return { minutes, meters };
}

/** 좌표 묶음의 중심점. */
export function centroid(points: readonly LatLng[]): LatLng {
  if (points.length === 0) throw new Error("빈 배열의 중심점은 구할 수 없습니다.");
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}
