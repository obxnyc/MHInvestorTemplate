"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { footprint, bearingsForRow, metresBetween } from "@/lib/footprint";

export type MapLot = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  street: string | null;
  state: "let" | "empty" | "bare" | "ours" | "out";
};

/** The four states, and the one that means "not part of this park". Chosen so
 *  the two that cost money carry the colour and the ordinary case is calm. */
const FILL: Record<MapLot["state"], string> = {
  let: "#2E8B68", ours: "#3E6BB0", empty: "#C2703A", bare: "#8FA3BE", out: "#C9D2DC",
};

/**
 * The park, drawn the way a marina draws its slips.
 *
 * Three decisions, all of them from looking at one that works.
 *
 * The surroundings are grey and the park is not. A satellite photograph shows
 * trees, parked cars and a neighbour's shed with equal emphasis, and none of
 * those are the thing being looked at. A pale base map puts the roads and the
 * buildings around the park in the background where they belong, and the one
 * coloured thing on the screen is what you own.
 *
 * A home is a rectangle on the ground, not a pin. They are all the same model,
 * so they are all the same rectangle, and at the zoom where you can read a lot
 * number you can also see which pad is which. A pin says roughly where; an
 * outline says which one.
 *
 * And the labels arrive as you zoom: the street names first, because that is
 * how somebody orients themselves, then the lot numbers once the homes are big
 * enough to carry them. Everything at once is a wall of text at every zoom.
 */
