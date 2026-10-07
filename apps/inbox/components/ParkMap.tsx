"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { footprint } from "@/lib/footprint";
import { layOut, boundaryOf, streetLines, countOf, type Plan, type Tap } from "@/lib/parkplan";
import { shapesFrom, roadsFrom, type TileFeature } from "@/lib/harvest";
import type { Shape, Road } from "@/lib/osm";

export type LotState = "let" | "empty" | "bare" | "ours";
export type LotFacts = Record<string, { state: LotState; who?: string }>;

/** The park as the map actually has it. */
export type RealPark = {
  homes: {
    id: string; label: string; street: string; ring: number[][];
    drawn?: boolean; redrawn?: boolean;
  }[];
  streets: { name: string; line: number[][] }[];
  boundary: number[][];
  spare?: number[][][];
  parcel?: string | null;
};

const FILL: Record<LotState, string> = {
  let: "#2E8B68", ours: "#3E6BB0", empty: "#C2703A", bare: "#6B7F99",
};

/** OpenFreeMap serves the whole planet as vector tiles, free and with no
 *  key. Positron is its grey one, which is the look this screen wanted
 *  anyway -- and, far more importantly, it delivers the buildings and the
 *  streets as shapes rather than as a picture of shapes. */
const STYLE = "https://tiles.openfreemap.org/styles/positron";

/**
 * The park, taken out of the map rather than drawn over it.
 *
 * Every earlier version of this put a picture on top: fifty one identical
 * rectangles at an angle I had guessed, laid over a photograph of the real
 * homes. It never lined up, and no amount of dragging was going to make a
 * guess the right shape.
 *
 * The homes were in the map all along. The base map draws every one of
 * them, at the right angle, with both streets curving the way they curve --
 * but as a raster tile, where nothing can be coloured, numbered or clicked.
 * Vector tiles are the same map delivered as geometry, so the park is
 * lifted straight out of what is already on screen. It cannot be out of
 * alignment with the map underneath, because it is the map underneath.
 */
