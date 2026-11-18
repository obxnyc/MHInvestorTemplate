/**
 * A property's own property line, from the county.
 *
 * Every property has one whether or not anybody has drawn it, and asking
 * the owner to paste a county parcel viewer's address bar to get it was
 * asking a person to do what a lookup can. North Carolina publishes every
 * county's parcels in one place -- NC OneMap -- so one query by house
 * number and street finds it for any property in the state.
 *
 * The county's line is the DEFAULT. A line somebody has drawn on the park
 * screen (`plan.fence` with `fenceFrom` "hand") is an override and wins:
 * The Retreat's and Cross Creek's were drawn by hand on purpose. This
 * module never touches a plan; it only says what the county says.
 *
 * Stored on `properties.parcel_geojson` (migration 025 made the column and
 * nothing ever filled it) as a GeoJSON Feature, with `parcel_ref` the
 * county's map reference and `parcel_at` when it was read.
 */

export type ParcelFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: number[][][] };
};

const SERVICE =
  "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/1/query";

/** "1142 Northside Rd, Elizabeth City, NC 27909" → what the county's
 *  site address column can be matched against: the house number and the
 *  first word of the street, with a leading direction kept. The county pads
 *  numbers with zeros ("01142 NORTHSIDE RD"), so the match is a LIKE. */
export function addressKey(address: string): string | null {
  const m = address.trim().match(/^(\d+)[-\d]*\s+(?:([NSEW])\s+)?([A-Za-z]+)/);
  if (!m) return null;
  return `${m[1]} ${m[2] ? `${m[2].toUpperCase()} ` : ""}${m[3].toUpperCase()}`;
}

/** The query string for one address, as NC OneMap wants it. */
export function queryUrl(address: string): string | null {
  const key = addressKey(address);
  if (!key) return null;
  const where = `upper(siteadd) LIKE '%${key}%'`;
  const q = new URLSearchParams({
    where,
    outFields: "parno,mapref,siteadd,scity,ownname,gisacres,cntyname",
    returnGeometry: "true", outSR: "4326", geometryPrecision: "7", f: "json",
  });
  return `${SERVICE}?${q.toString()}`;
}

/** The parcel a point stands in. */
export function pointUrl(pin: [number, number]): string {
  const q = new URLSearchParams({
    geometry: `${pin[0]},${pin[1]}`, geometryType: "esriGeometryPoint",
    inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    outFields: "parno,mapref,siteadd,scity,ownname,gisacres,cntyname",
    returnGeometry: "true", outSR: "4326", geometryPrecision: "7", f: "json",
  });
  return `${SERVICE}?${q.toString()}`;
}

/** Whether a parcel found under a pin is this address: its site address
 *  is blank (the county publishes none) or carries the same house number. */
export function sameHouse(f: { attributes: Record<string, unknown> }, address: string): boolean {
  const site = String(f.attributes.siteadd ?? "").trim();
  if (!site) return true;
  const want = address.trim().match(/^(\d+)/)?.[1];
  const have = site.match(/^0*(\d+)/)?.[1];
  return Boolean(want && have && Number(want) === Number(have));
}

/** The outer ring of a parcel, or nothing. */
export function ringOf(p: unknown): number[][] {
  const f = p as ParcelFeature | null;
  const r = f?.geometry?.coordinates?.[0];
  return Array.isArray(r) && r.length >= 4 ? r : [];
}

