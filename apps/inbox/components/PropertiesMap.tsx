"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import maplibregl, { type Map as MlMap, type MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { kindOf } from "@/lib/property";
import { type Property } from "@/components/PropertyBoard";

/**
 * Everything you own, on the ground.
 *
 * A list of a hundred and fourteen addresses cannot answer "which of
 * these is the one off Halstead" or "how many of these are in one
 * place". A map answers both by being looked at.
 *
 * AERIAL, and not the street map the park screen uses. That screen is
 * for arranging pads against roads and parcel lines, where a drawn map
 * is clearer. This one is for recognising a place, and a roof is what
 * somebody recognises.
 *
 * Esri's World Imagery, because it needs no key and no account -- the
 * static aerial elsewhere in this app is Google's and wants both, which
 * is fine for one thumbnail and wrong for a map you pan. The tiles are
 * fetched by the browser, so the container's egress policy (which
 * refuses arcgis outright) has nothing to do with it.
 */
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

/* SATELLITE ALONE IS A GREEN BLOB. Aerial imagery carries roofs and
   treelines and nothing else -- no street name, no town, no label of
   any kind. What makes a satellite map readable is a second, mostly
   transparent layer drawn over it: that is what Google composites and
   what was missing here.

   Esri publish exactly those as free overlays. `World_Transportation`
   is the roads and their names; `World_Boundaries_and_Places` is the
   towns, the county lines and the place labels. Both are transparent
   except where they draw, so the photograph shows through. */
