"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * A day's trail on a map: the route as a line with arrows along it pointing
 * the way he went, a marker where he clocked in and where he finished, an
 * amber ring at every stop with how long, and the job sites as grey squares.
 *
 * Arrows are a symbol layer placed ALONG the line, so MapLibre turns each one
 * to face the direction of travel and keeps them spaced at any zoom -- no
 * arithmetic here for which way an arrow points, which is the arithmetic that
 * would be easiest to get backwards.
 */

export type TrailPoint = { lat: number; lng: number; at: string; kind: "in" | "ping" | "out" };
export type TrailStop = { lat: number; lng: number; from: string; to: string; minutes: number;
                          site: { name: string } | null };
export type TrailSite = { id: string; name: string; lat: number; lng: number };

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** An arrow pointing EAST: a line-placed symbol is turned to the line, with
 *  the image's +x along the direction of travel. */
function arrowImage(colour: string): ImageData {
  const size = 32;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = colour;
  g.strokeStyle = "#ffffff";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(26, 16); g.lineTo(8, 6); g.lineTo(12, 16); g.lineTo(8, 26); g.closePath();
  g.fill(); g.stroke();
  return g.getImageData(0, 0, size, size);
}

export default function TrailMap({ points, stops, sites }: {
  points: TrailPoint[]; stops: TrailStop[]; sites: TrailSite[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const marks = useRef<maplibregl.Marker[]>([]);
  const ready = useRef(false);

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = new maplibregl.Map({
      container: box.current, style: STYLE, center: [-78.9, 35.3], zoom: 8,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#405981";
      m.addImage("trail-arrow", arrowImage(accent), { pixelRatio: 2 });
      m.addSource("trail", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "trail-line", type: "line", source: "trail",
        paint: { "line-color": accent, "line-width": 4, "line-opacity": 0.85 },
        layout: { "line-join": "round", "line-cap": "round" } });
      m.addLayer({ id: "trail-arrows", type: "symbol", source: "trail",
        layout: { "symbol-placement": "line", "symbol-spacing": 70, "icon-image": "trail-arrow",
                  "icon-allow-overlap": true, "icon-rotation-alignment": "map" } });
      m.addSource("trail-dots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "trail-dots", type: "circle", source: "trail-dots",
        paint: { "circle-radius": 3, "circle-color": accent, "circle-stroke-color": "#fff",
                 "circle-stroke-width": 1 } });
      ready.current = true;
      m.fire("trail-ready");
    });
    map.current = m;
    return () => { m.remove(); map.current = null; ready.current = false; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const draw = () => {
      (m.getSource("trail") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: points.length > 1 ? [{ type: "Feature", properties: {},
          geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) } }] : [],
      });
      (m.getSource("trail-dots") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: points.map((p) => ({ type: "Feature", properties: {},
          geometry: { type: "Point", coordinates: [p.lng, p.lat] } })),
      });

      for (const k of marks.current) k.remove();
      marks.current = [];
      // A day usually ends where it began, so In sits to the LEFT of its
      // point and Out to the RIGHT -- one on top of the other hid the In.
      const add = (el: HTMLElement, lng: number, lat: number,
                   anchor: "center" | "left" | "right" | "bottom" = "center",
                   offset: [number, number] = [0, 0]) =>
        marks.current.push(new maplibregl.Marker({ element: el, anchor, offset })
          .setLngLat([lng, lat]).addTo(m));
      const tag = (cls: string, text: string, title?: string) => {
        const el = document.createElement("div");
        el.className = cls; el.textContent = text; if (title) el.title = title;
        return el;
      };

      for (const s of sites) add(tag("crewsite", "", s.name), s.lng, s.lat);
      for (const s of stops) {
        add(tag("trailstop", `${s.minutes} min`,
          `${s.site?.name ?? "Not a job site"} · ${time(s.from)}–${time(s.to)}`),
          s.lng, s.lat, "bottom", [0, -8]);
      }
      const first = points.find((p) => p.kind === "in") ?? points[0];
      const last = [...points].reverse().find((p) => p.kind === "out");
      if (first) add(tag("trailend start", `In ${time(first.at)}`), first.lng, first.lat, "right", [-8, 0]);
      if (last) add(tag("trailend finish", `Out ${time(last.at)}`), last.lng, last.lat, "left", [8, 0]);

      if (points.length) {
        const b = new maplibregl.LngLatBounds();
        for (const p of points) b.extend([p.lng, p.lat]);
        m.fitBounds(b, { padding: 60, maxZoom: 16, duration: 0 });
      }
    };
    if (ready.current) draw(); else m.once("trail-ready", draw);
  }, [points, stops, sites]);

  return <div ref={box} className="trailmap" aria-label="Map of the day's route" />;
}
