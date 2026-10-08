/**
 * Pulling a park's lots out of the county's own map.
 *
 * The county already knows where every home in the park is and what number
 * is on it -- that is what the parcel viewer is showing. Asking them is
 * better than typing it twice: their numbers are the ones on the mailboxes,
 * their positions are surveyed, and when a pad is added it appears there
 * before it appears in anybody's spreadsheet.
 *
 * Every step reports what it found and what it tried. None of this can be
 * checked from a development machine with no route to arcgis.com, so when it
 * fails it has to say where, in a sentence somebody can act on, rather than
 * coming back empty.
 */

export type Step = { did: string; ok: boolean; say: string };

export type FoundLot = {
  label: string;
  lat: number;
  lng: number;
  /** The street it is on, when the address field carried one. A park is one
   *  or two streets and the neighbourhood is five others, so this is the
   *  filter that actually matches how somebody thinks about their park. */
  street: string | null;
};

/** The street out of an address field, with the number taken off the front.
 *  "3107 LADY CHERYL DR" is Lady Cheryl Dr; "3107" on its own is nothing,
 *  which is honest rather than a guess. */
export function streetOf(v: unknown): string | null {
  const s = String(v ?? "").trim().replace(/^\d+\s*-?[A-Za-z]?\s+/, "");
  if (!s || /^\d+$/.test(s)) return null;
  // Title case, because county data is upper case and a filter full of
  // shouting is harder to read than it needs to be.
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();
}

const AGOL = "https://www.arcgis.com/sharing/rest/content/items";

async function json(url: string): Promise<Record<string, unknown> | null> {
  return (await asked(url)).data;
}

/**
 * A request, and why it came to nothing.
 *
 * `json` swallows everything into null, so a server that refused the
 * connection, a server that demanded a token and a server that
 * answered "no such parcel" were indistinguishable -- and the message
 * that reached the owner said all three at once: "nothing numbered
 * P139-50A, or the service did not answer". That is not a diagnosis,
 * it is a shrug, and it cost a round.
 *
 * ArcGIS also answers 200 with an error object inside, which is its
 * own way of being unhelpful, so the body is read before it is
 * believed.
 */
export async function asked(
  url: string,
): Promise<{ data: Record<string, unknown> | null; why: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      return { data: null, why: `the server answered ${res.status} ${res.statusText}`.trim() };
    }
    const body = await res.json() as Record<string, unknown>;
    const err = body.error as { message?: string; code?: number } | undefined;
    if (err) {
      const code = err.code === 499 || err.code === 498
        ? " — it wants a sign-in" : "";
      return { data: null, why: `${err.message ?? "the service refused"}${code}` };
    }
    return { data: body, why: "" };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { data: null, why: /abort|timeout/i.test(m) ? "it did not answer in time" : m };
  }
}

/** Where a published item's service actually lives.
 *
 *  An item id is the only durable handle on somebody else's data: REST
 *  paths get reorganised and a guessed one is a 404 that reads like an
 *  empty layer. */
export async function serviceOf(itemId: string): Promise<string | null> {
  const item = await json(`${AGOL}/${itemId}?f=json`);
  const url = item?.url;
  return typeof url === "string" && /^https?:/.test(url) ? url.replace(/\/+$/, "") : null;
}

/** The item id out of whatever was pasted: a bare id, or the whole URL. */
export function appIdFrom(s: string): string | null {
  const t = (s ?? "").trim();
  if (/^[0-9a-f]{32}$/i.test(t)) return t;
  return (t.match(/appid=([0-9a-f]{32})/i) ?? t.match(/id=([0-9a-f]{32})/i)
    ?? t.match(/items\/([0-9a-f]{32})/i) ?? t.match(/([0-9a-f]{32})/i))?.[1] ?? null;
}

/** Where an address is, from the Census geocoder -- free, no key, and the
 *  authority the counties themselves build on. */
