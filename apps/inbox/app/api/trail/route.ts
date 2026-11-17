import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { trail, type Point, type Site } from "@/lib/trail";
import { defaultRadius } from "@/lib/fence";
import { isField } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { signMedia } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One person's day as a trail: clock-in, every ping, clock-out, in order,
 * with the stops worked out. Office and admin only -- where somebody was at
 * four o'clock is not something their workmates get to read, and the row
 * policies in 038 already say the same.
 *
 * Nothing here deletes or ages anything out. The owner asked to be able to
 * go back about three weeks; the pings are kept, and the day picker goes
 * back as far as there is anything to show.
 */
export async function GET(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
  const staffId = url.searchParams.get("staff") ?? "";
  const day = url.searchParams.get("day") ?? "";

  const db = await supabaseServer();
  const { data: staff } = await db.from("staff")
    .select("id, full_name, role, active").eq("active", true).order("full_name");
  // Everybody who could be on a clock, so the picker is never empty.
  const people = (staff ?? []).filter((s) => isField(s.role))
    .map((s) => ({ id: String(s.id), name: String(s.full_name ?? "Unknown") }));

  if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ people });
  }

  // The local day, in the reader's own clock.
  const from = new Date(Date.parse(`${day}T00:00:00Z`) + offset * 60_000).toISOString();
  const to = new Date(Date.parse(`${day}T00:00:00Z`) + 864e5 + offset * 60_000).toISOString();

  const [shiftsRes, siteRes] = await Promise.all([
    db.from("shifts")
      .select("id, started_at, ended_at, property_id, start_lat, start_lng, start_acc, end_lat, end_lng, end_acc, start_fence, start_metres, auto_clocked_out, start_photos")
      .eq("staff_id", staffId).gte("started_at", from).lt("started_at", to)
      .order("started_at"),
    db.from("properties").select("id, name, kind, lat, lng, fence_m").not("lat", "is", null),
  ]);
  if (shiftsRes.error) {
    return NextResponse.json({ error: shiftsRes.error.message, people }, { status: 500 });
  }
  const shifts = shiftsRes.data ?? [];

  const { data: pings, error: pe } = shifts.length
    ? await db.from("shift_pings").select("shift_id, at, lat, lng, accuracy")
        .in("shift_id", shifts.map((s) => s.id)).order("at").limit(3000)
    : { data: [], error: null };
  if (pe) return NextResponse.json({ error: pe.message, people }, { status: 500 });

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const points: Point[] = [];
  for (const s of shifts) {
    if (s.start_lat !== null) points.push({ lat: Number(s.start_lat), lng: Number(s.start_lng),
      accuracy: num(s.start_acc), at: String(s.started_at), kind: "in" });
    if (s.ended_at && s.end_lat !== null) points.push({ lat: Number(s.end_lat), lng: Number(s.end_lng),
      accuracy: num(s.end_acc), at: String(s.ended_at), kind: "out" });
  }
  for (const p of pings ?? []) {
    points.push({ lat: Number(p.lat), lng: Number(p.lng), accuracy: num(p.accuracy),
      at: String(p.at), kind: "ping" });
  }

  const sites: Site[] = (siteRes.data ?? []).map((p) => ({
    id: String(p.id), name: String(p.name), lat: Number(p.lat), lng: Number(p.lng),
    radius: p.fence_m ? Number(p.fence_m) : defaultRadius(p.kind as string | null),
  }));
  const names = new Map(sites.map((s) => [s.id, s.name]));
  // Clock-in photos, as links that stop working in ten minutes: a selfie is
  // somebody's face, and a link to it should not outlive the look.
  const photoPaths = shifts.flatMap((s) => (Array.isArray(s.start_photos) ? s.start_photos : []).map(String));
  const signed = await signMedia(supabaseAdmin(), photoPaths, 600);
  const byId = new Map(sites.map((s) => [s.id, s]));
  // The jobs he clocked in at, with where they are, so the map can always
  // show and centre on them -- even on a day with no positions at all,
  // which is the day a map of every grey square in the county says nothing.
  const jobs = [...new Set(shifts.map((s) => s.property_id).filter(Boolean).map(String))]
    .map((id) => byId.get(id)).filter((s): s is Site => !!s)
    .map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng }));
  // Unpinned jobs have a name but nowhere to draw them; said in the list.
  const unpinned = [...new Set(shifts.map((s) => s.property_id).filter(Boolean).map(String))]
    .filter((id) => !byId.has(id));
  const nameAny = unpinned.length
    ? new Map(((await db.from("properties").select("id, name").in("id", unpinned)).data ?? [])
        .map((p) => [String(p.id), String(p.name)]))
    : new Map<string, string>();

  return NextResponse.json({
    people,
    day,
    shifts: shifts.map((s) => ({
      id: String(s.id), startedAt: String(s.started_at), endedAt: (s.ended_at as string | null) ?? null,
      site: s.property_id
        ? names.get(String(s.property_id)) ?? nameAny.get(String(s.property_id)) ?? "A job"
        : null,
      offSite: s.start_fence === "outside", metres: num(s.start_metres),
      noFix: s.start_lat === null, autoOut: !!s.auto_clocked_out,
      photos: (Array.isArray(s.start_photos) ? s.start_photos : []).map(String)
        .map((p) => ({ kind: /-face\./.test(p) ? "face" : "site", url: signed.get(p) ?? null,
                       at: new Date(Number(p.split("/").pop()!.split("-")[0])).toISOString() })),
    })),
    ...trail(points, sites),
    sites,
    jobs,
  });
}
