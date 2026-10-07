"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export type MapLot = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  /** How it should read at a glance. */
  state: "let" | "empty" | "bare" | "ours" | "candidate";
};

const FILL: Record<MapLot["state"], string> = {
  let: "#2E8B68", empty: "#B0863A", bare: "#8595AC", ours: "#3E6BB0",
  candidate: "#405981",
};

/**
 * The park, on an actual map.
 *
 * The first version of this drew identical rectangles on a grey canvas and
 * called it a plan. It was abstract in the one way that matters: you could
 * not tell by looking whether the homes it had found were yours or the
 * neighbours'. On an aerial photograph that question answers itself in a
 * second, which is the entire reason to put one underneath.
 *
 * Esri's World Imagery as the backdrop. Free, no key, no account, and
 * current enough to show a park that was dirt last spring. The county's own
 * flights are sharper and can be swapped in later -- the markers are at real
 * coordinates, so changing what is underneath them moves nothing.
 */
export default function ParkMap(
  { lots, selected, onSelect, onToggle, picking }:
  {
    lots: MapLot[];
    selected: string | null;
    onSelect: (id: string | null) => void;
    /** In picking mode, clicking a home takes it in or leaves it out. */
    onToggle?: (id: string) => void;
    picking?: boolean;
  },
) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: {
        version: 8,
        sources: {
          aerial: {
            type: "raster",
            tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            maxzoom: 19,
            attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
          },
        },
        layers: [{ id: "aerial", type: "raster", source: "aerial" }],
      },
      center: [-78.91932, 35.09249],
      zoom: 17,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => setReady(true));
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  // Markers rather than a symbol layer: a lot number has to be legible at a
  // glance and clickable with a thumb, and a styled div does both without a
  // sprite sheet.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    markers.current.forEach((mk) => mk.remove());
    markers.current = [];

    for (const lot of lots) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `mapdot ${lot.state}${lot.id === selected ? " on" : ""}`;
      el.style.setProperty("--dot", FILL[lot.state]);
      el.textContent = lot.label;
      el.title = lot.label;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (picking && onToggle) onToggle(lot.id);
        else onSelect(lot.id);
      });
      markers.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([lot.lng, lot.lat]).addTo(m));
    }

    // Framed on what is actually there. A map centred on an address with the
    // homes off the edge is a map of nothing.
    if (lots.length) {
      const b = new maplibregl.LngLatBounds();
      for (const l of lots) b.extend([l.lng, l.lat]);
      m.fitBounds(b, { padding: 60, maxZoom: 19, duration: 0 });
    }
  }, [lots, ready, selected, picking, onToggle, onSelect]);

  return <div ref={box} className="parkmapbox" />;
}
