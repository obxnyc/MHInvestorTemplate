"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { metresBetween } from "@/lib/fence";

/**
 * A day's trail on a map.
 *
 * "This map doesn't really tell me anything or plot the points with
 *  timestamps and arrows. I need to know where they were and are." The
 *  owner, looking at a day with no positions and a county of grey squares.
 *
 * So, in order of what the eye should land on:
 *   - the JOB he clocked in at, named, and the map centred on it -- always,
 *     even on a day with no positions at all;
 *   - the route as a line with arrows along it facing the way he went;
 *   - a TIME beside every position, so the line is also a timeline. Labels
 *     that would collide are hidden by the map and come back as you zoom
 *     in -- MapLibre's own collision, not arithmetic here;
 *   - "Now" on the newest position while he is still on the clock today;
 *   - In / Out markers, and an amber ring at every stop with how long;
 *   - other job sites only when they are near the route, and named.
 *
 * Arrows are a symbol layer placed ALONG the line, so MapLibre turns each one
 * to face the direction of travel -- no bearing arithmetic here, which is the
 * arithmetic easiest to get backwards.
 */

export type TrailPoint = { lat: number; lng: number; at: string; kind: "in" | "ping" | "out" };
export type TrailStop = { lat: number; lng: number; from: string; to: string; minutes: number;
                          site: { name: string } | null };
export type TrailSite = { id: string; name: string; lat: number; lng: number };

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
/** Other job sites further than this from every point are left off. */
const NEARBY = 1500;

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

export default function TrailMap({ points, stops, sites, jobs, live }: {
  points: TrailPoint[]; stops: TrailStop[]; sites: TrailSite[];
  /** The jobs he clocked in at that day. */
  jobs: TrailSite[];
  /** Still on the clock, today: the newest position is "Now". */
  live: boolean;
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
        paint: { "circle-radius": 4, "circle-color": accent, "circle-stroke-color": "#fff",
                 "circle-stroke-width": 1.5 } });
      // The time beside every dot. Collisions are hidden by the map and come
      // back as you zoom in, so a whole day stays readable at any zoom.
      m.addLayer({ id: "trail-times", type: "symbol", source: "trail-dots",
        layout: { "text-field": ["get", "t"], "text-size": 11, "text-offset": [0, -1.1],
                  "text-anchor": "bottom", "text-allow-overlap": false,
                  "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 1.6 } });
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
        features: points.map((p) => ({ type: "Feature", properties: { t: time(p.at) },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] } })),
      });

      for (const k of marks.current) k.remove();
      marks.current = [];
      // A day usually ends where it began, so In sits to the LEFT of its
      // point and Out to the RIGHT -- one on top of the other hid the In.
      const add = (el: HTMLElement, lng: number, lat: number,
                   anchor: "center" | "left" | "right" | "bottom" | "top" | "top-left" = "center",
                   offset: [number, number] = [0, 0]) =>
        marks.current.push(new maplibregl.Marker({ element: el, anchor, offset })
          .setLngLat([lng, lat]).addTo(m));
      const tag = (cls: string, text: string, title?: string) => {
        const el = document.createElement("div");
        el.className = cls; el.textContent = text; if (title) el.title = title;
        return el;
      };

      const jobIds = new Set(jobs.map((j) => j.id));
      // Other job sites: only the ones near where he actually went.
      const near = points.length
        ? sites.filter((s) => !jobIds.has(s.id) && points.some((p) => metresBetween(p, s) <= NEARBY))
        : [];
      for (const s of near) add(tag("trailsite", s.name), s.lng, s.lat, "top", [0, 4]);
      for (const j of jobs) add(tag("trailjob", j.name), j.lng, j.lat, "top", [0, 4]);

      for (const s of stops) {
        add(tag("trailstop", `${s.minutes} min`,
          `${s.site?.name ?? "Not a job site"} · ${time(s.from)}–${time(s.to)}`),
          // Below and to the right: the time sits ABOVE every dot, and a
          // stop label there covered it.
          s.lng, s.lat, "top-left", [10, 8]);
      }
      const first = points.find((p) => p.kind === "in") ?? points[0];
      const last = [...points].reverse().find((p) => p.kind === "out");
      if (first) add(tag("trailend start", `In ${time(first.at)}`), first.lng, first.lat, "right", [-10, 0]);
      if (last) add(tag("trailend finish", `Out ${time(last.at)}`), last.lng, last.lat, "left", [10, 0]);
      if (live && points.length) {
        const now = points[points.length - 1];
        add(tag("trailend now", `Now · seen ${time(now.at)}`), now.lng, now.lat, "left", [10, 0]);
      }

      // Frame the day: every position and every job he clocked in at. With
      // no positions, that is the job -- never the default view of the
      // county, which is what made the first version say nothing.
      const b = new maplibregl.LngLatBounds();
      for (const p of points) b.extend([p.lng, p.lat]);
      for (const j of jobs) b.extend([j.lng, j.lat]);
      if (!b.isEmpty()) m.fitBounds(b, { padding: 70, maxZoom: 16, duration: 0 });
    };
    if (ready.current) draw(); else m.once("trail-ready", draw);
  }, [points, stops, sites, jobs, live]);

  return <div ref={box} className="trailmap" aria-label="Map of the day's route" />;
}