export async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const u = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
    + `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  const out = await json(u);
  const m = (out?.result as { addressMatches?: { coordinates?: { x: number; y: number } }[] })
    ?.addressMatches?.[0]?.coordinates;
  return m ? { lat: m.y, lng: m.x } : null;
}

/**
 * Every layer the county's app puts on the map.
 *
 * An ArcGIS item is one of several things and they nest differently. A Web
 * Map lists its own operationalLayers. A Web Mapping Application points at a
 * map -- and where it keeps that pointer depends on the template it was
 * built from: values.webmap in some, map.itemId in others, values.mapItemId
 * in a third. Looking in one place found nothing for Cumberland County and
 * reported "the app publishes no layers", which was wrong and unhelpful in
 * the same sentence.
 *
 * So: follow whichever of them is there, and as a last resort take any item
 * id in the document and ask whether it is a map. Returns what it understood
 * alongside the layers, so a failure says what the thing actually was.
 */
export async function layersOf(appId: string): Promise<{
  layers: { title: string; url: string }[];
  kind: string | null;
  via: string;
}> {
  const item = await json(`${AGOL}/${appId}?f=json`);
  const kind = (item?.type as string) ?? null;
  const data = await json(`${AGOL}/${appId}/data?f=json`);
  if (!data) return { layers: [], kind, via: "ArcGIS returned no data for that item" };

  // The item IS the map.
  if (Array.isArray(data.operationalLayers)) {
    return { layers: await expand(readMap(data)), kind, via: "the item is a web map" };
  }

  const values = (data.values ?? {}) as Record<string, unknown>;
  const mapBlock = (data.map ?? {}) as Record<string, unknown>;
  const candidates = [
    values.webmap, values.mapItemId, mapBlock.itemId,
    (values.map as Record<string, unknown> | undefined)?.itemId,
  ].filter((v): v is string => typeof v === "string" && /^[0-9a-f]{32}$/i.test(v));

  // Last resort: any item id in the document. A template nobody has seen
  // before still names its map somewhere, and asking costs one request.
  if (!candidates.length) {
    const ids = [...new Set((JSON.stringify(data).match(/[0-9a-f]{32}/gi) ?? []))]
      .filter((x) => x.toLowerCase() !== appId.toLowerCase()).slice(0, 4);
    candidates.push(...ids);
  }

  for (const id of candidates) {
    const map = await json(`${AGOL}/${id}/data?f=json`);
    if (map && Array.isArray(map.operationalLayers)) {
      return { layers: await expand(readMap(map)), kind,
               via: `the map it points at (${id})` };
    }
  }

  return {
    layers: [], kind,
    via: candidates.length
      ? `followed ${candidates.length} item id(s), none of which was a web map`
      : "no map id anywhere in the app's definition",
  };
}

/** The layers out of a web map, including the ones inside groups -- address
 *  points are nearly always one level down. */
function readMap(map: Record<string, unknown>): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  const walk = (list: unknown, prefix: string) => {
    for (const l of (list ?? []) as Record<string, unknown>[]) {
      const title = `${prefix}${String(l.title ?? "—")}`;
      if (typeof l.url === "string") out.push({ title, url: l.url });
      if (Array.isArray(l.layers)) walk(l.layers, `${title} · `);
    }
  };
  walk(map.operationalLayers, "");
  return out;
}

/**
 * Turn whole services into the layers inside them.
 *
 * A web map routinely references ".../MapServer" rather than
 * ".../MapServer/3". That URL describes a service and refuses a query, so
 * asking it for address points comes back empty and looks exactly like a
 * county that does not publish any -- which is the wrong conclusion drawn
 * from the right evidence.
 */
async function expand(layers: { title: string; url: string }[]) {
  const out: { title: string; url: string }[] = [];
  for (const l of layers) {
    // Photographs, skipped before they cost a request. Cumberland publishes
    // sixteen years of aerial flights as separate layers, and asking each one
    // for house numbers burned the entire budget on pictures -- twenty-five
    // attempts, every one of them a .sid tile, and the address points never
    // got looked at.
    if (isImagery(l)) continue;
    if (/\/\d+$/.test(l.url)) { out.push(l); continue; }
    if (!/(Map|Feature)Server\/?$/i.test(l.url)) { out.push(l); continue; }

    const base = l.url.replace(/\/$/, "");
    const meta = await json(`${base}?f=json`);
    const subs = (meta?.layers ?? []) as { id?: number; name?: string; subLayerIds?: unknown }[];
    if (!subs.length) { out.push(l); continue; }

    for (const sub of subs) {
      // A group layer inside a service has subLayerIds and no geometry of its
      // own; querying it is a request that cannot succeed.
      if (sub.subLayerIds) continue;
      if (typeof sub.id !== "number") continue;
      out.push({ title: `${l.title} · ${sub.name ?? sub.id}`, url: `${base}/${sub.id}` });
    }
  }
  // Still bounded, but the old ceiling of 60 was set when photographs were
  // still in the list and was quietly throwing away everything past it.
  // Cumberland publishes well over a hundred layers; the parcels and the
  // address points sit below the planning ones, which is exactly where a cap
  // of 60 cut.
  return out.slice(0, 250);
}

/** A layer that holds a picture rather than things with fields on them.
 *  An ImageServer cannot answer a feature query, and neither can a raster
 *  tile named after the flight that produced it. */
function isImagery(l: { title: string; url: string }): boolean {
  return /ImageServer/i.test(l.url)
    || /\.sid\b/i.test(l.title)
    || /^imagery\b|\bimagery\b.*\d{4}|\borthoimagery\b|\baerial\b/i.test(l.title);
}

/**
 * Most likely to carry a house number, first.
 *
 * The budget is spent in order, so the order is the whole thing. An address
 * point layer is the answer; a structure or building layer usually carries
 * the number too; a parcel layer carries owners and acreage and is worth
 * trying last rather than not at all, because some counties put the situs
 * address on it.
 */
export function mostLikelyFirst(
  layers: { title: string; url: string }[],
): { title: string; url: string }[] {
  const score = (t: string) => {
    const s = t.toLowerCase();
    if (/address|situs|e911|site ?addr/.test(s)) return 0;
    if (/structure|building|footprint|rooftop/.test(s)) return 1;
    if (/parcel|cama|property|tax/.test(s)) return 2;
    if (/street|road|centerline|boundary|zoning|flood|soil|contour/.test(s)) return 4;
    return 3;
  };
  return [...layers].sort((a, b) => score(a.title) - score(b.title));
}

/** The field in a layer that holds the number on the mailbox.
 *
 *  Counties name it differently every time -- HOUSE_NUM, ADDRNUM, SITE_ADDR,
 *  FULLADDR -- so it is found by looking rather than assumed, and a layer
 *  with no such field is simply not the layer we want. */
export function numberField(fields: string[]): string | null {
  const pick = (re: RegExp) => fields.find((f) => re.test(f));
  return pick(/^(house|addr|add)_?(num|no|number)$/i)
    ?? pick(/(house|addr)_?(num|no|number)/i)
    ?? pick(/^(site|situs|full)_?addr/i)
    ?? pick(/address/i)
    ?? null;
}

/** A square around a point, in degrees. 250 metres each way covers a park
 *  the size of Pamalee and stops short of the neighbours' numbers, which are
 *  the thing nobody wants on this plan. */
export function boxAround(lat: number, lng: number, metres = 250) {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { xmin: lng - dLng, ymin: lat - dLat, xmax: lng + dLng, ymax: lat + dLat };
}

/** Ask one layer for everything inside the box. */
export async function pointsIn(
  layerUrl: string, box: ReturnType<typeof boxAround>,
): Promise<{ fields: string[]; features: { props: Record<string, unknown>; lat: number; lng: number }[] } | null> {
  const q = `${layerUrl}/query`
    + `?where=1%3D1&geometry=${box.xmin},${box.ymin},${box.xmax},${box.ymax}`
    + "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects"
    + "&outFields=*&outSR=4326&resultRecordCount=500&f=geojson";
  const out = await json(q);
  if (!out || out.type !== "FeatureCollection") return null;

  const features: { props: Record<string, unknown>; lat: number; lng: number }[] = [];
  const fields = new Set<string>();
  for (const f of (out.features ?? []) as Record<string, unknown>[]) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    Object.keys(props).forEach((k) => fields.add(k));
    const g = f.geometry as { type?: string; coordinates?: unknown } | null;
    const at = centroid(g);
    if (at) features.push({ props, lat: at.lat, lng: at.lng });
  }
  return { fields: [...fields], features };
}

/** The middle of whatever shape came back. A building footprint is a polygon
 *  and an address point is a point; both answer "where is this home" and the
 *  plan only needs the one number. */
export function centroid(g: { type?: string; coordinates?: unknown } | null): { lat: number; lng: number } | null {
  if (!g) return null;
  const pts: number[][] = [];
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") { pts.push(c as number[]); return; }
    for (const i of c) walk(i);
  };
  walk(g.coordinates);
  if (!pts.length) return null;
  const lng = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return { lat, lng };
}

/** Just the digits of a house number, out of whatever the field held.
 *  "3107", "3107 LADY CHERYL DR" and "3107-A" are all lot 3107. */
export function houseNumber(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = /^(\d{1,6})/.exec(s);
  return m ? m[1] : null;
}

/**
 * Turn found points into positions on the plan.
 *
 * Fractions of the bounding box the points themselves occupy, padded a
 * little so nothing sits against the edge. Not of the search box: a park
 * occupying a third of a 500-metre square would be drawn in a third of the
 * plan with empty grey around it.
 *
 * Latitude is flipped because north is up on a map and down is positive on a
 * screen, which is the bug every one of these has once.
 */
export function toFractions(found: FoundLot[]): { label: string; x: number; y: number }[] {
  if (!found.length) return [];
  const lats = found.map((f) => f.lat);
  const lngs = found.map((f) => f.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const spanLat = Math.max(1e-9, maxLat - minLat);
  const spanLng = Math.max(1e-9, maxLng - minLng);
  const pad = 0.08;
  const fit = (v: number) => pad + v * (1 - 2 * pad);

  return found.map((f) => ({
    label: f.label,
    x: Math.round(fit((f.lng - minLng) / spanLng) * 1e5) / 1e5,
    y: Math.round(fit(1 - (f.lat - minLat) / spanLat) * 1e5) / 1e5,
  }));
}

/**
 * Is this point inside that ring?
 *
 * A park is a parcel, and "within 250 metres" is not the same question --
 * it sweeps in Capri Street and Rosemary Drive and gives you eighty-five
 * lots when you have twenty-eight. The parcel boundary is the real answer
 * and the county publishes it.
 *
 * Ray casting, the standard even-odd test: count how many times a ray cast
 * east from the point crosses an edge. Odd is inside. Written out rather
 * than pulled in because it is nine lines and a dependency for nine lines
 * is a dependency to keep updated forever.
 */
export function inRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // The edge has to straddle the point's latitude, and the crossing has to
    // be east of it. The strict/non-strict mix is deliberate: it stops a
    // vertex exactly level with the point being counted twice.
    const straddles = (yi > lat) !== (yj > lat);
    if (straddles && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Inside the polygon, holes excluded.
 *
 *  A GeoJSON Polygon is an outer ring followed by any number of holes, and a
 *  MultiPolygon is a list of those. A parcel with a right of way through it
 *  has a hole, and a home in the hole is not on the parcel. */
export function inShape(lat: number, lng: number, geometry: unknown): boolean {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g?.coordinates) return false;

  // A Polygon is rings; a MultiPolygon is a list of those. Normalised to one
  // list of polygons so the test below has a single shape to walk.
  const polys: number[][][][] = g.type === "MultiPolygon"
    ? (g.coordinates as number[][][][])
    : [g.coordinates as number[][][]];

  for (const poly of polys) {
    if (!poly?.length) continue;
    if (!inRing(lat, lng, poly[0])) continue;
    const inHole = poly.slice(1).some((hole) => inRing(lat, lng, hole));
    if (!inHole) return true;
  }
  return false;
}

/** The parcel a point falls in, asked of a layer directly. Returns the
 *  geometry so the address points can be clipped to it. */
export async function parcelAt(
  layerUrl: string, lat: number, lng: number,
): Promise<{ geometry: unknown; props: Record<string, unknown> } | null> {
  const q = `${layerUrl}/query?where=1%3D1&geometry=${lng},${lat}`
    + "&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects"
    + "&outFields=*&outSR=4326&resultRecordCount=5&f=geojson";
  const out = await json(q);
  if (!out || out.type !== "FeatureCollection") return null;
  const f = ((out.features ?? []) as Record<string, unknown>[])[0];
  if (!f) return null;
  return { geometry: f.geometry, props: (f.properties ?? {}) as Record<string, unknown> };
}

/** Layers that look like they hold parcels, most promising first. */
export function parcelLayers(
  layers: { title: string; url: string }[],
): { title: string; url: string }[] {
  return layers.filter((l) => /parcel|cama|land ?record/i.test(l.title)
    && !/buffer|vol_ag|agriculture|mineral/i.test(l.title));
}

/**
 * A parcel, found by the number the county calls it.
 *
 * `parcelAt` asks "what is under this point", which needs you to know
 * where the park is already. This asks "where is P139-50A", which is
 * the question somebody has the answer to when they are looking at the
 * tax card -- and the answer carries the deed line with it, so the
 * property boundary comes from the county rather than from somebody
 * tracing it with a mouse.
 *
 * The field holding the number has a different name in every county --
 * PIN, PARCELID, GPIN, PIN_NUM -- so the layer is asked what its fields
 * are rather than guessed at. Every candidate is tried, because a layer
 * can carry several and only one of them is the one on the card.
 */
export async function pinFields(layerUrl: string): Promise<string[]> {
  const meta = await json(`${layerUrl}?f=json`);
  const fields = (meta?.fields ?? []) as { name?: string; type?: string }[];
  const names = fields
    .filter((f) => typeof f.name === "string")
    .map((f) => String(f.name));
  // Most likely first: a field actually called PIN beats one called
  // PARCEL_ADDRESS that happens to contain the word parcel.
  const score = (n: string) => {
    const u = n.toUpperCase();
    // Exactly the field, under one of the names counties actually use.
    // PARNO is North Carolina's own standard, which the first version of
    // this matched on none of -- so the statewide layer, the one that
    // covers every park here, would have come back "no such parcel".
    if (["PIN", "GPIN", "PARNO", "PARCELID", "PARCEL_ID", "APN", "PID"].includes(u)) return 0;
    if (["ALTPARNO", "PIN_NUM", "PINNUM", "TAXPIN", "REID", "PARCEL_NO"].includes(u)) return 1;
    if (/^(PIN|PARNO|APN|PID)|(PIN|PARNO|APN|PID)$/.test(u)) return 2;
    if (/PARCEL.?(ID|NO|NUM)|PIN|PARNO|REID|TAXID|PROP.?ID/.test(u)) return 3;
    return 99;
  };
  return names.filter((n) => score(n) < 99).sort((a, b) => score(a) - score(b)).slice(0, 8);
}

export async function parcelByPin(
  layerUrl: string, pin: string, fields?: string[], notes?: string[],
): Promise<{ geometry: unknown; props: Record<string, unknown>; field: string } | null> {
  const want = (fields?.length ? fields : await pinFields(layerUrl));
  if (!want.length) {
    notes?.push("that layer has no field that looks like a parcel number");
    return null;
  }
  const clean = pin.trim().replace(/'/g, "''");
  const bare = clean.toUpperCase().replace(/\s+/g, "");
  for (const f of want) {
    // Case and spacing differ between the card and the table often
    // enough that an exact match alone comes back empty and looks like
    // the parcel not existing. Then the separators: one county writes
    // P139-50A and the next writes P13950A for the same lot, and the
    // owner only ever has one of the two in front of them.
    const tries = [
      `UPPER(REPLACE(${f}, ' ', '')) = '${bare}'`,
      `UPPER(REPLACE(REPLACE(${f}, ' ', ''), '-', '')) = '${bare.replace(/-/g, "")}'`,
    ];
    for (const where of tries) {
      const q = `${layerUrl}/query?where=${encodeURIComponent(where)}`
        + "&outFields=*&outSR=4326&returnGeometry=true&resultRecordCount=5&f=geojson";
      const got = await asked(q);
      const out = got.data;
      if (!out) { notes?.push(`${f}: ${got.why}`); continue; }
      if (out.type !== "FeatureCollection") {
        notes?.push(`${f}: the answer was not parcels`);
        continue;
      }
      const hit = ((out.features ?? []) as Record<string, unknown>[])[0];
      if (hit?.geometry) {
        return {
          geometry: hit.geometry,
          props: (hit.properties ?? {}) as Record<string, unknown>,
          field: f,
        };
      }
    }
  }
  notes?.push(`asked ${want.join(", ")} — none of them holds ${pin}`);
  return null;
}

/** The outer ring of whatever came back, as [lng, lat] pairs.
 *
 *  A parcel is a Polygon or, where the county has split it round a
 *  right of way, a MultiPolygon. The biggest ring is the one somebody
 *  means by "the property line"; the others are slivers and holes. */
export function outerRing(geometry: unknown): number[][] {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g) return [];
  const rings: number[][][] = [];
  if (g.type === "Polygon") rings.push(...(g.coordinates as number[][][] ?? []));
  if (g.type === "MultiPolygon") {
    for (const poly of (g.coordinates as number[][][][] ?? [])) rings.push(...poly);
  }
  if (!rings.length) return [];

  // By area, not by how many corners it has: a traced curve has more
  // points than the lot it is a notch in.
  const area = (r: number[][]) => {
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) {
      a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    }
    return Math.abs(a / 2);
  };
  return rings.reduce((best, r) => (area(r) > area(best) ? r : best), rings[0])
    .map((p) => [Number(p[0]), Number(p[1])]);
}
