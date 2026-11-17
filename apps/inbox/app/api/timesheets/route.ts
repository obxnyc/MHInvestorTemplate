import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { week, weekStart, type Shift } from "@/lib/shift";
import { isField } from "@/lib/roles";
import { whereNow, hoursBySite, type OpenShift, type Ping } from "@/lib/crew";
import { checkEntry, overlaps } from "@/lib/office-hours";
import { onBehalfText } from "@/lib/integrity";
import { alertOwners } from "@/lib/alert-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The office's side of the clock.
 *
 * Who is out, what everybody's week adds up to, and the corrections waiting
 * to be agreed. The crew screen can ask for a correction; without this one
 * the asking goes nowhere, which is the same fault as a send that clears the
 * box and never reads the answer -- it looks like something happened.
 *
 * Approving goes through `approve_shift_edit`, a single function in migration
 * 039. Moving hours on a pay record and recording that they moved must not be
 * able to come apart, and from here they would be two round trips.
 */

type Db = Awaited<ReturnType<typeof supabaseServer>>;

async function shiftsSince(db: Db, from: string): Promise<(Shift & { name: string })[]> {
  const { data } = await db.from("shifts")
    // Named FK, not `staff(...)`: shifts points at staff twice (staff_id and
    // settled_by) and PostgREST refuses an embed it cannot disambiguate --
    // the whole select fails and every hour on this screen reads as nought.
    .select("id, staff_id, property_id, started_at, ended_at, signed_off_at, staff!shifts_staff_id_fkey(full_name), shift_breaks(started_at, ended_at)")
    .gte("started_at", from)
    .order("started_at", { ascending: true });

  return (data ?? []).map((s) => ({
    id: String(s.id),
    staffId: String(s.staff_id),
    name: (s.staff as unknown as { full_name: string } | null)?.full_name ?? "Unknown",
    propertyId: (s.property_id as string | null) ?? null,
    startedAt: String(s.started_at),
    endedAt: (s.ended_at as string | null) ?? null,
    signedOffAt: (s.signed_off_at as string | null) ?? null,
    breaks: ((s.shift_breaks ?? []) as { started_at: string; ended_at: string | null }[])
      .map((b) => ({ startedAt: b.started_at, endedAt: b.ended_at })),
  }));
}

export async function GET(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const db = await supabaseServer();
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const off = Number.isFinite(offset) ? offset : 0;
  const start = url.searchParams.get("week") || weekStart(new Date(), off);

  const from = new Date(Date.parse(`${start}T00:00:00Z`) - 864e5).toISOString();
  const [rows, crew, asks] = await Promise.all([
    shiftsSince(db, from),
    db.from("staff").select("id, full_name, role").eq("active", true),
    db.from("shift_edits")
      // shift_edits points at staff twice too (staff_id, decided_by). Unnamed,
      // the select failed and the queue said "run migration 039" -- so no
      // correction the crew asked for ever reached the office.
      .select("id, shift_id, staff_id, kind, asked_start, asked_end, asked_break_minutes, reason, state, created_at, staff!shift_edits_staff_id_fkey(full_name)")
      .eq("state", "asked").order("created_at", { ascending: true }),
  ]);

  // Names from the staff list already read, not from an embed on the shift:
  // the roster is the one source every other line on this screen uses.
  const nameOf = new Map((crew.data ?? []).map((s) => [String(s.id), String(s.full_name ?? "")]));
  const { live, liveError, sites, bySite, pinned } = await liveAndSites(db, rows, start, off, nameOf);

  // Everyone who could be on a clock, not only those who have been. Somebody
  // with no hours this week is a row that says nought, which is an answer --
  // a list built from the shifts that exist cannot say "nobody turned up".
  const people = (crew.data ?? []).filter((s) => isField(s.role));

  return NextResponse.json({
    week: start,
    people: people.map((p) => {
      const theirs = rows.filter((r) => r.staffId === p.id);
      return {
        id: String(p.id),
        name: String(p.full_name ?? "Unknown"),
        onTheClock: theirs.some((s) => !s.endedAt),
        week: week(theirs, start, new Date(), { offsetMinutes: off }),
      };
    }),
    // Absent until 039 is run. An empty queue then, rather than a failure.
    asks: asks.error ? [] : (asks.data ?? []).map((a) => ({
      ...a,
      name: (a.staff as unknown as { full_name: string } | null)?.full_name ?? "Unknown",
    })),
    migrationMissing: !!asks.error,
    live,
    liveError,
    bySite,
    // How many job sites the phone can recognise at all. A fence needs a pin.
    sites: { total: sites.length, pinned },
    // Only the pinned ones: these are drawn, and a site with no pin has nowhere to be.
    sitesList: sites.filter((s) => s.lat !== null && s.lng !== null),
  });
}

