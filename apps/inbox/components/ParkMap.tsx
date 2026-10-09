"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { footprint, middleOfRing } from "@/lib/footprint";
import { padAt } from "@/lib/nearpad";
import { layOut, boundaryOf, streetLines, countOf, type Plan, type Tap } from "@/lib/parkplan";
import { shapesFrom, roadsFrom, type TileFeature } from "@/lib/harvest";
import type { Shape, Road } from "@/lib/osm";

/** Who owns the home standing on the pad. The LOT is always the park's;
 *  this is the home, which is a different thing and the one that decides
 *  who gets rung about a leaking roof. */
export type Owner = "poh" | "toh" | "ioh" | "none";

export type LotFact = {
  owner: Owner;
  /** A home is there and nobody is in it. Not the same as `none`, which
   *  is a pad with no home on it at all. */
  empty: boolean;
  /** We let it and look after it. Always true of a home we own. */
  managed: boolean;
  /** On a home we still own, what it is for. Only 'to_sell' is stock;
   *  'we_rent' we are keeping, and 'not_home' is the office or the
   *  laundry. Undefined before 033, which the tally says rather than
   *  guesses at. */
  use?: "to_sell" | "we_rent" | "not_home" | null;
  who?: string;
};
export type LotFacts = Record<string, LotFact>;

/** The park as the map actually has it. */
export type RealPark = {
  homes: {
    id: string; label: string; street: string; ring: number[][];
    /** What this lot is filed under in the database. Built once, where
     *  the park is built, because eight call sites each rebuilding it
     *  from label and street is seven chances to drift -- which has
     *  already cost an hour here, when a drag saved against "3124" and
     *  the lot was on file as "3124 Lady Viola Dr". */
    filed: string;
    /** The road end of the pad, where the managed badge sits. */
    dot?: [number, number];
    drawn?: boolean;
    /** Put here by hand rather than by the layout. */
    moved?: boolean;
  }[];
  streets: { name: string; line: number[][] }[];
  boundary: number[][];
  /** The park's own roads, the unnamed loop included. */
  lanes?: number[][][];
  parcel?: string | null;
};

/**
 * Three facts on one small rectangle, in the order they are asked.
 *
 * Who owns the home is the identity question somebody scans for, so it
 * takes the strongest channel there is: the fill colour. Whether it is
 * earning is the money question, so it takes the next strongest: whether
 * that colour is solid or pale. Whether we manage it is a yes or a no,
 * so it takes a mark rather than a colour.
 *
 * The three hues are the first three slots of a validated categorical
 * palette, checked with a colour-blindness validator rather than by eye:
 * worst all-pairs separation 9.2 for deuteranopia, 24.0 for normal
 * vision, both clear of the floors. And "empty" is never signalled by
 * colour alone -- solid against pale against a dashed outline -- so the
 * map survives being printed in grey.
 */
const OWNER: Record<Owner, { solid: string; pale: string; edge: string }> = {
  poh:  { solid: "#2a78d6", pale: "#D4E4F7", edge: "#2a78d6" },
  toh:  { solid: "#eb6834", pale: "#FBDED2", edge: "#eb6834" },
  ioh:  { solid: "#1baf7a", pale: "#D1EFE4", edge: "#1baf7a" },
  none: { solid: "#ffffff", pale: "#ffffff", edge: "#9AA5B1" },
};
export const OWNER_LABEL: Record<Owner, string> = {
  poh: "Park owned", toh: "Tenant owned", ioh: "Investor owned", none: "Bare lot",
};

/**
 * How the base map paints a residential street, borrowed.
 *
 * The park's roads are drawn by the map itself and always were. The only
 * thing missing is the stretch across the back where the two streets
 * meet, and a white line drawn over the top of a styled map looks exactly
 * like what it is. So the map's own road layers are found -- casing and
 * fill, in that order -- and their paint is reused, which keeps the new
 * piece the right colour and the right width at every zoom without
 * guessing at either.
 */
