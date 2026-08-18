"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import { getTheme } from "@/lib/themes";
import type { Day } from "@/lib/itinerary/schema";

/**
 * 일자별 동선 지도.
 *
 * Maps JS API 키가 없으면 지도 대신 좌표 기반 목록으로 떨어진다 —
 * 키가 없다고 결과 화면이 비어 보이면 안 되므로.
 */

/** 일자별 마커·경로 색상 */
const DAY_COLORS = [
  "#0d9488", "#6366f1", "#f43f5e", "#f59e0b",
  "#8b5cf6", "#059669", "#ec4899", "#0ea5e9",
];

declare global {
  interface Window {
    google?: typeof google;
    __travelMapInit?: () => void;
  }
}

function loadMapsScript(key: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("서버에서는 로드하지 않습니다."));
  if (window.google?.maps) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.getElementById("google-maps-script");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("지도 스크립트 로드 실패")));
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&language=ko&libraries=marker`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("지도 스크립트 로드 실패"));
    document.head.appendChild(script);
  });
}

export function MapView({ days }: { days: Day[] }) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!key || !containerRef.current) return;
    let cancelled = false;

    loadMapsScript(key)
      .then(() => {
        if (cancelled || !containerRef.current || !window.google?.maps) return;

        const points = days.flatMap((d) => d.slots.map((s) => ({ lat: s.lat, lng: s.lng })));
        if (points.length === 0) return;

        const map = new window.google.maps.Map(containerRef.current, {
          center: points[0],
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
        });

        const bounds = new window.google.maps.LatLngBounds();
        const info = new window.google.maps.InfoWindow();

        days.forEach((day, dayIndex) => {
          const color = DAY_COLORS[dayIndex % DAY_COLORS.length];
          const path = day.slots.map((s) => ({ lat: s.lat, lng: s.lng }));

          day.slots.forEach((slot, i) => {
            bounds.extend({ lat: slot.lat, lng: slot.lng });

            const marker = new window.google!.maps.Marker({
              position: { lat: slot.lat, lng: slot.lng },
              map,
              label: { text: String(i + 1), color: "#fff", fontSize: "11px" },
              title: slot.name,
              icon: {
                path: window.google!.maps.SymbolPath.CIRCLE,
                scale: 11,
                fillColor: color,
                fillOpacity: 1,
                strokeColor: "#fff",
                strokeWeight: 2,
              },
            });

            marker.addListener("click", () => {
              info.setContent(
                `<div style="font-family:sans-serif;padding:2px 4px">
                   <strong>${day.dayNumber}일차 · ${slot.startTime}</strong><br/>${slot.name}
                 </div>`,
              );
              info.open(map, marker);
            });
          });

          // 방문 순서를 잇는 경로선 — 동선이 한눈에 보이게
          if (path.length > 1) {
            new window.google!.maps.Polyline({
              path,
              map,
              strokeColor: color,
              strokeOpacity: 0.7,
              strokeWeight: 3,
            });
          }
        });

        if (!bounds.isEmpty()) map.fitBounds(bounds, 48);
      })
      .catch((err) => {
        console.warn("[map] 지도 로드 실패:", err);
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [key, days]);

  if (!key || failed) return <MapFallback days={days} hasKey={Boolean(key)} />;

  return (
    <Card className="overflow-hidden p-0">
      <div ref={containerRef} className="h-[480px] w-full" role="application" aria-label="여행 동선 지도" />
      <div className="flex flex-wrap gap-3 border-t border-[var(--border)] p-3 text-xs">
        {days.map((day, i) => (
          <span key={day.date} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: DAY_COLORS[i % DAY_COLORS.length] }}
              aria-hidden
            />
            {day.dayNumber}일차
          </span>
        ))}
      </div>
    </Card>
  );
}

/** 지도를 못 띄울 때의 대체 표시 — 좌표와 순서는 그대로 전달한다. */
function MapFallback({ days, hasKey }: { days: Day[]; hasKey: boolean }) {
  return (
    <Card className="p-5">
      <p className="mb-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
        {hasKey
          ? "지도를 불러오지 못했습니다. 아래는 방문 순서와 좌표입니다."
          : "지도 API 키가 없어 목록으로 표시합니다. NEXT_PUBLIC_GOOGLE_MAPS_API_KEY를 설정하면 지도가 나타납니다."}
      </p>

      <div className="flex flex-col gap-4">
        {days.map((day, i) => (
          <div key={day.date}>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: DAY_COLORS[i % DAY_COLORS.length] }}
                aria-hidden
              />
              {day.dayNumber}일차
            </h3>
            <ol className="flex flex-col gap-1 text-sm text-[var(--muted)]">
              {day.slots.map((slot, j) => (
                <li key={`${slot.placeId}-${j}`} className="flex gap-2">
                  <span className="tabular-nums">{j + 1}.</span>
                  <span aria-hidden>{getTheme(slot.theme).icon}</span>
                  <span className="flex-1">{slot.name}</span>
                  <a
                    className="text-teal-600 hover:underline dark:text-teal-400"
                    href={`https://www.google.com/maps/search/?api=1&query=${slot.lat},${slot.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    지도에서 보기
                  </a>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </Card>
  );
}