/**
 * Who is out right now and where, and the week's hours by job site.
 *
 * The live list reads the open shifts with NO date bound: a shift opened
 * three weeks ago and never closed is exactly the one the office needs to
 * see, and a "since Monday" filter is how it would vanish from view while
 * still being open.
 */
async function liveAndSites(
  db: Db, rows: Shift[], start: string, off: number, nameOf: Map<string, string>,
) {
  const [openRes, siteRes] = await Promise.all([
    db.from("shifts")
      .select("id, staff_id, property_id, started_at, ended_at, start_lat, start_lng, start_acc, start_fence")
      .is("ended_at", null),
    db.from("properties").select("id, name, lat, lng").order("name"),
  ]);
  const open: OpenShift[] = (openRes.data ?? []).map((s) => ({
    id: String(s.id), staffId: String(s.staff_id),
    name: nameOf.get(String(s.staff_id)) || "Somebody no longer on staff",
    propertyId: (s.property_id as string | null) ?? null,
    startedAt: String(s.started_at), endedAt: null,
    startLat: s.start_lat === null ? null : Number(s.start_lat),
    startLng: s.start_lng === null ? null : Number(s.start_lng),
    startAcc: s.start_acc === null ? null : Number(s.start_acc),
    startFence: (s.start_fence as string | null) ?? null,
  }));

  let pings: Ping[] = [];
  if (open.length) {
    const { data } = await db.from("shift_pings")
      .select("shift_id, at, lat, lng, accuracy, fence, metres")
      .in("shift_id", open.map((o) => o.id))
      .order("at", { ascending: false }).limit(500);
    pings = (data ?? []).map((p) => ({
      shiftId: String(p.shift_id), at: String(p.at),
      lat: Number(p.lat), lng: Number(p.lng),
      accuracy: p.accuracy === null ? null : Number(p.accuracy),
      fence: (p.fence as string | null) ?? null,
      metres: p.metres === null ? null : Number(p.metres),
    }));
  }

  const sites = (siteRes.data ?? []).map((p) => ({
    id: String(p.id), name: String(p.name),
    lat: p.lat === null ? null : Number(p.lat), lng: p.lng === null ? null : Number(p.lng),
  }));

  // Only this week's shifts for the by-site total: `rows` reaches a day early
  // so the week's first local morning is not lost to the time zone.
  const end = Date.parse(`${start}T00:00:00Z`) + 7 * 864e5;
  const inWeek = rows.filter((r) => {
    const local = Date.parse(r.startedAt) - off * 60_000;
    return local >= Date.parse(`${start}T00:00:00Z`) && local < end;
  });

  return {
    // A failed read is not "nobody is out". Said as what it is, or the card
    // reads exactly like the truth.
    liveError: openRes.error ? openRes.error.message : null,
    live: whereNow(open, pings, sites, new Date()),
    sites,
    bySite: hoursBySite(inWeek, sites),
    pinned: sites.filter((s) => s.lat !== null && s.lng !== null).length,
  };
}

