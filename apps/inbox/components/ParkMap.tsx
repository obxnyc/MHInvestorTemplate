"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { footprint } from "@/lib/footprint";
import { layOut, boundaryOf, streetLines, countOf, type Plan } from "@/lib/parkplan";

export type LotState = "let" | "empty" | "bare" | "ours";

/** What is known about a pad beyond where it is. Keyed by the plan's id,
 *  so a park with nothing on file still draws. */
export type LotFacts = Record<string, { state: LotState; who?: string }>;

const FILL: Record<LotState, string> = {
  let: "#2E8B68", ours: "#3E6BB0", empty: "#C2703A", bare: "#8FA3BE",
};

/**
 * The park, drawn the way a marina draws its slips.
 *
 * Everything around the park is grey and the park is not. A satellite
 * photograph gives a neighbour's shed the same weight as your own row of
 * homes; a greyed street map puts the surroundings behind glass and leaves
 * one coloured thing on the screen, which is what you own.
 *
 * A home is a rectangle on the ground, not a pin. They are all the same
 * model, so they are all the same rectangle -- and at the zoom where a lot
 * number is readable you can see which pad it belongs to. A pin says roughly
 * where. An outline says which one.
 *
 * The labels arrive in the order somebody orients themselves: the street
 * names from the base map straight away, then the lot numbers once the homes
 * are big enough to hold them.
 */
