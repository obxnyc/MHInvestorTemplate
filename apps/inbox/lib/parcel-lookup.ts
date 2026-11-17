/**
 * Who owns the ground under a point, from NC OneMap's statewide parcels.
 *
 * Four answers, not two, because the screen has to say which one it got:
 *   found    -- a parcel, with its owner
 *   none     -- the county answered and there is no parcel there (a road,
 *               a river, a fix that landed in the middle of the street)
 *   outside  -- not North Carolina; the statewide layer stops at the line
 *   failed   -- the county did not answer; try again later
 * "No owner" and "could not ask" look the same on a list and are not.
 *
 * Pure parsing is split from the fetch so it can be tested against a
 * stand-in reply -- this machine cannot reach nconemap.gov, the deployment
 * can.
 */

export type Lookup = {
  lookup: "found" | "none" | "outside" | "failed";
  detail?: string;
  owner_name?: string | null; mail_address?: string | null; site_address?: string | null;
  county?: string | null; parcel_no?: string | null; acres?: number | null; assessed?: number | null;
  parcel?: Record<string, unknown> | null;
};

const LAYER = "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1/query";

/** North Carolina's outline, roughly -- to within a few miles, clockwise
 *  from the Georgia-Tennessee corner. A rectangle will not do: Atlanta and
 *  half of upstate South Carolina sit inside NC's bounding box, and asking
 *  the NC layer about them answers "no parcel", which reads as a road when
 *  the truth is "another state". Close to the line, the county is asked
 *  anyway and its answer is the one that counts. */
const NC: [number, number][] = [
  [-84.32, 35.0], [-83.11, 35.0], [-82.4, 35.21], [-81.04, 35.15], [-80.93, 35.1], [-80.78, 34.82],
  [-79.67, 34.8], [-78.55, 33.86], [-77.9, 33.75], [-76.5, 34.6], [-75.45, 35.2], [-75.75, 36.55],
  [-81.68, 36.59], [-82.6, 36.0], [-83.5, 35.55], [-84.0, 35.25],
];
const SLACK_DEG = 0.08; // about five miles: near the line, ask rather than guess

function inside(lat: number, lon: number, ring: [number, number][]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function nearEdge(lat: number, lon: number, ring: [number, number][]) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[i];
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(lon - (x1 + t * dx), lat - (y1 + t * dy)) < SLACK_DEG) return true;
  }
  return false;
}

/** Worth asking NC's parcels about: inside the outline, or close enough to
 *  the line that the outline's own roughness could be wrong. */
export function inNC(lat: number, lon: number) {
  return inside(lat, lon, NC) || nearEdge(lat, lon, NC);
}

const s = (v: unknown) => (v == null ? null : String(v).trim() || null);
const n = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** The reply, read. When a point sits on two parcels (a boundary), the
 *  bigger one is the one somebody standing there was looking at. */
export function readParcelReply(body: unknown): Lookup {
  const b = body as { error?: { message?: string }; features?: { attributes?: Record<string, unknown> }[] } | null;
  if (!b || typeof b !== "object") return { lookup: "failed", detail: "the county's reply was not data" };
  if (b.error) return { lookup: "failed", detail: `the county said: ${b.error.message ?? "error"}` };
  const feats = (b.features ?? []).map((f) => f.attributes ?? {});
  if (!feats.length) return { lookup: "none" };
  const a = feats.sort((x, y) => (n(y.gisacres) ?? 0) - (n(x.gisacres) ?? 0))[0];
  const owner = [s(a.ownname), s(a.ownname2)].filter(Boolean).join(" & ") || null;
  const mail = [s(a.mailadd), [s(a.mcity), s(a.mstate)].filter(Boolean).join(", "), s(a.mzip)].filter(Boolean).join(" ") || null;
  const site = [s(a.siteadd), s(a.scity)].filter(Boolean).join(", ") || null;
  return {
    lookup: "found", owner_name: owner, mail_address: mail, site_address: site,
    county: s(a.cntyname), parcel_no: s(a.parno), acres: n(a.gisacres), assessed: n(a.parval),
    parcel: a,
  };
}

/** Near the line the county is asked even for a point just over it -- and
 *  NC's layer then has nothing there. That "nothing" means another state,
 *  not a road, when the point is outside the outline. */
export function settle(found: Lookup, lat: number, lon: number): Lookup {
  return found.lookup === "none" && !inside(lat, lon, NC) ? { lookup: "outside" } : found;
}

export async function lookupParcel(lat: number, lon: number, timeoutMs = 9000): Promise<Lookup> {
  if (!inNC(lat, lon)) return { lookup: "outside" };
  const u = new URL(LAYER);
  u.searchParams.set("geometry", JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
  u.searchParams.set("geometryType", "esriGeometryPoint");
  u.searchParams.set("inSR", "4326");
  u.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  u.searchParams.set("outFields", "ownname,ownname2,mailadd,mcity,mstate,mzip,siteadd,scity,cntyname,parno,gisacres,parval,parusedesc,saledatetx,structyear");
  u.searchParams.set("returnGeometry", "false");
  u.searchParams.set("f", "json");
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!r.ok) return { lookup: "failed", detail: `the county answered ${r.status}` };
    return settle(readParcelReply(await r.json()), lat, lon);
  } catch (e) {
    return { lookup: "failed", detail: `the county did not answer (${(e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message})` };
  }
}
