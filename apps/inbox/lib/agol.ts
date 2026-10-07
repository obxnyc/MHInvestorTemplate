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

/** Every layer the county's app puts on the map. */
export async function layersOf(appId: string): Promise<{ title: string; url: string }[]> {
  const app = await json(`${AGOL}/${appId}/data?f=json`);
  const values = (app?.values ?? {}) as Record<string, unknown>;
  const mapId = (values.webmap ?? values.mapItemId ?? null) as string | null;
  if (!mapId) return [];

  const map = await json(`${AGOL}/${mapId}/data?f=json`);
  const out: { title: string; url: string }[] = [];
  for (const l of (map?.operationalLayers ?? []) as Record<string, unknown>[]) {
    if (typeof l.url === "string") out.push({ title: String(l.title ?? "—"), url: l.url });
    // A group layer hides its real layers one level down, and the address
    // points are nearly always inside one.
    for (const sub of (l.layers ?? []) as Record<string, unknown>[]) {
      if (typeof sub.url === "string") {
        out.push({ title: `${l.title ?? "—"} · ${sub.title ?? "—"}`, url: sub.url });
      }
    }
  }
  return out;
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