function roadPaint(m: MlMap): { id: string; paint: Record<string, unknown>; under?: string }[] {
  const style = m.getStyle();
  const layers = style.layers ?? [];
  const firstLabel = layers.find((l) => l.type === "symbol")?.id;

  const roads = layers.filter((l) =>
    l.type === "line"
    && (l as { "source-layer"?: string })["source-layer"] === "transportation"
    && /minor|residential|street|service|tertiary/i.test(l.id));
  // Casing before fill, which is the order they are drawn in.
  const pick = roads.slice(0, 2);
  if (!pick.length) {
    return [{
      id: "plain",
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 14, 2, 18, 8, 20, 16],
      },
      under: firstLabel,
    }];
  }
  return pick.map((l) => ({
    id: l.id.replace(/[^a-z0-9]+/gi, "-"),
    paint: { ...((l as { paint?: Record<string, unknown> }).paint ?? {}) },
    under: firstLabel,
  }));
}

/** OpenFreeMap serves the whole planet as vector tiles, free and with no
 *  key. Positron is its grey one, which is the look this screen wanted
 *  anyway -- and, far more importantly, it delivers the buildings and the
 *  streets as shapes rather than as a picture of shapes. */
const STYLE = "https://tiles.openfreemap.org/styles/positron";

/** The park's roads, a shade darker than Positron paints them. */
const DARKER = "#CBD2DA";

/**
 * How the base map letters a street name, borrowed.
 *
 * The map names Lady Viola two or three times along its length and Lady
 * Cheryl once, because it spaces labels by how much of each street is on
 * screen and the two are not the same length. Repeating both along their
 * own line fixes that, and copying the map's own text layer keeps it in
 * the same font, size and colour rather than in one of ours.
 */