export async function PATCH(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const db = await supabaseServer();
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "which request?" }, { status: 400 });

  if (body.decision === "approve") {
    // One function, one transaction. See 039 for why this is not two writes.
    const { error } = await db.rpc("approve_shift_edit", { p_edit: id, p_by: me.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.decision === "decline") {
    // A decline with no word on it is the thing somebody rings up about, so
    // the note is required here even though the column allows null -- null is
    // for the requests approved without comment.
    const note = String(body.note ?? "").trim();
    if (note.length < 3) {
      return NextResponse.json({
        error: "Say why you are declining it — they will ask.",
      }, { status: 400 });
    }
    const { error } = await db.from("shift_edits").update({
      state: "declined", decided_by: me.id,
      decided_at: new Date().toISOString(), decided_note: note,
    }).eq("id", id).eq("state", "asked");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "approve or decline" }, { status: 400 });
}

/**
 * The office enters a day's hours for somebody (072) -- the man whose phone
 * was dead, or left in the truck, or who never had the app. As the signed-in
 * office user, so the row policies stay the rule; the database puts their
 * name on it, and the owner is told.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const db = await supabaseServer();
  const body = await req.json().catch(() => ({}));
  const staffId = String(body.staffId ?? "");
  if (!staffId) return NextResponse.json({ error: "Whose hours?" }, { status: 400 });
  const { data: man } = await db.from("staff").select("id, full_name").eq("id", staffId).maybeSingle();
  if (!man) return NextResponse.json({ error: "That person is not on file." }, { status: 400 });

  const tz = "America/New_York";
  const c = checkEntry({
    day: String(body.day ?? ""), from: String(body.from ?? ""), to: String(body.to ?? ""),
    breakMinutes: Number(body.breakMinutes ?? 0),
  }, tz, new Date());
  if (!c.ok) return NextResponse.json({ error: c.why }, { status: 400 });

  // Never two records of the same stretch of somebody's time: whichever
  // landed second would be paid twice.
  const { data: near } = await db.from("shifts").select("id, started_at, ended_at")
    .eq("staff_id", staffId)
    .gte("started_at", new Date(Date.parse(c.startedAt) - 864e5).toISOString())
    .lte("started_at", c.endedAt);
  if ((near ?? []).some((x) => overlaps(c.startedAt, c.endedAt, String(x.started_at), (x.ended_at as string | null) ?? null))) {
    return NextResponse.json({
      error: `${man.full_name ?? "He"} already has hours recorded in that time. Fix that shift instead.`,
    }, { status: 409 });
  }

  const propertyId = String(body.propertyId ?? "") || null;
  const note = String(body.note ?? "").trim().slice(0, 500) || null;
  const { data, error } = await db.from("shifts").insert({
    staff_id: staffId, property_id: propertyId, property_from: propertyId ? "chosen" : null,
    started_at: c.startedAt, ended_at: c.endedAt,
    start_fence: "unsure", end_fence: "unsure",
    start_how: "office", started_by: me.id, end_how: "office", ended_by: me.id,
    note,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (c.breakMinutes) {
    // One break of that length, from the middle of the day: where in the
    // day it fell does not change the hours, and nobody typed where.
    const mid = (Date.parse(c.startedAt) + Date.parse(c.endedAt)) / 2;
    const b0 = new Date(mid - (c.breakMinutes * 60_000) / 2);
    const { error: be } = await db.from("shift_breaks").insert({
      shift_id: data!.id, started_at: b0.toISOString(),
      ended_at: new Date(b0.getTime() + c.breakMinutes * 60_000).toISOString(),
    });
    if (be) {
      // Said plainly rather than undone: the day IS on the record, and a
      // day without its break pays the break, which somebody has to know.
      return NextResponse.json({
        error: `The hours were saved but the ${c.breakMinutes}-minute break was not (${be.message}). `
          + "Ask him to send a correction for the break, or approve one for him.",
      }, { status: 500 });
    }
  }

  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const dayWords = new Date(c.startedAt).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "app.larabeehomesllc.com").split(",")[0].trim();
  const link = `https://${host}/timesheets`;
  await alertOwners(`office:${data!.id}`, onBehalfText({
    how: "office", name: String(man.full_name ?? "Somebody"), by: me.full_name ?? "The office",
    day: dayWords, from: t(c.startedAt), to: t(c.endedAt),
  }, link), link);

  return NextResponse.json({ ok: true, id: data!.id });
}