export default function ParkMap(
  { plan, facts, selected, onSelect, fitting, onMove }:
  {
    plan: Plan;
    facts: LotFacts;
    selected: string | null;
    onSelect: (id: string | null) => void;
    /** Dragging moves the park rather than the map, so the block can be put
     *  over the pads on the aerial. */
    fitting?: boolean;
    onMove?: (lng: number, lat: number) => void;
  },
) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [sat, setSat] = useState(false);

  // Read inside map handlers that are registered once. A handler closing
  // over the first render's props would still be moving the first plan.
  const live = useRef({ plan, fitting, onMove, onSelect });
  live.current = { plan, fitting, onMove, onSelect };

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: {
        version: 8,
        glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
        sources: {
          // OpenStreetMap, drained of colour in the paint below. Carto's
          // free Positron endpoint started serving API KEY REQUIRED
          // watermarks across the whole map, which is what "this is all
          // messed up" was looking at. This one needs no key, carries the
          // street names, and goes to the zoom where a pad is readable.
          plain: {
            type: "raster", tileSize: 256, maxzoom: 19,
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            attribution: "© OpenStreetMap contributors",
          },
          // For the one question a drawing cannot answer: is there a home on
          // that pad today.
          sat: {
            type: "raster", tileSize: 256, maxzoom: 19,
            tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            attribution: "Imagery © Esri",
          },
        },
        layers: [
          {
            id: "plain", type: "raster", source: "plain",
            paint: {
              "raster-saturation": -1,
              "raster-contrast": -0.25,
              "raster-brightness-min": 0.45,
              "raster-opacity": 0.75,
            },
          },
          { id: "sat", type: "raster", source: "sat", layout: { visibility: "none" } },
        ],
      },
      center: plan.centre,
      zoom: 17.6,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => setReady(true));

    // Moving the block. The gesture is a drag on the map, so the map's own
    // pan has to stand down for the duration or the park and the background
    // both move and nothing lines up with anything.
    let dragging = false;
    m.on("mousedown", (e) => {
      if (!live.current.fitting) return;
      dragging = true;
      m.dragPan.disable();
      e.preventDefault();
    });
    m.on("mousemove", (e) => {
      if (!dragging || !live.current.onMove) return;
      live.current.onMove(e.lngLat.lng, e.lngLat.lat);
    });
    const stop = () => { dragging = false; m.dragPan.enable(); };
    m.on("mouseup", stop);
    m.on("mouseout", stop);

    map.current = m;
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setLayoutProperty("sat", "visibility", sat ? "visible" : "none");
    m.setLayoutProperty("plain", "visibility", sat ? "none" : "visible");
    // White outlines read on a photograph; on a pale street map they vanish.
    if (m.getLayer("home-line")) {
      m.setPaintProperty("home-line", "line-color", sat ? "#ffffff" : "#2A3A4F");
    }
  }, [sat, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    const homes: GeoJSON.Feature[] = layOut(plan).map((h) => {
      const f = facts[h.id] ?? { state: "bare" as LotState };
      return {
        type: "Feature",
        id: h.id,
        properties: {
          id: h.id, label: h.label, street: h.street,
          state: f.state, colour: FILL[f.state],
        },
        geometry: { type: "Polygon", coordinates: [footprint(h.lat, h.lng, h.bearing, plan.size)] },
      };
    });

    const bounds: GeoJSON.Feature = {
      type: "Feature", properties: {},
      geometry: { type: "Polygon", coordinates: [boundaryOf(plan)] },
    };

    const streets: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: streetLines(plan).map(({ name, line }) => ({
        type: "Feature", properties: { name },
        geometry: { type: "LineString", coordinates: line },
      })),
    };

    const set = (id: string, data: GeoJSON.GeoJSON) => {
      const src = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(data); else m.addSource(id, { type: "geojson", data });
    };
    set("park", bounds);
    set("homes", { type: "FeatureCollection", features: homes });
    set("streets", streets);

    if (!m.getLayer("park-fill")) {
      // The boundary, under everything. Pale enough to lift the park off the
      // grey without colouring the homes that sit on it.
      m.addLayer({ id: "park-fill", type: "fill", source: "park",
        paint: { "fill-color": "#BCD6F2", "fill-opacity": 0.45 } });
      m.addLayer({ id: "park-line", type: "line", source: "park",
        paint: { "line-color": "#1F5BA6", "line-width": 2.5 } });

      m.addLayer({ id: "home-fill", type: "fill", source: "homes",
        paint: { "fill-color": ["get", "colour"], "fill-opacity": 0.9 } });
      m.addLayer({ id: "home-line", type: "line", source: "homes",
        paint: { "line-color": "#2A3A4F", "line-width": 1 } });
      m.addLayer({ id: "home-on", type: "line", source: "homes",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#0F1729", "line-width": 3.5 } });

      // Numbers appear when a home is wide enough to hold one. Below that
      // MapLibre drops the ones that would collide, which is the right
      // answer: a smear of overlapping digits tells you nothing.
      m.addLayer({ id: "home-label", type: "symbol", source: "homes", minzoom: 16.5,
        layout: {
          "text-field": ["get", "label"], "text-size": 10,
          "text-font": ["Open Sans Bold"], "text-rotation-alignment": "map",
          "text-allow-overlap": false, "text-padding": 1,
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "#19202B", "text-halo-width": 1.2 } });

      // Our own street names, written down the middle of each street. The
      // base map has them too, but not at every zoom and not where the eye
      // is already looking.
      m.addLayer({ id: "street-label", type: "symbol", source: "streets",
        layout: {
          "text-field": ["get", "name"], "text-size": 13,
          "text-font": ["Open Sans Bold"], "symbol-placement": "line-center",
          "text-letter-spacing": 0.06,
        },
        paint: { "text-color": "#1F3C66", "text-halo-color": "#ffffff", "text-halo-width": 2.5 } });

      m.on("click", (e) => {
        if (live.current.fitting) return;
        const f = m.queryRenderedFeatures(e.point, { layers: ["home-fill"] })[0];
        live.current.onSelect(f ? String(f.properties?.id ?? "") : null);
      });
      m.on("mouseenter", "home-fill", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "home-fill", () => { m.getCanvas().style.cursor = ""; });
    }

    m.setFilter("home-on", ["==", ["get", "id"], selected ?? ""]);
  }, [plan, facts, ready, selected]);

  // Framed once, on what is drawn. Re-framing on every nudge would yank the
  // map out from under somebody dragging the block into place.
  const framed = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || framed.current) return;
    framed.current = true;
    frame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function frame() {
    const m = map.current;
    if (!m) return;
    const b = new maplibregl.LngLatBounds();
    for (const p of boundaryOf(plan)) b.extend([p[0], p[1]]);
    m.fitBounds(b, { padding: 40, maxZoom: 19, duration: 400 });
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