function labelStyle(m: MlMap): { layout: Record<string, unknown>; paint: Record<string, unknown> } {
  const found = (m.getStyle().layers ?? []).find((l) =>
    l.type === "symbol"
    && (l as { "source-layer"?: string })["source-layer"] === "transportation_name");
  const layout = { ...((found as { layout?: Record<string, unknown> })?.layout ?? {}) };
  const paint = { ...((found as { paint?: Record<string, unknown> })?.paint ?? {}) };
  return {
    layout: {
      "text-font": layout["text-font"] ?? ["Noto Sans Regular"],
      "text-size": layout["text-size"] ?? 11,
      "text-field": ["get", "name"],
      "symbol-placement": "line",
      // Named again every so often along its own length, which is what
      // the map does to a long street and not to a short one.
      "symbol-spacing": 180,
      "text-letter-spacing": layout["text-letter-spacing"] ?? 0.05,
      "text-max-angle": 40,
    },
    paint: {
      "text-color": paint["text-color"] ?? "#8a8e94",
      "text-halo-color": paint["text-halo-color"] ?? "#ffffff",
      "text-halo-width": paint["text-halo-width"] ?? 1.2,
    },
  };
}

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
  { plan, real, facts, selected, onSelect, onHarvest, fitting, drawing, onMove,
    arranging, onNudge, onDropped, taps, onTap }:
  {
    plan: Plan;
    real?: RealPark | null;
    facts: LotFacts;
    selected: string | null;
    onSelect: (id: string | null) => void;
    /** The buildings and named streets the tiles are carrying, handed up
     *  as soon as they have loaded. */
    onHarvest?: (found: {
      shapes: Shape[]; roads: Road[];
      areas: { name: string; ring: number[][] }[];
      lanes: number[][][];
    }) => void;
    fitting?: boolean;
    /** The boundary is being tapped out corner by corner. */
    drawing?: boolean;
    onMove?: (lng: number, lat: number) => void;
    /** Dragging a single home about, with its angle locked. */
    arranging?: boolean;
    /** Where the home is now, as a position rather than a nudge: a
     *  correction is a statement about the ground, so it survives the
     *  layout changing underneath it. */
    onNudge?: (id: string, at: [number, number], whole?: boolean) => void;
    /** Called once, when the finger comes off, so the position is
     *  written to the database without a round trip per frame. */
    onDropped?: (id: string, at: [number, number], whole?: boolean) => void;
    taps?: Tap[];
    onTap?: (at: Tap) => void;
  },
) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [sat, setSat] = useState(false);

  /** A drag just happened, so the click it ends with is not a click. */
  const hauled = useRef(false);

  const live = useRef({
    plan, fitting, onMove, onSelect, onTap, onHarvest, arranging, onNudge, onDropped,
  });
  live.current = {
    plan, fitting, onMove, onSelect, onTap, onHarvest, arranging, onNudge, onDropped,
  };

  // Harvested once the tiles have settled. Tried again on each idle until
  // something turns up, because the first idle can arrive with the
  // buildings still on their way.
  const reaped = useRef(0);
  const reap = useCallback((m: MlMap) => {
    // Nobody is listening yet. A park whose own plan has not arrived
    // does not want the ground read for it, and counting these as
    // attempts spent the whole allowance before the plan appeared --
    // after which the map never read the tiles again and went on
    // showing whatever it had harvested first.
    if (!live.current.onHarvest) return;
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
    // Every road, named or not. The loop at the east end of the park has
    // no name of its own, so it never came through with the streets and
    // the park was drawn without the one road that goes round it.
    const lanes = roadsFrom(
      get("transportation").map((f, i) => ({ ...f, properties: { name: `lane${i}` } })),
    ).map((r) => r.line);
    reaped.current += 1;
    live.current.onHarvest?.({ shapes, roads, areas, lanes });
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

    // Moving one home.
    //
    // By how far the finger moved since the last event, and never by
    // turning it: a park of identical homes standing in line reads as a
    // park, and one pad a few degrees off reads as a mistake. So a drag
    // only ever slides a rectangle; nothing can rotate it.
    let hold: {
      id: string; lng: number; lat: number;
      at: [number, number]; last: [number, number]; whole: boolean;
    } | null = null;
    const grab = (e: {
      point: maplibregl.Point; lngLat: maplibregl.LngLat;
      originalEvent?: { shiftKey?: boolean }; preventDefault: () => void;
    }) => {
      if (!live.current.arranging || !live.current.onNudge) return;
      const f = padAt(m, e.point);
      if (!f) return;
      // Where the pad is now, so the drag can report a position rather
      // than a running total of nudges -- a total is only meaningful
      // against the layout it was accumulated from.
      const mid = middleOfRing((f.geometry as GeoJSON.Polygon).coordinates?.[0]);
      if (!mid) return;
      const id = String(f.properties?.id ?? "");
      // Taking hold of a home is also choosing it, so the panel of nudge
      // buttons is already pointed at the home under the hand.
      if (id) live.current.onSelect(id);
      hold = {
        id,
        lng: e.lngLat.lng, lat: e.lngLat.lat, at: mid, last: mid,
        // Shift takes the whole row with it. Fifty one pads dragged one
        // at a time is an evening; four rows dragged once each is a
        // minute, and the rows are already straight and parallel -- what
        // is usually wrong is where the whole row sits.
        whole: Boolean(e.originalEvent?.shiftKey),
      };
      m.dragPan.disable();
      e.preventDefault();
    };
    const haul = (e: { lngLat: maplibregl.LngLat }) => {
      if (!hold || !live.current.onNudge) return;
      const at: [number, number] = [
        hold.at[0] + (e.lngLat.lng - hold.lng),
        hold.at[1] + (e.lngLat.lat - hold.lat),
      ];
      hold.last = at;
      hauled.current = true;
      live.current.onNudge(hold.id, at, hold.whole);
    };
    const letGo = () => {
      // Cleared on the next turn, by which time the click the mouseup
      // produces has already been swallowed. Without this a drag that
      // ends off the canvas leaves the flag up and eats the next real
      // click instead.
      setTimeout(() => { hauled.current = false; }, 0);
      if (!hold) return;
      // Written to the database once, when the finger comes off, rather
      // than on every frame of the drag.
      live.current.onDropped?.(hold.id, hold.last, hold.whole);
      hold = null;
      m.dragPan.enable();
    };
    m.on("mousedown", grab); m.on("mousemove", haul);
    m.on("mouseup", letGo); m.on("mouseout", letGo);
    m.on("touchstart", grab); m.on("touchmove", haul);
    m.on("touchend", letGo); m.on("touchcancel", letGo);

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
    // Which homes were put where by hand is a question you have while
    // putting them there, and not afterwards.
    if (m.getLayer("home-moved")) {
      m.setLayoutProperty("home-moved", "visibility", arranging ? "visible" : "none");
    }
    // On a photograph an owner-coloured hairline disappears into the
    // grass, so the outlines go white there and keep their colour on the
    // plan.
    if (m.getLayer("home-line")) {
      m.setPaintProperty("home-line", "line-color",
        sat ? "#ffffff" : (["get", "edge"] as unknown as string));
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
    if (m.getLayer("park-line")) {
      // While the boundary is being tapped out it is the thing being
      // aimed at, so it stops being a hairline.
      m.setPaintProperty("park-line", "line-width", drawing ? 3.5 : 2);
      m.setPaintProperty("park-line", "line-color", drawing ? "#D8443C" : "#2B5FA8");
    }
    if (m.getLayer("home-fill")) {
      // Solid. At 0.9 the base map's own grey buildings showed through
      // underneath and every pad came out mottled, which is what "grainy"
      // was looking at -- two drawings of the same building, one on top of
      // the other, almost but not quite aligned.
      m.setPaintProperty("home-fill", "fill-opacity", fitting ? 0.35 : 1);
    }
  }, [sat, ready, fitting, arranging, drawing]);

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
      const f = facts[h.id] ?? { owner: "none" as Owner, empty: true, managed: false };
      const paint = OWNER[f.owner] ?? OWNER.none;
      return {
        type: "Feature", id: h.id,
        properties: {
          id: h.id, label: h.label, street: h.street,
          owner: f.owner, empty: f.empty, managed: f.managed,
          // Pale when there is a home and nobody in it, solid when it is
          // lived in, white when there is no home at all.
          colour: f.owner === "none" ? "#ffffff" : f.empty ? paint.pale : paint.solid,
          edge: paint.edge,
          // The number goes dark on a pale pad and light on a solid one,
          // which is the only way it stays readable on both.
          ink: f.owner === "none" || f.empty ? "#17212E" : "#ffffff",
          bare: f.owner === "none",
          drawn: Boolean((h as { drawn?: boolean }).drawn),
          moved: Boolean((h as { moved?: boolean }).moved),
        },
        geometry: { type: "Polygon", coordinates: [h.ring] },
      };
    });

    // The county's line first. It is the only one of the three that is
    // a statement about the deed rather than about where the drawing
    // happens to have put the homes.
    const ring = plan.fence?.length ? plan.fence
      : real?.boundary?.length ? real.boundary : boundaryOf(plan);
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
    set("lanes", {
      type: "FeatureCollection",
      features: (real?.lanes ?? []).map((line: number[][]) => ({
        type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: line },
      })),
    });
    // A badge at the road end of every home we manage, clear of the lot
    // number in the middle.
    const badges: GeoJSON.Feature[] = [];
    for (const h of real?.homes ?? []) {
      if (!facts[h.id]?.managed || !h.dot) continue;
      badges.push({
        type: "Feature", properties: {},
        geometry: { type: "Point", coordinates: h.dot },
      });
    }
    set("ours", { type: "FeatureCollection", features: badges });
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

      // The piece of road the map is missing, drawn in the map's own
      // hand. Rather than inventing a white line -- which looked hand
      // drawn, because it was -- the base map's residential road layers
      // are found and their paint copied, so the new stretch is the same
      // colour, the same width at every zoom, and the same casing as
      // every other street on screen.
      const copied = roadPaint(m);
      for (const copy of copied) {
        m.addLayer({
          id: `lane-${copy.id}`, type: "line", source: "lanes",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: copy.paint,
        }, copy.under);
      }
      // The park's roads a shade darker than the base map draws them.
      // Positron paints a residential street almost white, which is right
      // on a map of a city and too faint on a map of one park, where the
      // roads are most of what gives the place its shape. The base map's
      // own layers are darkened along with ours, so they stay one road.
      for (const copy of copied) {
        for (const id of [copy.id, `lane-${copy.id}`]) {
          if (m.getLayer(id)) m.setPaintProperty(id, "line-color", DARKER);
        }
      }
      m.addLayer({ id: "home-fill", type: "fill", source: "homes",
        paint: { "fill-color": ["get", "colour"], "fill-opacity": 1 } });
      // Two layers rather than one with an expression: line-dasharray is
      // a constant-only property in MapLibre, and a data-driven one throws
      // on style load and takes the whole map with it.
      // The outline is the owner's colour, so a pale pad still says who
      // owns it. A bare lot is dashed grey: nothing is there.
      m.addLayer({ id: "home-line", type: "line", source: "homes",
        filter: ["!", ["get", "bare"]],
        paint: { "line-color": ["get", "edge"], "line-width": 1.6 } });
      m.addLayer({ id: "home-bare", type: "line", source: "homes",
        filter: ["get", "bare"],
        paint: { "line-color": "#9AA5B1", "line-width": 1.6, "line-dasharray": [2, 1.6] } });
      m.addLayer({ id: "home-on", type: "line", source: "homes",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#0F1729", "line-width": 3.5 } });
      // A home that has been moved by hand, so it is clear which ones are
      // where the map put them and which ones somebody corrected.
      //
      // Only while moving them. Once the park is arranged the outline is
      // answering a question nobody is asking, and it sits in the one
      // place the map says who owns the home -- so a park where every
      // home had been nudged read as a park with no owners at all.
      m.addLayer({ id: "home-moved", type: "line", source: "homes",
        filter: ["==", ["get", "moved"], true],
        layout: { visibility: "none" },
        paint: { "line-color": "#C2703A", "line-width": 2 } });
      // Every pad carries its number, always.
      //
      // Collision detection was dropping the ones that would overlap,
      // which on a row of pads ten metres apart meant a home here and
      // there with no number on it -- and a pad with no number reads as a
      // lot that failed rather than as a label that did not fit. A number
      // half over its neighbour is legible; a missing one is a question.
      m.addLayer({ id: "home-label", type: "symbol", source: "homes", minzoom: 15.5,
        layout: {
          "text-field": ["get", "label"], "text-font": font,
          "text-size": ["interpolate", ["linear"], ["zoom"], 15.5, 8, 18, 10, 20, 12],
          "text-allow-overlap": true, "text-ignore-placement": true,
          "symbol-z-order": "source",
        },
        paint: {
          "text-color": ["get", "ink"],
          "text-halo-color": ["case", ["get", "bare"], "#ffffff",
                              ["get", "empty"], "#ffffff", "#19202B"],
          "text-halo-width": 1.2,
        } });
      // Each street named along its own length, in the map's own hand.
      {
        const look = labelStyle(m);
        m.addLayer({
          id: "street-name", type: "symbol", source: "streets", minzoom: 15,
          layout: look.layout as never, paint: look.paint as never,
        });
      }
      m.addLayer({ id: "ours-dot", type: "circle", source: "ours", minzoom: 16,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 16, 2.5, 18, 4, 20, 6],
          "circle-color": "#17212E",
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.4,
        } });
      m.addLayer({ id: "tap-dot", type: "circle", source: "taps",
        paint: { "circle-radius": 9, "circle-color": "#D1453B",
                 "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
      m.addLayer({ id: "tap-n", type: "symbol", source: "taps",
        layout: { "text-field": ["get", "n"], "text-size": 11, "text-font": font,
                  "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" } });

      m.on("click", (e) => {
        // A drag is not a click. MapLibre withholds the click when the
        // pointer travelled far enough to be a drag, and this is the belt
        // for those braces -- a home that has just been dragged must not
        // also be re-chosen by the mouseup that ended the drag.
        if (hauled.current) { hauled.current = false; return; }
        if (live.current.fitting) {
          if (live.current.onTap) live.current.onTap([e.lngLat.lng, e.lngLat.lat]);
          return;
        }
        // Choosing a home works while arranging too. It used to return
        // here, on the grounds that a card opening over the map you are
        // arranging is in the way -- but it also meant the only way to
        // say WHICH home you meant was to successfully drag it, so there
        // was nothing to aim an arrow key or a nudge button at.
        const f = padAt(m, e.point);
        live.current.onSelect(f ? String(f.properties?.id ?? "") : null);
      });
      m.on("mouseenter", "home-fill", () => {
        m.getCanvas().style.cursor = live.current.arranging ? "move" : "pointer";
      });
      m.on("mouseleave", "home-fill", () => { m.getCanvas().style.cursor = ""; });
    }

    m.setFilter("home-on", ["==", ["get", "id"], selected ?? ""]);
  }, [plan, real, facts, ready, selected, taps]);

  // Framed on what is drawn, once per set of geometry. Re-framing on every
  // nudge would yank the map out from under somebody placing the block.
  /**
   * A fresh allowance when the park moves or is first described.
   *
   * The attempts are capped so a map that will never carry this park's
   * streets stops asking. But a park that has just been given a plan,
   * or moved to another county, is a different question from the one
   * the allowance was spent on.
   */
  const lastAsk = useRef("");
  useEffect(() => {
    const key = `${onHarvest ? "on" : "off"}:${plan.centre.map((n) => n.toFixed(4)).join(",")}`;
    if (lastAsk.current === key) return;
    lastAsk.current = key;
    reaped.current = 0;
    const m = map.current;
    if (m && ready && onHarvest) requestAnimationFrame(() => reap(m));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onHarvest, plan.centre, ready]);

  const framed = useRef("");
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    // Where as well as what. Keyed on the count alone, a park that moved
    // from Fayetteville to Elizabeth City kept the same key and the map
    // never re-framed -- so a correctly re-described park went on
    // showing three hundred miles away, which reads as the describing
    // having done nothing.
    const where = plan.centre.map((n) => n.toFixed(5)).join(",");
    const what = `${real?.boundary?.length ? "real" : "drawn"}`
      + `:${real?.homes?.length ?? 0}:${where}`;
    if (framed.current === what) return;
    framed.current = what;
    const id = requestAnimationFrame(() => frame());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, real, plan.centre]);

  /**
   * The park put back in frame when the card beside it opens or shuts.
   *
   * Opening a pad takes twenty rem off the map's width. MapLibre is told
   * its container's size once and has no way to notice, so the park went
   * on being drawn at the old width and the bottom two rows fell off the
   * bottom of the box.
   *
   * On the card opening and shutting rather than on every size change:
   * an observer on the box fed its own resize back in and grew the map
   * down the page. Changing which pad is open does not refit, because
   * re-zooming the map under somebody reading a card is its own bug.
   */
  const hadCard = useRef<boolean | null>(null);
  const card = Boolean(selected);
  useEffect(() => {
    if (!ready) return;
    if (hadCard.current === card) return;
    hadCard.current = card;
    const id = requestAnimationFrame(() => frame());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, card]);

  function frame() {
    const m = map.current;
    if (!m) return;
    // The county's line first. It is the only one of the three that is
    // a statement about the deed rather than about where the drawing
    // happens to have put the homes.
    const ring = plan.fence?.length ? plan.fence
      : real?.boundary?.length ? real.boundary : boundaryOf(plan);
    // A park nobody has described has no homes, so no boundary either,
    // and empty bounds are not something to fit to. Look at the ground
    // it sits on instead.
    if (!ring.length) {
      m.resize();
      m.easeTo({ center: plan.centre, zoom: 16.5, duration: 400 });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    for (const p of ring) b.extend([p[0], p[1]]);
    // Measured again here: the container is sized by CSS that may not have
    // settled when the map first says it has loaded.
    m.resize();
    m.fitBounds(b, { padding: 28, maxZoom: 19, duration: 400 });
  }

  return (
    <div className="parkmapwrap">
      <div ref={box} className={`parkmapbox${fitting || arranging ? " fitting" : ""}`} />
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