const AERIAL: maplibregl.StyleSpecification = {
  version: 8,
  /* WITHOUT THIS EVERY LABEL IS BLANK. A symbol layer needs glyphs to
     draw text with, and a style that omits them renders the layer
     silently as nothing -- the cluster counts, the lot counts and the
     property names all simply absent, with no error anywhere. Dropped
     once already while rewriting this style. */
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    aerial: {
      type: "raster",
      tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256, maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    roads: {
      type: "raster",
      tiles: [`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256, maxzoom: 19,
    },
    places: {
      type: "raster",
      tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256, maxzoom: 19,
    },
  },
  layers: [
    { id: "aerial", type: "raster", source: "aerial" },
    /* Roads under places, so a street name never sits on top of a town
       name. Both slightly held back: at full strength the labels fight
       the photograph they are meant to annotate. */
    { id: "roads", type: "raster", source: "roads",
      paint: { "raster-opacity": 0.9 } },
    { id: "places", type: "raster", source: "places",
      paint: { "raster-opacity": 0.85 } },
  ],
};

/** Where the state sits, for the moment before anything is placed. */
const NOWHERE: [number, number] = [-78.9, 35.3];
const SRC = "props";

export default function PropertiesMap(
  { properties, onOpen }:
  { properties: Property[]; onOpen: (id: string) => void },
) {
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  /** Why there is no map, where there is none. */
  const [broke, setBroke] = useState<string | null>(null);

  /* A PROPERTY WITH NO PIN IS NOT ON THE MAP, and that is a sentence
     the screen has to say rather than a thing somebody notices by
     counting. Most of these have never had an address confirmed. */
  const placed = useMemo(
    () => properties.filter((p) => p.lat != null && p.lng != null), [properties]);
  const adrift = properties.length - placed.length;

  const data = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: "FeatureCollection",
    features: placed.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const,
        coordinates: [p.lng as number, p.lat as number] },
      properties: {
        id: p.id, name: p.name,
        colour: p.color ?? "#405981",
        lots: p.units.length,
        /* WHAT KIND OF THING IT IS, drawn rather than written. A park
           and a single house are different work and want telling apart
           at a glance; so do a property of ours and one we only manage
           for somebody else. Two channels, because they are two
           independent facts: SIZE says park or house, and the RING
           says whose it is. */
        park: p.units.length > 1,
        ours: p.ownerKind === "ours",
        /* Drawn on the pin only where it means something: at a park the
           first question is how big it is, and "1" on a house is noise. */
        badge: p.units.length > 1 ? String(p.units.length) : "",
        label: p.name,
      },
    })),
  }), [placed]);

  /* The framing is for the properties ARRIVING on screen, which happens
     once per set. Re-fitting on every render would yank the map out
     from under somebody who has panned to a corner -- while they are
     working, the camera is theirs. Keyed on WHICH properties rather
     than how many, so searching re-frames and panning does not. */
  const key = useMemo(() => placed.map((p) => p.id).sort().join(","), [placed]);
  const framed = useRef<string | null>(null);

  // ---- the map itself, made once -------------------------------------
  useEffect(() => {
    if (!box.current || map.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: AERIAL,
      center: NOWHERE,
      zoom: 6,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    /* The handle goes out NOW, not at the end of the load handler. It
       used to be the last line in there, so anything that threw while
       adding a layer took the whole map with it and left a checker
       waiting for a handle that would never appear -- which reads as
       "the map did not load" rather than "one layer is wrong". */
    if (typeof window !== "undefined") {
      (window as unknown as { __pm?: MlMap }).__pm = m;
    }

    /* And a style that cannot be fetched says so. Tiles failing is
       ordinary and not worth shouting about; the style failing means
       there is no map at all. */
    m.on("error", (e) => {
      const why = String((e as { error?: Error }).error?.message ?? "");
      if (/style|glyph/i.test(why)) setBroke(why);
    });

    m.on("load", () => {
      /* CLUSTERED, and that is the whole reason this is a source and a
         layer rather than a hundred and fourteen HTML markers.

         Two properties a street apart draw on top of each other, and
         the one underneath cannot be pressed at all -- it is not merely
         hard to hit, it is unreachable, because the pin above it takes
         every click. Found by trying: with three properties in the
         fixture, two of them near Fayetteville, the first pin could not
         be clicked. At this scale that is not an edge case; most of
         these are in two towns. */
      m.addSource(SRC, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 44,
        /* Past this, show them individually: a cluster that will not
           break apart is a dead end. */
        clusterMaxZoom: 16,
      });

      m.addLayer({
        id: "cluster", type: "circle", source: SRC,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#1F2A37",
          "circle-opacity": 0.92,
          "circle-radius": ["step", ["get", "point_count"], 17, 10, 22, 50, 28],
          /* White ring in BOTH themes: the ground under this is an
             aerial photograph, not the page, so a token that inverts
             would turn the ring dark against a dark field. */
          "circle-stroke-width": 2,
          "circle-stroke-color": "#FFFFFF",
        },
      });
      m.addLayer({
        id: "cluster-count", type: "symbol", source: SRC,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"], "text-size": 12,
        },
        paint: { "text-color": "#FFFFFF" },
      });

      m.addLayer({
        id: "pin", type: "circle", source: SRC,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "colour"],
          /* A park is bigger than a house, which is both true and the
             fastest way to read a map of them. A thumb needs about
             40px either way -- the park map already cost a round for a
             target smaller than the cursor's own point. */
          "circle-radius": ["case", ["get", "park"], 15, 10],
          /* OURS IS SOLID, MANAGED IS RINGED. A heavier ring in the
             property's own colour reads as "this one belongs to
             somebody else" without needing a second hue, which would
             fight the colour already carrying the property. */
          "circle-stroke-width": ["case", ["get", "ours"], 2.5, 5],
          "circle-stroke-color": "#FFFFFF",
          "circle-opacity": ["case", ["get", "ours"], 1, 0.55],
        },
      });
      m.addLayer({
        id: "pin-count", type: "symbol", source: SRC,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["get", "badge"],
          "text-font": ["Noto Sans Bold"], "text-size": 11,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#FFFFFF" },
      });
      /* THE NAME, once there is room for it. Zoomed out these would be
         a wall of text over the photograph, so they appear from the
         zoom at which a town fills the screen, and MapLibre drops any
         that would collide rather than stacking them. */
      m.addLayer({
        id: "pin-label", type: "symbol", source: SRC,
        filter: ["!", ["has", "point_count"]],
        minzoom: 12,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Bold"], "text-size": 12,
          "text-offset": [0, 1.5], "text-anchor": "top",
          "text-max-width": 11,
        },
        paint: {
          /* White on a dark halo: over an aerial photograph there is no
             knowing whether the ground under a label is a bright roof
             or a dark treeline, so the label carries its own contrast
             rather than borrowing the page's. */
          "text-color": "#FFFFFF",
          "text-halo-color": "rgba(0,0,0,0.75)",
          "text-halo-width": 1.4,
        },
      });

      for (const id of ["cluster", "pin"]) {
        m.on("mouseenter", id, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; });
      }

      /* A cluster opens rather than selecting: it is several properties
         and choosing one of them for you is the screen answering a
         question it was not asked. */
      m.on("click", "cluster", (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        if (!f) return;
        const src = m.getSource(SRC) as maplibregl.GeoJSONSource;
        const id = f.properties.cluster_id as number;

        /* FRAME WHAT WAS IN IT, rather than zooming to the depth at
           which it happens to split. Centring on the group and zooming
           to the expansion zoom drops you BETWEEN two properties a mile
           apart, at a zoom where neither is on screen -- the tap
           appears to empty the map. Found by a check that counted the
           pins before and after and got one, then none.

           So: ask the cluster what was inside it and fit those. */
        void src.getClusterLeaves(id, 100, 0)
          .then((leaves) => {
            const pts = (leaves as GeoJSON.Feature<GeoJSON.Point>[])
              .map((l) => l.geometry.coordinates as [number, number]);
            if (!pts.length) return;
            const b = new maplibregl.LngLatBounds();
            for (const c of pts) b.extend(c);
            /* A cluster of things at the SAME address has no extent to
               fit, so it would zoom to the maximum and show one roof.
               Treat that as a point and step in a sensible amount. */
            const flat = b.getNorthEast().distanceTo(b.getSouthWest()) < 25;
            if (flat) {
              m.easeTo({ center: pts[0], zoom: Math.max(m.getZoom() + 2, 17),
                duration: 450 });
            } else {
              m.fitBounds(b, { padding: 80, maxZoom: 17, duration: 450 });
            }
          })
          .catch(() => { /* a cluster that will not say is left alone */ });
      });

      m.on("click", "pin", (e) => {
        const f = e.features?.[0];
        if (f) setChosen(String(f.properties.id));
      });

      /* Tapping the ground puts the card away, which is what somebody
         means by tapping away from it. Bound to the map rather than the
         pin so it fires only where nothing was hit. */
      m.on("click", (e) => {
        const hit = m.queryRenderedFeatures(e.point, { layers: ["pin", "cluster"] });
        if (!hit.length) setChosen(null);
      });

      setReady(true);
    });

    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  // ---- the properties, whenever the search changes them ---------------
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = m.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
    src?.setData(data);
  }, [data, ready]);

  // ---- bring them on screen, once per set ----------------------------
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !placed.length || framed.current === key) return;
    framed.current = key;
    if (placed.length === 1) {
      m.easeTo({ center: [placed[0].lng as number, placed[0].lat as number],
        zoom: 16, duration: 400 });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    for (const p of placed) b.extend([p.lng as number, p.lat as number]);
    m.fitBounds(b, { padding: 56, maxZoom: 15, duration: 400 });
  }, [placed, key, ready]);

  /* The chosen property may be filtered away by a search while its card
     is open, and a card describing something no longer on the map is a
     card about nothing. */
  useEffect(() => {
    if (chosen && !placed.some((p) => p.id === chosen)) setChosen(null);
  }, [chosen, placed]);

  const card = placed.find((p) => p.id === chosen) ?? null;

  return (
    <div className="propmapwrap">
      <div className="propmap" ref={box} />

      {card && (
        <div className="propmapcard">
          <strong>{card.name}</strong>
          <span className="dim">
            {[card.owner, card.address].filter(Boolean).join(" · ")
              || "No address set"}
          </span>
          <span className="dim">
            {kindOf(card.kind).label}
            {card.units.length > 0 && ` · ${card.units.length} `
              + `lot${card.units.length === 1 ? "" : "s"}`}
          </span>
          <div className="propmapacts">
            <button type="button" className="btn"
                    onClick={() => onOpen(card.id)}>
              Open it in the list
            </button>
            {/* DRILLING IN. At a park the next question is always which
                lot, and that screen already exists -- it draws every pad
                on the aerial and opens the lot card from one. */}
            {card.units.length > 1 && (
              <Link className="btn pri" href={`/properties/${card.id}/plan`}>
                See the lots
              </Link>
            )}
          </div>
        </div>
      )}

      {broke && (
        <p className="err propmapsays">
          The map could not be drawn — {broke}. The list above still works.
        </p>
      )}

      {/* Said out loud. A map showing forty of a hundred and fourteen,
          silently, is a map somebody reads as everything they own --
          the same fault as a list that filters without saying so. */}
      {adrift > 0 && (
        <p className="muted propmapsays">
          {placed.length} of {properties.length} are on the map.{" "}
          {adrift} {adrift === 1 ? "has" : "have"} no address confirmed yet,
          so {adrift === 1 ? "it does" : "they do"} not appear — open one
          from the list and set its address to put it here.
        </p>
      )}
      {!adrift && placed.length > 0 && (
        <p className="muted propmapsays">
          All {placed.length} on the map. Tap one for its details; a dark
          circle is several in one place — tap it to open them out.
        </p>
      )}
      {!placed.length && (
        <p className="muted propmapsays">
          None of these have an address confirmed yet, so there is nothing
          to put on the map. Open one from the list and set its address.
        </p>
      )}
    </div>
  );
}
