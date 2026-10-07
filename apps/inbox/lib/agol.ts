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
};

const AGOL = "https://www.arcgis.com/sharing/rest/content/items";

async function json(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch { return null; }
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
  // Bounded: a county map can reference six services of forty layers each,
  // and the point is to find address points, not to crawl their estate.
  return out.slice(0, 60);
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
function centroid(g: { type?: string; coordinates?: unknown } | null): { lat: number; lng: number } | null {
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