export function middle(ring: number[][]): [number, number] | null {
  if (!ring.length) return null;
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

/** Metres between two points, near enough for choosing the nearer. */
export function metres(a: [number, number], b: [number, number]): number {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  return Math.hypot((a[0] - b[0]) * 111320 * Math.cos(lat), (a[1] - b[1]) * 110540);
}

type Esri = {
  attributes: Record<string, unknown>;
  geometry?: { rings?: number[][][] };
};

/**
 * Which of the county's answers is this property.
 *
 * "1002 MAPLE" matches a 1002 Maple Street in two towns, and a street
 * name can be shared by a road and a court. The city narrows it; then the
 * one nearest the property's own pin. With no pin and two candidates
 * left, nothing is chosen: a neighbour's land drawn as ours is worse than
 * no line at all.
 */
export function choose(
  features: Esri[], address: string, pin: [number, number] | null,
): Esri | null {
  const withShape = features.filter((f) => f.geometry?.rings?.[0]?.length);
  if (!withShape.length) return null;
  const city = address.split(",")[1]?.trim().toUpperCase() ?? "";
  const inTown = city
    ? withShape.filter((f) => String(f.attributes.scity ?? "").toUpperCase() === city)
    : [];
  const pool = inTown.length ? inTown : withShape;
  // A lone answer is only trusted without a pin. With one, it has to be
  // near it: "128 Sunflower Ln" exists in more than one county, and the
  // only match the state returned was 347 km from the property.
  if (!pin) return pool.length === 1 ? pool[0] : null;
  let best: Esri | null = null, d = Infinity;
  for (const f of pool) {
    const c = middle(f.geometry!.rings![0]);
    const m = c ? metres(c, pin) : Infinity;
    if (m < d) { d = m; best = f; }
  }
  // A pin more than a kilometre from every candidate is pinned somewhere
  // else entirely, and choosing among them by distance is a guess.
  return d < 1000 ? best : null;
}

export function asFeature(f: Esri): ParcelFeature {
  return {
    type: "Feature",
    properties: f.attributes,
    geometry: { type: "Polygon", coordinates: f.geometry!.rings! },
  };
}

/** The county's map reference ("P139-44"), else its parcel number. */
export function refOf(f: Esri | ParcelFeature): string {
  const a = ("attributes" in f ? f.attributes : f.properties) ?? {};
  const map = String(a.mapref ?? "").replace(/^Map reference\s*/i, "").trim();
  return map || String(a.parno ?? "").trim();
}

/** Ask the state for one property's parcel. Server-side only. */
export async function lookup(
  address: string, pin: [number, number] | null, ms = 8000,
): Promise<ParcelFeature | null> {
  const url = queryUrl(address);
  if (!url) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    const out = res.ok ? await res.json() as { features?: Esri[] } : {};
    const hit = choose(out.features ?? [], address, pin);
    if (hit) return asFeature(hit);
    // Some counties publish no site address at all, so the address finds
    // nothing. Then the parcel the property's own pin stands in -- unless
    // that parcel names a different house number, which means the pin is
    // on the neighbour's land.
    if (!pin) return null;
    const at = await fetch(pointUrl(pin), { signal: ctl.signal, cache: "no-store" });
    if (!at.ok) return null;
    const under = (await at.json() as { features?: Esri[] }).features?.[0];
    if (!under?.geometry?.rings?.[0]?.length) return null;
    return sameHouse(under, address) ? asFeature(under) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Suggestions: the state's parcel records as an address book.
//
// There is no Google key on this server, so the address box suggested
// nothing. NC OneMap publishes a POINT for every parcel with its site
// address, and every suggestion made from it is a real parcel -- so picking
// one gives the property its address, its pin and, when the map opens, its
// property line, all from the same record.
// ---------------------------------------------------------------------------

const POINTS =
  "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/0/query";

export type Suggestion = {
  /** `nc:<county>:<parcel number>` -- enough to fetch it again. */
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  county: string;
  owner: string;
  acres: number | null;
};

const title = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** "00218 BUENA VISTA RD", "MURFREESBORO" → "218 Buena Vista Rd, Murfreesboro, NC". */
export function prettyAddress(siteadd: string, city: string): string {
  const street = title(siteadd.trim().replace(/^0+(?=\d)/, "").replace(/\s+/g, " "))
    // NC, not Nc; a lone direction letter stays a capital.
    .replace(/\b(Nc|Ne|Nw|Se|Sw)\b/g, (m) => m.toUpperCase());
  const town = city.trim() ? `, ${title(city.trim())}` : "";
  return `${street}${town}, NC`;
}

/** The SQL-ish where clause for what somebody has typed so far, or null
 *  when there is not enough to ask about. Quotes are doubled, never passed. */
export function suggestWhere(q: string): string | null {
  const clean = q.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const m = clean.match(/^(\d+)\s+([A-Z][A-Z ]*)/);
  if (m) {
    const words = m[2].split(" ").filter(Boolean).slice(0, 2).join(" ");
    if (words.length < 2) return null;
    return `upper(siteadd) LIKE '%${m[1]} ${words}%'`;
  }
  return null;
}

type Pt = { attributes: Record<string, unknown>; geometry?: { x?: number; y?: number } };

function asSuggestion(f: Pt): Suggestion | null {
  const a = f.attributes;
  const x = f.geometry?.x, y = f.geometry?.y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  const site = String(a.siteadd ?? "").trim();
  if (!site) return null;
  const county = String(a.cntyname ?? "").trim();
  const address = prettyAddress(site, String(a.scity ?? ""));
  const acres = typeof a.gisacres === "number" ? a.gisacres : null;
  const owner = String(a.ownname ?? "").trim();
  return {
    id: `nc:${county}:${String(a.parno ?? "").trim()}`,
    label: `${address} · ${county} Co.${acres ? ` · ${acres.toFixed(acres < 10 ? 2 : 1)} ac` : ""}`,
    address, lat: y, lng: x, county, owner, acres,
  };
}

async function points(where: string, n: number, ms: number): Promise<Suggestion[]> {
  const q = new URLSearchParams({
    where, outFields: "parno,siteadd,scity,cntyname,ownname,gisacres",
    returnGeometry: "true", outSR: "4326", geometryPrecision: "6",
    resultRecordCount: String(n), f: "json",
  });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${POINTS}?${q.toString()}`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return [];
    const out = await res.json() as { features?: Pt[] };
    return (out.features ?? []).map(asSuggestion).filter((s): s is Suggestion => Boolean(s));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/** Parcels whose address starts the way the person is typing. */
export async function suggest(q: string, n = 8): Promise<Suggestion[]> {
  const where = suggestWhere(q);
  return where ? points(where, n, 6000) : [];
}

/** One parcel's point, by the id a suggestion carried. */
export async function suggestionById(id: string): Promise<Suggestion | null> {
  const m = id.match(/^nc:([A-Za-z .'-]+):([A-Za-z0-9 .-]+)$/);
  if (!m) return null;
  const esc = (s: string) => s.replace(/'/g, "''");
  const got = await points(`cntyname='${esc(m[1])}' AND parno='${esc(m[2])}'`, 1, 8000);
  return got[0] ?? null;
}

/** The street part of an address, as the county writes it: "Buena Vista". */
export function streetOf(address: string): { number: number | null; street: string; city: string } {
  const [first, city = ""] = address.split(",").map((s) => s.trim());
  const m = first.match(/^(\d+)?[-\d]*\s*(.*)$/);
  const words = (m?.[2] ?? "").toUpperCase().replace(/[^A-Z ]/g, " ")
    .split(/\s+/).filter(Boolean);
  // The road type ("Rd", "Street") is spelt every way there is; the name is
  // what identifies the street, so it is the name that is matched.
  const TYPES = /^(RD|ROAD|ST|STREET|DR|DRIVE|LN|LANE|AVE|AVENUE|CT|COURT|CIR|CIRCLE|HWY|WAY|TRL|TRAIL|PL|EXT|BLVD)$/;
  // Typed without commas -- "101 Buena vista rd Murfreesboro NC 27855", as
  // Serenity was -- the town is whatever follows the road type.
  const at = words.findIndex((w) => TYPES.test(w));
  const streetWords = !city && at > 0 ? words.slice(0, at) : words;
  const town = city || (at > 0 ? words.slice(at + 1).filter((w) => w !== "NC").join(" ") : "");
  const name = streetWords.filter((w) => !TYPES.test(w)).slice(0, 2).join(" ");
  return {
    number: m?.[1] ? Number(m[1]) : null,
    street: name,
    city: town.toUpperCase().replace(/\s+NC\b.*$/, "").replace(/\s+\d{5}.*$/, "").trim(),
  };
}

/**
 * "Is it one of these?" -- parcels on the same street in the same town, the
 * nearest house number first.
 *
 * A park newly built on old land is often still filed under the land's old
 * address and owner (Serenity, "101 Buena Vista Rd", is the county's "218
 * Buena Vista Rd", owned on paper by the people it was bought from). The
 * address will not match; the street and the town will.
 */
export async function nearbyOnStreet(address: string, n = 6): Promise<Suggestion[]> {
  const s = streetOf(address);
  if (s.street.length < 3) return [];
  const esc = (v: string) => v.replace(/'/g, "''");
  const where = `upper(siteadd) LIKE '% ${esc(s.street)}%'`
    + (s.city ? ` AND upper(scity) = '${esc(s.city)}'` : "");
  const found = await points(where, 40, 8000);
  const num = (x: Suggestion) => Number(x.address.match(/^(\d+)/)?.[1] ?? NaN);
  return found
    .sort((a, b) => (s.number === null ? 0
      : Math.abs(num(a) - s.number) - Math.abs(num(b) - s.number)))
    .slice(0, n);
}

/** A parcel's outline by county and parcel number. */
export async function byParcelNumber(county: string, parno: string, ms = 10000): Promise<ParcelFeature | null> {
  const esc = (s: string) => s.replace(/'/g, "''");
  const q = new URLSearchParams({
    where: `cntyname='${esc(county)}' AND parno='${esc(parno)}'`,
    outFields: "parno,mapref,siteadd,scity,ownname,gisacres,cntyname",
    returnGeometry: "true", outSR: "4326", geometryPrecision: "7", f: "json",
  });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${SERVICE}?${q.toString()}`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const f = (await res.json() as { features?: Esri[] }).features?.[0];
    return f?.geometry?.rings?.[0]?.length ? asFeature(f) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