export default function ParkMap(
  { plan, real, facts, selected, onSelect, onHarvest, fitting, onMove, taps, onTap }:
  {
    plan: Plan;
    real?: RealPark | null;
    facts: LotFacts;
    selected: string | null;
    onSelect: (id: string | null) => void;
    /** The buildings and named streets the tiles are carrying, handed up
     *  as soon as they have loaded. */
    onHarvest?: (found: {
      shapes: Shape[]; roads: Road[]; areas: { name: string; ring: number[][] }[];
    }) => void;
    fitting?: boolean;
    onMove?: (lng: number, lat: number) => void;
    taps?: Tap[];
    onTap?: (at: Tap) => void;
  },
) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [sat, setSat] = useState(false);

  const live = useRef({ plan, fitting, onMove, onSelect, onTap, onHarvest });
  live.current = { plan, fitting, onMove, onSelect, onTap, onHarvest };

  // Harvested once the tiles have settled. Tried again on each idle until
  // something turns up, because the first idle can arrive with the
  // buildings still on their way.
  const reaped = useRef(0);
  const reap = useCallback((m: MlMap) => {
    if (reaped.current > 6) return;
    const style = m.getStyle();
    const vector = Object.entries(style.sources ?? {})
      .find(([, s]) => (s as { type?: string }).type === "vector")?.[0];
    if (!vector) return;

    const get = (layer: string): TileFeature[] => {
      try {
        return m.querySourceFeatures(vector, { sourceLayer: layer }) as unknown as TileFeature[];
      } catch { return []; }
    };
    const roads = roadsFrom(get("transportation_name"));
    if (!roads.length) return;
    const shapes = shapesFrom(get("building"));
    // Pieces of land, for the property line. A mobile home park is a
    // landuse polygon in the same tiles, so the real boundary comes down
    // with everything else.
    const areas = shapesFrom(get("landuse")).map((a) => ({
      name: "land", ring: a.ring,
    }));
    reaped.current += 1;
    live.current.onHarvest?.({ shapes, roads, areas });
  }, []);

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      center: plan.centre,
      // Wide enough that the park's streets are inside the tiles that load,
      // which is what the harvest reads. Framed properly a moment later.
      zoom: 15.2,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      // For the one question a drawing cannot answer: is there a home on
      // that pad today. Added under our own layers, which go on after.
      if (!m.getSource("sat")) {
        m.addSource("sat", {
          type: "raster", tileSize: 256, maxzoom: 19,
          tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          attribution: "Imagery © Esri",
        });
        m.addLayer({ id: "sat", type: "raster", source: "sat", layout: { visibility: "none" } });
      }
      setReady(true);
      reap(m);
    });
    m.on("idle", () => reap(m));

    // Moving the block by how far the finger moved, not to where it is.
    let from: { lng: number; lat: number; centre: [number, number]; moved: boolean } | null = null;
    const tapping = () => Boolean(live.current.fitting && live.current.onTap);
    const start = (e: { lngLat: maplibregl.LngLat; preventDefault: () => void }) => {
      if (!live.current.fitting || tapping()) return;
      from = {
        lng: e.lngLat.lng, lat: e.lngLat.lat, moved: false,
        centre: [...live.current.plan.centre] as [number, number],
      };
      m.dragPan.disable();
      e.preventDefault();
    };
    const drag = (e: { lngLat: maplibregl.LngLat }) => {
      if (!from || !live.current.onMove) return;
      const moved = Math.abs(e.lngLat.lng - from.lng) + Math.abs(e.lngLat.lat - from.lat);
      if (!from.moved && moved < 1e-6) return;
      from.moved = true;
      live.current.onMove(
        from.centre[0] + (e.lngLat.lng - from.lng),
        from.centre[1] + (e.lngLat.lat - from.lat),
      );
    };
    const stop = () => { from = null; m.dragPan.enable(); };
    m.on("mousedown", start); m.on("mousemove", drag);
    m.on("mouseup", stop); m.on("mouseout", stop);
    m.on("touchstart", start); m.on("touchmove", drag);
    m.on("touchend", stop); m.on("touchcancel", stop);

    map.current = m;
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    if (m.getLayer("sat")) m.setLayoutProperty("sat", "visibility", sat ? "visible" : "none");
    for (const id of ["home-line", "home-drawn"]) {
      if (m.getLayer(id)) m.setPaintProperty(id, "line-color", sat ? "#ffffff" : "#17212E");
    }
    if (m.getLayer("outside-veil")) {
      // Enough to push the surroundings back, not enough to remove them,
      // and off entirely while the block is being placed by hand -- it was
      // covering the one thing being aimed at.
      m.setPaintProperty("outside-veil", "fill-opacity",
        fitting ? 0 : sat ? 0.62 : 0.4);
    }
    if (m.getLayer("park-fill")) {
      m.setPaintProperty("park-fill", "fill-opacity", fitting ? 0 : sat ? 0.1 : 0.14);
    }
    if (m.getLayer("home-fill")) {
      // Solid. At 0.9 the base map's own grey buildings showed through
      // underneath and every pad came out mottled, which is what "grainy"
      // was looking at -- two drawings of the same building, one on top of
      // the other, almost but not quite aligned.
      m.setPaintProperty("home-fill", "fill-opacity", fitting ? 0.35 : 1);
    }
  }, [sat, ready, fitting]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    const homes: GeoJSON.Feature[] = (real?.homes?.length
      ? real.homes.map((h) => ({ ...h, ring: h.ring }))
      : layOut(plan).map((h) => ({
          id: h.id, label: h.label, street: h.street,
          ring: footprint(h.lat, h.lng, h.bearing, plan.size),
        }))
    ).map((h) => {
      const f = facts[h.id] ?? { state: "bare" as LotState };
      return {
        type: "Feature", id: h.id,
        properties: {
          id: h.id, label: h.label, street: h.street,
          state: f.state, colour: FILL[f.state],
          // A pad the map has never had is still a lot, and still has to
          // be clickable -- but saying so is the difference between a
          // drawing and a claim about the ground.
          drawn: Boolean((h as { drawn?: boolean }).drawn),
        },
        geometry: { type: "Polygon", coordinates: [h.ring] },
      };
    });

    const ring = real?.boundary?.length ? real.boundary : boundaryOf(plan);
    const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];

    const set = (id: string, data: GeoJSON.GeoJSON) => {
      const src = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(data); else m.addSource(id, { type: "geojson", data });
    };
    set("outside", {
      type: "Feature", properties: {},
      geometry: { type: "Polygon", coordinates: [world, [...ring].reverse()] },
    });
    set("park", {
      type: "Feature", properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    });
    set("homes", { type: "FeatureCollection", features: homes });
    set("streets", {
      type: "FeatureCollection",
      features: (real?.streets ?? streetLines(plan)).map((st) => ({
        type: "Feature", properties: { name: st.name },
        geometry: { type: "LineString", coordinates: st.line },
      })),
    });
    set("others", {
      type: "FeatureCollection",
      features: (real?.spare ?? []).map((r) => ({
        type: "Feature", properties: {},
        geometry: { type: "Polygon", coordinates: [r] },
      })),
    });
    set("taps", {
      type: "FeatureCollection",
      features: (taps ?? []).map((p, i) => ({
        type: "Feature", properties: { n: String(i + 1) },
        geometry: { type: "Point", coordinates: p },
      })),
    });

    if (!m.getLayer("outside-veil")) {
      const font = ["Noto Sans Bold"];
      m.addLayer({ id: "outside-veil", type: "fill", source: "outside",
        paint: { "fill-color": "#DCE1E7", "fill-opacity": 0.4 } });
      m.addLayer({ id: "park-fill", type: "fill", source: "park",
        paint: { "fill-color": "#BCD6F2", "fill-opacity": 0.14 } });
      m.addLayer({ id: "park-line", type: "line", source: "park",
        paint: { "line-color": "#1F5BA6", "line-width": 2.5 } });

      m.addLayer({ id: "other-fill", type: "fill", source: "others",
        paint: { "fill-color": "#AFB7C2", "fill-opacity": 0.45 } });
      m.addLayer({ id: "home-fill", type: "fill", source: "homes",
        paint: { "fill-color": ["get", "colour"], "fill-opacity": 1 } });
      // Two layers rather than one with an expression: line-dasharray is
      // a constant-only property in MapLibre, and a data-driven one throws
      // on style load and takes the whole map with it.
      m.addLayer({ id: "home-line", type: "line", source: "homes",
        filter: ["!", ["get", "drawn"]],
        paint: { "line-color": "#17212E", "line-width": 1.2 } });
      m.addLayer({ id: "home-drawn", type: "line", source: "homes",
        filter: ["get", "drawn"],
        paint: { "line-color": "#17212E", "line-width": 1.2, "line-dasharray": [2, 1.5] } });
      m.addLayer({ id: "home-on", type: "line", source: "homes",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#0F1729", "line-width": 3.5 } });
      m.addLayer({ id: "home-label", type: "symbol", source: "homes", minzoom: 16.5,
        layout: { "text-field": ["get", "label"], "text-size": 10, "text-font": font,
                  "text-allow-overlap": false, "text-padding": 1 },
        paint: { "text-color": "#ffffff", "text-halo-color": "#19202B", "text-halo-width": 1.2 } });
      m.addLayer({ id: "street-label", type: "symbol", source: "streets",
        layout: { "text-field": ["get", "name"], "text-size": 13, "text-font": font,
                  "symbol-placement": "line-center", "text-letter-spacing": 0.06 },
        paint: { "text-color": "#1F3C66", "text-halo-color": "#ffffff", "text-halo-width": 2.5 } });

      m.addLayer({ id: "tap-dot", type: "circle", source: "taps",
        paint: { "circle-radius": 9, "circle-color": "#D1453B",
                 "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
      m.addLayer({ id: "tap-n", type: "symbol", source: "taps",
        layout: { "text-field": ["get", "n"], "text-size": 11, "text-font": font,
                  "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" } });

      m.on("click", (e) => {
        if (live.current.fitting) {
          if (live.current.onTap) live.current.onTap([e.lngLat.lng, e.lngLat.lat]);
          return;
        }
        const f = m.queryRenderedFeatures(e.point, { layers: ["home-fill"] })[0];
        live.current.onSelect(f ? String(f.properties?.id ?? "") : null);
      });
      m.on("mouseenter", "home-fill", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "home-fill", () => { m.getCanvas().style.cursor = ""; });
    }

    m.setFilter("home-on", ["==", ["get", "id"], selected ?? ""]);
  }, [plan, real, facts, ready, selected, taps]);

  // Framed on what is drawn, once per set of geometry. Re-framing on every
  // nudge would yank the map out from under somebody placing the block.
  const framed = useRef("");
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const what = `${real?.boundary?.length ? "real" : "drawn"}:${real?.homes?.length ?? 0}`;
    if (framed.current === what) return;
    framed.current = what;
    const id = requestAnimationFrame(() => frame());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, real]);

  function frame() {
    const m = map.current;
    if (!m) return;
    const ring = real?.boundary?.length ? real.boundary : boundaryOf(plan);
    const b = new maplibregl.LngLatBounds();
    for (const p of ring) b.extend([p[0], p[1]]);
    // Measured again here: the container is sized by CSS that may not have
    // settled when the map first says it has loaded.
    m.resize();
    m.fitBounds(b, { padding: 28, maxZoom: 19, duration: 400 });
  }

  return (
    <div className="parkmapwrap">
      <div ref={box} className={`parkmapbox${fitting ? " fitting" : ""}`} />
      <div className="parkmapbar">
        <button type="button" className={sat ? "btn" : "btn pri"} onClick={() => setSat(false)}>
          Plan
        </button>
        <button type="button" className={sat ? "btn pri" : "btn"} onClick={() => setSat(true)}>
          Aerial
        </button>
        <button type="button" className="btn" onClick={frame}>Fit view</button>
        <span className="dim">{countOf(plan)} lots</span>
      </div>
    </div>
  );
}
