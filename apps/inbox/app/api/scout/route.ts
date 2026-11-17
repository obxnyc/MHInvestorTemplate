import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { BUCKET } from "@/lib/media";
import { isDesk } from "@/lib/roles";
import { lookupParcel } from "@/lib/parcel-lookup";
import { SPOT_KINDS, SPOT_STAGES, SPOT_TAGS, photoPathOk } from "@/lib/scout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Driving for dollars (075).
 *
 *   GET    a scout's own sightings; the office gets everybody's
 *   POST   log one: where, what, photos, tags -- the owner is looked up
 *          HERE, before the row is written, so a scout never needs leave
 *          to edit a row afterwards
 *   PATCH  the office works one: stage, a note, or ask the county again
 *
 * Rows are written as the signed-in person (row policy: by = auth.uid()).
 * Only photo SIGNING uses the service role, because the bucket is private.
 */

const COLS = "id, by, lat, lon, accuracy_m, kind, tags, note, photos, lookup, owner_name, mail_address, site_address, county, parcel_no, acres, assessed, stage, office_note, created_at, updated_at, staff:staff!scout_spots_by_fkey(full_name)";

async function signed(rows: { photos: string[] }[]) {
  const paths = [...new Set(rows.flatMap((r) => r.photos ?? []))];
  if (!paths.length) return {} as Record<string, string>;
  const { data } = await supabaseAdmin().storage.from(BUCKET).createSignedUrls(paths, 3600);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

export async function GET() {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const db = await supabaseServer();
  let q = db.from("scout_spots").select(COLS).order("created_at", { ascending: false }).limit(500);
  if (!isDesk(me.role)) q = q.eq("by", me.id);
  const { data, error } = await q;
  if (error) return NextResponse.json({
    error: /scout_spots/.test(error.message) ? "Migration 075 has not been applied yet, so sightings have nowhere to go." : error.message,
  }, { status: 500 });
  const urls = await signed((data ?? []) as unknown as { photos: string[] }[]);
  return NextResponse.json({ spots: data, urls, office: isDesk(me.role) });
}

export async function POST(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return NextResponse.json({ error: "The phone has not said where you are yet. Wait for the location, then save." }, { status: 400 });
  const acc = b.accuracy == null ? null : Number(b.accuracy);
  const kind = SPOT_KINDS.some(([k]) => k === b.kind) ? String(b.kind) : "other";
  const tags = Array.isArray(b.tags) ? [...new Set(b.tags.map(String).filter((t) => SPOT_TAGS.some(([k]) => k === t)))] : [];
  const note = b.note ? String(b.note).trim().slice(0, 2000) || null : null;
  const photos = Array.isArray(b.photos) ? b.photos.map(String) : [];
  const now = Date.now();
  const bad = photos.find((p) => !photoPathOk(p, me.id, now));
  if (bad) return NextResponse.json({ error: "One of those photos is not one you took in the last hour. Take it again." }, { status: 400 });
  if (photos.length > 12) return NextResponse.json({ error: "Twelve photos is the most for one property." }, { status: 400 });
  if (!photos.length && !note && !tags.length)
    return NextResponse.json({ error: "Add a photo, a tag or a note, so the office knows why you stopped." }, { status: 400 });

  const found = await lookupParcel(lat, lon);
  const db = await supabaseServer();
  const { data, error } = await db.from("scout_spots").insert({
    by: me.id, lat, lon, accuracy_m: Number.isFinite(acc) ? acc : null, kind, tags, note, photos,
    lookup: found.lookup, parcel: found.parcel ?? (found.detail ? { detail: found.detail } : null),
    owner_name: found.owner_name ?? null, mail_address: found.mail_address ?? null,
    site_address: found.site_address ?? null, county: found.county ?? null, parcel_no: found.parcel_no ?? null,
    acres: found.acres ?? null, assessed: found.assessed ?? null,
  }).select(COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ spot: data, urls: await signed([data as unknown as { photos: string[] }]), detail: found.detail ?? null });
}

export async function PATCH(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });
  if (!isDesk(me.role)) return NextResponse.json({ error: "office and admin only" }, { status: 403 });
  const { id: rawId, ...b } = await req.json().catch(() => ({})) as Record<string, unknown>;
  const id = String(rawId ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "which sighting?" }, { status: 400 });
  const db = await supabaseServer();
  const patch: Record<string, unknown> = {};
  if ("stage" in b) {
    if (!SPOT_STAGES.some(([k]) => k === b.stage)) return NextResponse.json({ error: "unknown stage" }, { status: 400 });
    patch.stage = b.stage;
  }
  if ("office_note" in b) patch.office_note = b.office_note ? String(b.office_note).slice(0, 4000) : null;
  if (b.relookup) {
    const { data: cur, error } = await db.from("scout_spots").select("lat, lon").eq("id", id).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const f = await lookupParcel(cur.lat, cur.lon);
    Object.assign(patch, {
      lookup: f.lookup, parcel: f.parcel ?? (f.detail ? { detail: f.detail } : null),
      owner_name: f.owner_name ?? null, mail_address: f.mail_address ?? null, site_address: f.site_address ?? null,
      county: f.county ?? null, parcel_no: f.parcel_no ?? null, acres: f.acres ?? null, assessed: f.assessed ?? null,
    });
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  const { data, error } = await db.from("scout_spots")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: me.id }).eq("id", id).select(COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ spot: data });
}
