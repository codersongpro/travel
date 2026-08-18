import { describe, expect, it } from "vitest";
import {
  clusterByGeography,
  orderByNearestNeighbor,
  TravelMatrix,
  totalTravelMinutes,
  type RoutePoint,
} from "./routing";
import { haversineMeters } from "@/lib/geo";

// 서울 강북(경복궁 일대)과 강남(코엑스 일대) — 실제로 15km 이상 떨어져 있다.
const GANGBUK: RoutePoint[] = [
  { id: "경복궁", lat: 37.5796, lng: 126.977 },
  { id: "북촌한옥마을", lat: 37.5826, lng: 126.9831 },
  { id: "인사동", lat: 37.5714, lng: 126.9857 },
];

const GANGNAM: RoutePoint[] = [
  { id: "코엑스", lat: 37.5126, lng: 127.0588 },
  { id: "선릉", lat: 37.5044, lng: 127.0489 },
  { id: "가로수길", lat: 37.5205, lng: 127.0229 },
];

describe("clusterByGeography", () => {
  it("도시 반대편 장소를 같은 클러스터에 묶지 않는다", () => {
    const clusters = clusterByGeography([...GANGBUK, ...GANGNAM], 2);
    expect(clusters).toHaveLength(2);

    for (const cluster of clusters) {
      const ids = cluster.points.map((p) => p.id);
      const hasGangbuk = ids.some((id) => GANGBUK.some((p) => p.id === id));
      const hasGangnam = ids.some((id) => GANGNAM.some((p) => p.id === id));
      // 한 클러스터 안에 강북과 강남이 섞이면 안 된다
      expect(hasGangbuk && hasGangnam).toBe(false);
    }
  });

  it("같은 입력이면 항상 같은 결과를 낸다 (결정론적)", () => {
    const points = [...GANGBUK, ...GANGNAM];
    const first = clusterByGeography(points, 2).map((c) => c.points.map((p) => p.id).sort());
    const second = clusterByGeography(points, 2).map((c) => c.points.map((p) => p.id).sort());
    expect(first).toEqual(second);
  });

  it("클러스터 수가 점 개수보다 많으면 점 개수로 제한한다", () => {
    expect(clusterByGeography(GANGBUK, 10)).toHaveLength(3);
  });

  it("빈 입력은 빈 배열을 반환한다", () => {
    expect(clusterByGeography([], 3)).toEqual([]);
  });

  it("모든 점이 정확히 한 클러스터에만 속한다", () => {
    const points = [...GANGBUK, ...GANGNAM];
    const assigned = clusterByGeography(points, 2).flatMap((c) => c.points.map((p) => p.id));
    expect(assigned.sort()).toEqual(points.map((p) => p.id).sort());
  });
});

describe("TravelMatrix", () => {
  const points = [...GANGBUK, ...GANGNAM];

  it("Routes API 값이 없으면 Haversine 추정으로 폴백한다", () => {
    const matrix = new TravelMatrix(points, "TRANSIT");
    const leg = matrix.get("경복궁", "코엑스");

    expect(leg.isEstimate).toBe(true);
    expect(leg.minutes).toBeGreaterThan(0);
    // 직선거리보다 우회계수만큼 길어야 한다
    expect(leg.meters).toBeGreaterThan(haversineMeters(GANGBUK[0], GANGNAM[0]));
  });

  it("실제 API 값이 있으면 추정 대신 그 값을 쓴다", () => {
    const matrix = new TravelMatrix(points, "TRANSIT");
    matrix.set("경복궁", "코엑스", { minutes: 42, meters: 16000, isEstimate: false });

    const leg = matrix.get("경복궁", "코엑스");
    expect(leg.minutes).toBe(42);
    expect(leg.isEstimate).toBe(false);
    expect(matrix.hasRealData).toBe(true);
  });

  it("같은 지점끼리는 이동시간 0", () => {
    const matrix = new TravelMatrix(points, "WALK");
    expect(matrix.get("경복궁", "경복궁")).toEqual({
      minutes: 0,
      meters: 0,
      isEstimate: false,
    });
  });

  it("모르는 지점을 물으면 0을 반환하고 터지지 않는다", () => {
    const matrix = new TravelMatrix(points, "WALK");
    expect(matrix.get("경복궁", "없는곳").minutes).toBe(0);
  });

  it("withinMinutes는 제한 시간 안의 지점만 돌려준다", () => {
    const matrix = new TravelMatrix(points, "WALK");
    const near = matrix.withinMinutes("경복궁", 20);

    expect(near.has("북촌한옥마을")).toBe(true);
    // 강남까지 도보 20분은 불가능
    expect(near.has("코엑스")).toBe(false);
    expect(near.has("경복궁")).toBe(false);
  });

  it("이동 수단이 빠를수록 소요시간이 짧다", () => {
    const walk = new TravelMatrix(points, "WALK").get("경복궁", "인사동").minutes;
    const drive = new TravelMatrix(points, "DRIVE").get("경복궁", "인사동").minutes;
    expect(drive).toBeLessThan(walk);
  });
});

describe("orderByNearestNeighbor", () => {
  it("가까운 곳부터 이어 붙여 총 이동시간을 줄인다", () => {
    const points = [...GANGBUK, ...GANGNAM];
    const matrix = new TravelMatrix(points, "TRANSIT");

    // 강북 → 강남 → 강북 → 강남으로 튀는 최악의 순서
    const zigzag = ["경복궁", "코엑스", "북촌한옥마을", "선릉"];
    const optimized = orderByNearestNeighbor(matrix, zigzag, "경복궁");

    expect(totalTravelMinutes(matrix, optimized)).toBeLessThan(
      totalTravelMinutes(matrix, zigzag),
    );
    expect(optimized.sort()).toEqual(zigzag.sort());
  });

  it("2곳 이하는 순서를 그대로 둔다", () => {
    const matrix = new TravelMatrix(GANGBUK, "WALK");
    expect(orderByNearestNeighbor(matrix, ["인사동", "경복궁"])).toEqual([
      "인사동",
      "경복궁",
    ]);
  });
});
