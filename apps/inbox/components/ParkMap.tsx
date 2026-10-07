"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { footprint } from "@/lib/footprint";
import { layOut, boundaryOf, maskOf, streetLines, countOf, type Plan, type Tap } from "@/lib/parkplan";

export type LotState = "let" | "empty" | "bare" | "ours";

/** What is known about a pad beyond where it is. Keyed by the plan's id,
 *  so a park with nothing on file still draws. */
export type LotFacts = Record<string, { state: LotState; who?: string }>;

/** The park as OpenStreetMap actually has it: real outlines, real roads.
 *  When this is here the drawn block is not used at all. */
export type RealPark = {
  homes: { id: string; label: string; street: string; ring: number[][] }[];
  streets: { name: string; line: number[][] }[];
  boundary: number[][];
  /** Buildings on the park that no lot number claimed -- sheds, the office,
   *  a carport. Drawn, in grey, because they are there. */
  spare?: number[][][];
};

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
  { plan, real, facts, selected, onSelect, fitting, onMove, taps, onTap }:
  {
    plan: Plan;
    real?: RealPark | null;
    facts: LotFacts;
    selected: string | null;
    onSelect: (id: string | null) => void;
    /** Dragging moves the park rather than the map, so the block can be put
     *  over the pads on the aerial. */
    fitting?: boolean;
    onMove?: (lng: number, lat: number) => void;
    /** Pads tapped on the photograph, while being pinned. */
    taps?: Tap[];
    onTap?: (at: Tap) => void;
  },
) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [sat, setSat] = useState(false);

  // Read inside map handlers that are registered once. A handler closing
  // over the first render's props would still be moving the first plan.
  const live = useRef({ plan, fitting, onMove, onSelect, onTap });
  live.current = { plan, fitting, onMove, onSelect, onTap };

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

    // Moving the block.
    //
    // By how far the finger moved, not to where it is. Setting the centre to
    // the cursor teleports the whole park under the pointer on the first
    // pixel of movement, which makes "it is off by twenty feet" impossible to
    // correct -- you can never grab a corner, only re-drop the middle.
    //
    // The map's own pan stands down for the duration, or the park and the
    // photograph move together and nothing ever lines up.
    let from: { lng: number; lat: number; centre: [number, number]; moved: boolean } | null = null;
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
      // A tap is a press that did not move. Without this, every attempt to
      // tap a pad nudges the park by whatever the hand wobbled, and tapping
      // and dragging cannot both live on the same gesture.
      const moved = Math.abs(e.lngLat.lng - from.lng) + Math.abs(e.lngLat.lat - from.lat);
      if (!from.moved && moved < 1e-6) return;
      from.moved = true;
      live.current.onMove(
        from.centre[0] + (e.lngLat.lng - from.lng),
        from.centre[1] + (e.lngLat.lat - from.lat),
      );
    };
    const stop = () => { from = null; m.dragPan.enable(); };
    // Suppress the drag entirely while pads are being tapped: the two
    // gestures are the same gesture, and the taps are the exact one.
    const tapping = () => Boolean(live.current.fitting && live.current.onTap);
    m.on("mousedown", start);
    m.on("mousemove", drag);
    m.on("mouseup", stop);
    m.on("mouseout", stop);
    m.on("touchstart", start);
    m.on("touchmove", drag);
    m.on("touchend", stop);
    m.on("touchcancel", stop);

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
    // A photograph has far more in it than a street map, so it takes a
    // heavier veil to go quiet; over the grey plan the same opacity would
    // erase the surrounding streets entirely and leave the park floating.
    //
    // And while the block is being fitted the veil comes off altogether.
    // It was covering the one thing being aimed at: you cannot line the
    // park up with pads you cannot see, which is most of why fitting felt
    // impossible.
    if (m.getLayer("outside-veil")) {
      m.setPaintProperty("outside-veil", "fill-opacity",
        fitting ? 0 : sat ? 0.9 : 0.78);
    }
    if (m.getLayer("park-fill")) {
      m.setPaintProperty("park-fill", "fill-opacity",
        fitting ? 0 : sat ? 0.12 : 0.4);
    }
    // See-through while fitting, for the same reason.
    if (m.getLayer("home-fill")) {
      m.setPaintProperty("home-fill", "fill-opacity", fitting ? 0.35 : 0.9);
    }
  }, [sat, ready, fitting]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    // Real outlines when OpenStreetMap has them, the drawn block when it
    // does not. Everything below this point is the same either way, which
    // is the point: one set of layers, two sources of geometry.
    const homes: GeoJSON.Feature[] = (real
      ? real.homes.map((h) => ({ ...h, ring: h.ring }))
      : layOut(plan).map((h) => ({
          id: h.id, label: h.label, street: h.street,
          ring: footprint(h.lat, h.lng, h.bearing, plan.size),
        }))
    ).map((h) => {
      const f = facts[h.id] ?? { state: "bare" as LotState };
      return {
        type: "Feature",
        id: h.id,
        properties: {
          id: h.id, label: h.label, street: h.street,
          state: f.state, colour: FILL[f.state],
        },
        geometry: { type: "Polygon", coordinates: [h.ring] },
      };
    });

    const ring = real?.boundary?.length ? real.boundary : boundaryOf(plan);
    const bounds: GeoJSON.Feature = {
      type: "Feature", properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    };

    const streets: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: (real?.streets ?? streetLines(plan)).map((st) => ({
        type: "Feature", properties: { name: st.name },
        geometry: { type: "LineString", coordinates: st.line },
      })),
    };

    // Everything else standing on the park. Drawn flat and grey: leaving
    // them out makes the park look emptier than it is, and colouring them
    // says they are lots.
    const others: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: (real?.spare ?? []).map((r) => ({
        type: "Feature", properties: {},
        geometry: { type: "Polygon", coordinates: [r] },
      })),
    };

    const set = (id: string, data: GeoJSON.GeoJSON) => {
      const src = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(data); else m.addSource(id, { type: "geojson", data });
    };
    const mask: GeoJSON.Feature = {
      type: "Feature", properties: {},
      geometry: {
        type: "Polygon",
        coordinates: real?.boundary?.length
          ? [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]],
             [...real.boundary].reverse()]
          : maskOf(plan),
      },
    };
    set("outside", mask);
    set("park", bounds);
    set("others", others);
    set("taps", {
      type: "FeatureCollection",
      features: (taps ?? []).map((p, i) => ({
        type: "Feature", properties: { n: String(i + 1) },
        geometry: { type: "Point", coordinates: p },
      })),
    });
    set("homes", { type: "FeatureCollection", features: homes });
    set("streets", streets);

    if (!m.getLayer("outside-veil")) {
      // Everything that is not the park, behind glass. On the aerial this is
      // what takes the trees, the neighbour's yard and the scrapyard over the
      // fence out of the picture -- there is nothing to switch off in a
      // photograph, so the only way to remove them is to cover them.
      m.addLayer({ id: "outside-veil", type: "fill", source: "outside",
        paint: { "fill-color": "#E3E7EC", "fill-opacity": 0.88 } });
    }
    if (!m.getLayer("park-fill")) {
      // The boundary, under everything. Pale enough to lift the park off the
      // grey without colouring the homes that sit on it.
      m.addLayer({ id: "park-fill", type: "fill", source: "park",
        paint: { "fill-color": "#BCD6F2", "fill-opacity": 0.45 } });
      m.addLayer({ id: "park-line", type: "line", source: "park",
        paint: { "line-color": "#1F5BA6", "line-width": 2.5 } });

      m.addLayer({ id: "other-fill", type: "fill", source: "others",
        paint: { "fill-color": "#AFB7C2", "fill-opacity": 0.45 } });
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
        if (live.current.fitting) {
          if (live.current.onTap) live.current.onTap([e.lngLat.lng, e.lngLat.lat]);
          return;
        }
        const f = m.queryRenderedFeatures(e.point, { layers: ["home-fill"] })[0];
        live.current.onSelect(f ? String(f.properties?.id ?? "") : null);
      });
      // Where each tap landed, numbered, so a misplaced one is obvious
      // before three more are put on top of it.
      m.addLayer({ id: "tap-dot", type: "circle", source: "taps",
        paint: { "circle-radius": 9, "circle-color": "#D1453B",
                 "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
      m.addLayer({ id: "tap-n", type: "symbol", source: "taps",
        layout: { "text-field": ["get", "n"], "text-size": 11,
                  "text-font": ["Open Sans Bold"], "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" } });

      m.on("mouseenter", "home-fill", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "home-fill", () => { m.getCanvas().style.cursor = ""; });
    }

    m.setFilter("home-on", ["==", ["get", "id"], selected ?? ""]);
  }, [plan, real, facts, ready, selected, taps]);

  // Framed on what is drawn, once per set of geometry. Re-framing on every
  // nudge would yank the map out from under somebody dragging the block into
  // place; never re-framing leaves the park a blob in a field of grey when
  // the real outlines arrive a second after the page opens.
  const framed = useRef("");
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const what = real?.boundary?.length ? "real" : "drawn";
    if (framed.current === what) return;
    framed.current = what;
    // After paint, so the container has the height its CSS gives it.
    const id = requestAnimationFrame(() => frame());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, real]);

  // A phone rotating, or the card opening beside the map, changes the box
  // the park has to fit in. MapLibre does not notice on its own.
  useEffect(() => {
    const el = box.current;
    if (!el || !ready) return;
    const ro = new ResizeObserver(() => map.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
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
