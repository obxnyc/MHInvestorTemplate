import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Where the pictures and the parcel lines come from.
 *
 * Rows rather than code, because the portfolio is already in six counties and
 * every purchase outside that footprint adds another. Wiring each into a
 * deployment would mean a release per county.
 *
 * Suggested starting points are offered rather than assumed correct. None of
 * them can be verified from the machine this was written on -- outbound
 * traffic there is walled off -- so each is tested from the deployment, once,
 * and what it actually said is written down beside it.
 */

/** Free, no key, no account. Worth trying in this order. */
const SUGGESTIONS = [
  {
    name: "NC statewide orthoimagery",
    kind: "imagery" as const,
    url: "https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest/ImageServer/exportImage"
      + "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpgpng&f=image",
    attribution: "NC OneMap",
    state: "NC", rank: 50,
  },
  {
    name: "USDA NAIP, nationwide",
    kind: "imagery" as const,
    url: "https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/exportImage"
      + "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpgpng&f=image",
    attribution: "USDA NAIP",
    state: null, rank: 90,
  },
  {
    name: "Esri world imagery",
    kind: "imagery" as const,
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, Maxar, Earthstar Geographics",
    state: null, rank: 95,
  },
  {
    name: "NC statewide parcels",
    kind: "parcels" as const,
    url: "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1",
    attribution: "NC OneMap",
    state: "NC", rank: 50,
  },
];

export async function GET() {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const { data, error } = await supabaseAdmin().from("map_sources")
    .select("*").order("kind").order("rank");
  if (error) {
    return NextResponse.json({
      pending: true, sources: [], suggestions: SUGGESTIONS,
      hint: "Run migration 025 — there is nowhere to keep a map source yet.",
    });
  }
  return NextResponse.json({ sources: data ?? [], suggestions: SUGGESTIONS });
}

/** Add one, or test one, or turn one off. */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();

  if (body.remove) {
    await db.from("map_sources").delete().eq("id", String(body.remove));
    return NextResponse.json({ ok: true });
  }

  if (body.test) {
    const { data: src } = await db.from("map_sources")
      .select("id, kind, url").eq("id", String(body.test)).maybeSingle();
    if (!src) return NextResponse.json({ error: "no such source" }, { status: 404 });
    const said = await tryIt(String(src.kind), String(src.url));
    await db.from("map_sources").update({
      checked_at: new Date().toISOString(),
      checked_ok: said.ok, checked_say: said.say,
    }).eq("id", src.id);
    return NextResponse.json(said);
  }

  const { name, kind, url, attribution, county, state, rank } = body;
  if (!name || !["imagery", "parcels"].includes(String(kind)) || !url) {
    return NextResponse.json({ error: "needs a name, a kind and a URL" }, { status: 400 });
  }
  const { data, error } = await db.from("map_sources").insert({
    name: String(name).trim(), kind: String(kind), url: String(url).trim(),
    attribution: attribution ? String(attribution).trim() : null,
    county: county ? String(county).trim() : null,
    state: state === null ? null : String(state ?? "NC").trim() || null,
    rank: Number.isFinite(Number(rank)) ? Number(rank) : 100,
  }).select("id").single();
  if (error) {
    return NextResponse.json({
      error: /map_sources/.test(error.message)
        ? "Run migration 025 first." : error.message,
    }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: data.id });
}

/**
 * Does it actually answer, and with what?
 *
 * Tested over Elizabeth City, because a source that works over the whole
 * state and not over the ground we own is no use. An imagery service has to
 * return an image; a parcel service has to return shapes.
 */
async function tryIt(kind: string, url: string): Promise<{ ok: boolean; say: string }> {
  // A small box around 1140 Northside, in Web Mercator metres.
  const BBOX = "-8489500,4353700,-8489000,4354200";
  try {
    if (kind === "imagery") {
      const one = url
        .replace("{bbox-epsg-3857}", BBOX)
        // A tile template gets a real tile over the same ground instead.
        .replace("{z}", "17").replace("{x}", "37083").replace("{y}", "51962");
      const res = await fetch(one, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok) return { ok: false, say: `HTTP ${res.status}` };
      if (!/^image\//.test(type)) {
        const text = (await res.text()).slice(0, 160);
        return { ok: false, say: `answered with ${type || "nothing"}: ${text}` };
      }
      const bytes = (await res.arrayBuffer()).byteLength;
      // A blank tile is a valid image and a useless one.
      return bytes < 1200
        ? { ok: false, say: `returned an empty ${bytes}-byte image — probably no coverage there` }
        : { ok: true, say: `${type}, ${Math.round(bytes / 1024)}KB over Elizabeth City` };
    }

    const q = `${url.replace(/\/$/, "")}/query`
      + `?geometry=${encodeURIComponent(BBOX)}&geometryType=esriGeometryEnvelope`
      + `&inSR=3857&spatialRel=esriSpatialRelIntersects&outFields=*`
      + `&resultRecordCount=1&f=geojson`;
    const res = await fetch(q, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
    if (!res.ok) return { ok: false, say: `HTTP ${res.status}` };
    const j = await res.json() as { type?: string; features?: unknown[] };
    if (j.type !== "FeatureCollection") {
      return { ok: false, say: "answered, but not with GeoJSON" };
    }
    const n = (j.features ?? []).length;
    return n
      ? { ok: true, say: `returned ${n} parcel over Elizabeth City` }
      : { ok: false, say: "answered, but has no parcels there" };
  } catch (e) {
    return { ok: false, say: (e as Error).message };
  }
}
