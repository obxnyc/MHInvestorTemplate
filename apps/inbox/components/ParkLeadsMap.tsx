"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Every park owner as a dot, coloured by where they stand.
 *
 * One GeoJSON layer rather than a marker per owner: three and a half
 * thousand DOM markers is a map that stutters on a phone. The camera is the
 * reader's -- framed once when the dots arrive and when the region changes,
 * never on a filter or a click, because a map that jumps every time a chip
 * is pressed is a map nobody can work on.
 */

export type MapDot = { key: string; lat: number; lon: number; stage: string; starred: boolean };

const STYLE = "https://tiles.openfreemap.org/styles/positron";
export const SANFORD_LON = -79.18;

export const STAGE_COLOR: Record<string, string> = {
  new: "#8595AC",
  researching: "#B0863A",
  contacted: "#3E6BB0",
  talking: "#7B4FC2",
  offer: "#C2703A",
  contract: "#2E8B68",
  closed: "#0F4B36",
  dead: "#6B7280",
};

export default function ParkLeadsMap({
  dots, selected, onSelect, frameKey,
}: {
  dots: MapDot[];
  selected: string | null;
  onSelect: (key: string) => void;
  /** Changes when the region changes -- the one time the map re-frames. */
  frameKey: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const framed = useRef<string | null>(null);
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const latest = useRef<{ dots: MapDot[]; selected: string | null }>({ dots, selected });
  latest.current = { dots, selected };

  const fc = (ds: MapDot[], sel: string | null) => ({
    type: "FeatureCollection" as const,
    features: ds.map((d) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [d.lon, d.lat] },
      properties: { key: d.key, color: STAGE_COLOR[d.stage] ?? STAGE_COLOR.new, sel: d.key === sel ? 1 : 0, star: d.starred ? 1 : 0 },
    })),
  });

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = new maplibregl.Map({
      container: box.current, style: STYLE, center: [-78.6, 35.4], zoom: 6.4,
      attributionControl: { compact: true },
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      m.addSource("sanford", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[SANFORD_LON, 33.7], [SANFORD_LON, 36.7]] } },
      });
      m.addLayer({ id: "sanford", type: "line", source: "sanford",
        paint: { "line-color": "#405981", "line-width": 1.2, "line-dasharray": [3, 3], "line-opacity": 0.55 } });
      m.addSource("owners", { type: "geojson", data: fc(latest.current.dots, latest.current.selected) });
      m.addLayer({
        id: "owners", type: "circle", source: "owners",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, ["case", ["==", ["get", "sel"], 1], 8, 3.2], 12, ["case", ["==", ["get", "sel"], 1], 13, 7]],
          "circle-color": ["get", "color"],
          "circle-stroke-color": ["case", ["==", ["get", "sel"], 1], "#0F1729", ["==", ["get", "star"], 1], "#E0A100", "#FFFFFF"],
          "circle-stroke-width": ["case", ["==", ["get", "sel"], 1], 2.5, ["==", ["get", "star"], 1], 2, 0.8],
        },
      });
      m.on("click", "owners", (e) => {
        const k = e.features?.[0]?.properties?.key;
        if (k) pick.current(String(k));
      });
      m.on("mouseenter", "owners", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "owners", () => { m.getCanvas().style.cursor = ""; });
      ready.current = true;
      sync();
    });
    return () => { m.remove(); map.current = null; ready.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sync() {
    const m = map.current;
    if (!m || !ready.current) return;
    const { dots: ds, selected: sel } = latest.current;
    (m.getSource("owners") as GeoJSONSource | undefined)?.setData(fc(ds, sel));
    if (framed.current !== frameKeyRef.current && ds.length) {
      framed.current = frameKeyRef.current;
      const b = new maplibregl.LngLatBounds();
      for (const d of ds) b.extend([d.lon, d.lat]);
      m.fitBounds(b, { padding: 40, maxZoom: 12, duration: 0 });
    }
  }
  const frameKeyRef = useRef(frameKey);
  frameKeyRef.current = frameKey;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { sync(); }, [dots, selected, frameKey]);

  // The selected owner is brought into view only if it is off screen; the
  // zoom stays whatever the reader chose.
  useEffect(() => {
    const m = map.current;
    if (!m || !selected) return;
    const d = latest.current.dots.find((x) => x.key === selected);
    if (!d) return;
    if (!m.getBounds().contains([d.lon, d.lat])) m.easeTo({ center: [d.lon, d.lat], duration: 400 });
  }, [selected]);

  return <div ref={box} className="pk-map" aria-label="Map of park owners" />;
}