export default function ParkMap(
  { lots, selected, onSelect, onToggle, picking, boundary }:
  {
    lots: MapLot[];
    selected: string | null;
    onSelect: (id: string | null) => void;
    onToggle?: (id: string) => void;
    picking?: boolean;
    /** The parcel, when the county gave us one. */
    boundary?: GeoJSON.Geometry | null;
  },
) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [sat, setSat] = useState(false);

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: {
        version: 8,
        glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
        sources: {
          // Carto Positron: roads, building blocks and street names in pale
          // grey, nothing else competing. Free, no key, attribution below.
          plain: {
            type: "raster", tileSize: 256, maxzoom: 20,
            tiles: [
              "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
            ],
            attribution: "© OpenStreetMap contributors, © CARTO",
          },
          // Kept for the one question a drawing cannot answer: is there
          // actually a home on that pad today.
          sat: {
            type: "raster", tileSize: 256, maxzoom: 19,
            tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            attribution: "Imagery © Esri",
          },
        },
        layers: [
          { id: "plain", type: "raster", source: "plain" },
          { id: "sat", type: "raster", source: "sat", layout: { visibility: "none" } },
        ],
      },
      center: [-78.91932, 35.09249],
      zoom: 17,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => setReady(true));
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setLayoutProperty("sat", "visibility", sat ? "visible" : "none");
    m.setLayoutProperty("plain", "visibility", sat ? "none" : "visible");
  }, [sat, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    // Homes grouped by street, so each row works out its own angle from its
    // own neighbours. Doing it across the whole park would let a home on
    // Lady Cheryl take its bearing from one on Lady Viola.
    const byStreet = new Map<string, MapLot[]>();
    for (const l of lots) {
      const k = l.street ?? "—";
      byStreet.set(k, [...(byStreet.get(k) ?? []), l]);
    }
    const angle = new Map<string, number>();
    for (const row of byStreet.values()) {
      bearingsForRow(row).forEach((b, i) => angle.set(row[i].id, b));
    }

    const homes: GeoJSON.Feature[] = lots.map((l) => ({
      type: "Feature",
      id: l.id,
      properties: { id: l.id, label: l.label, state: l.state, colour: FILL[l.state] },
      geometry: { type: "Polygon", coordinates: [footprint(l.lat, l.lng, angle.get(l.id) ?? 0)] },
    }));

    // One label per street, at the middle of its homes.
    const streets: GeoJSON.Feature[] = [...byStreet]
      .filter(([k, v]) => k !== "—" && v.length > 1)
      .map(([name, row]) => ({
        type: "Feature",
        properties: { name },
        geometry: {
          type: "Point",
          coordinates: [
            row.reduce((a, l) => a + l.lng, 0) / row.length,
            row.reduce((a, l) => a + l.lat, 0) / row.length,
          ],
        },
      }));

    const set = (id: string, data: GeoJSON.FeatureCollection | GeoJSON.Feature) => {
      const src = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(data as GeoJSON.GeoJSON);
      else m.addSource(id, { type: "geojson", data: data as GeoJSON.GeoJSON });
    };

    if (boundary) set("parcel", { type: "Feature", properties: {}, geometry: boundary });
    set("homes", { type: "FeatureCollection", features: homes });
    set("streets", { type: "FeatureCollection", features: streets });

    if (boundary && !m.getLayer("parcel-fill")) {
      m.addLayer({ id: "parcel-fill", type: "fill", source: "parcel",
        paint: { "fill-color": "#CFE0F5", "fill-opacity": 0.55 } });
      m.addLayer({ id: "parcel-line", type: "line", source: "parcel",
        paint: { "line-color": "#6E8CAE", "line-width": 2 } });
    }
    if (!m.getLayer("home-fill")) {
      m.addLayer({ id: "home-fill", type: "fill", source: "homes",
        paint: { "fill-color": ["get", "colour"], "fill-opacity": 0.85 } });
      m.addLayer({ id: "home-line", type: "line", source: "homes",
        paint: { "line-color": "#ffffff", "line-width": 1.2 } });
      m.addLayer({ id: "home-on", type: "line", source: "homes",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#0F1729", "line-width": 3 } });
      // The number appears once a home is big enough to hold it. Below that
      // it is a smear and the street name is what you want anyway.
      m.addLayer({ id: "home-label", type: "symbol", source: "homes", minzoom: 17.5,
        layout: { "text-field": ["get", "label"], "text-size": 11,
                  "text-font": ["Open Sans Bold"], "text-allow-overlap": false },
        paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1 } });
      m.addLayer({ id: "street-label", type: "symbol", source: "streets", maxzoom: 18.5,
        layout: { "text-field": ["get", "name"], "text-size": 14,
                  "text-font": ["Open Sans Bold"], "text-letter-spacing": 0.08 },
        paint: { "text-color": "#33507E", "text-halo-color": "#ffffff", "text-halo-width": 2 } });

      const hit = (e: maplibregl.MapMouseEvent) => {
        const f = m.queryRenderedFeatures(e.point, { layers: ["home-fill"] })[0];
        if (!f) { if (!picking) onSelect(null); return; }
        const id = String(f.properties?.id ?? "");
        if (picking && onToggle) onToggle(id); else onSelect(id);
      };
      m.on("click", hit);
      m.on("mouseenter", "home-fill", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "home-fill", () => { m.getCanvas().style.cursor = ""; });
    }

    m.setFilter("home-on", ["==", ["get", "id"], selected ?? ""]);

    // Framed on what is there, once. Re-framing on every change would yank
    // the map out from under somebody who has just panned to a corner.
    if (homes.length && !m.getLayer("framed")) {
      const b = new maplibregl.LngLatBounds();
      for (const l of lots) b.extend([l.lng, l.lat]);
      m.fitBounds(b, { padding: 70, maxZoom: 19, duration: 0 });
      m.addLayer({ id: "framed", type: "background",
        layout: { visibility: "none" }, paint: {} });
    }
  }, [lots, ready, selected, picking, onToggle, onSelect, boundary]);

  // How far apart the homes are, which is the honest check on whether the
  // county's points are pads or something else entirely.
  const spacing = lots.length > 2
    ? Math.round(metresBetween([lots[0].lng, lots[0].lat], [lots[1].lng, lots[1].lat]))
    : null;

  return (
    <div className="parkmapwrap">
      <div ref={box} className="parkmapbox" />
      <div className="parkmapbar">
        <button type="button" className={sat ? "btn" : "btn pri"} onClick={() => setSat(false)}>
          Plan
        </button>
        <button type="button" className={sat ? "btn pri" : "btn"} onClick={() => setSat(true)}>
          Aerial
        </button>
        {spacing !== null && (
          <span className="dim">Homes about {spacing} m apart</span>
        )}
      </div>
    </div>
  );
}
