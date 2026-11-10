"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Where the crew is, as dots.
 *
 * A dot from a ping in the last twenty minutes is solid; anything older, or
 * the clock-in position with nothing since, is hollow -- the same place drawn
 * the same way at two different ages is a claim about now that the data
 * does not make. Job sites with pins are small grey squares, so "he is at
 * the site" and "he is a mile down the road" read at a glance.
 */

export type Dot = {
  id: string; name: string; lat: number; lng: number;
  fresh: boolean; abandoned: boolean;
};
export type SitePin = { id: string; name: string; lat: number; lng: number };

const STYLE = "https://tiles.openfreemap.org/styles/positron";

export default function CrewMap({ dots, sites }: { dots: Dot[]; sites: SitePin[] }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const marks = useRef<maplibregl.Marker[]>([]);
  // The camera is the reader's once they have touched it. Framed once, when
  // the dots first arrive, and not again on every refresh.
  const framed = useRef(false);

  useEffect(() => {
    if (!box.current || map.current) return;
    map.current = new maplibregl.Map({
      container: box.current, style: STYLE,
      center: [-78.9, 35.3], zoom: 7, attributionControl: { compact: true },
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const k of marks.current) k.remove();
    marks.current = [];

    for (const s of sites) {
      const el = document.createElement("div");
      el.className = "crewsite";
      el.title = s.name;
      marks.current.push(new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m));
    }
    for (const d of dots) {
      const el = document.createElement("div");
      el.className = `crewdot${d.fresh ? "" : " stale"}${d.abandoned ? " lost" : ""}`;
      const label = document.createElement("span");
      label.textContent = d.name.split(/\s+/)[0];
      el.appendChild(label);
      el.title = d.name;
      marks.current.push(new maplibregl.Marker({ element: el }).setLngLat([d.lng, d.lat]).addTo(m));
    }

    if (!framed.current && dots.length) {
      framed.current = true;
      const b = new maplibregl.LngLatBounds();
      for (const d of dots) b.extend([d.lng, d.lat]);
      m.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
    }
  }, [dots, sites]);

  return <div ref={box} className="crewmap" aria-label="Map of the crew on the clock" />;
}
