import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { readFix, whichSite, defaultRadius, type Fence, type Fix } from "@/lib/fence";
import { worked, nudges, week, weekStart, type Shift, type Rules, RULES } from "@/lib/shift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * On, off, break, and what the day looks like.
 *
 * Everything here goes through the signed-in client rather than the service
 * role. The row policies in 038 say a ping belongs to an open shift that is
 * this person's own, and a route using the service key would walk past them --
 * which would make the policy a comment rather than a rule.
 */

type Db = Awaited<ReturnType<typeof supabaseServer>>;

const asFix = (v: unknown): Fix | null => {
  const f = v as { lat?: unknown; lng?: unknown; accuracy?: unknown } | null;
  if (!f || typeof f.lat !== "number" || typeof f.lng !== "number") return null;
  return {
    lat: f.lat, lng: f.lng,
    // Not `?? 0`. A device that did not say how sure it is has not said it is
    // certain, and the fence reader needs to be able to tell those apart.
    accuracy: typeof f.accuracy === "number" ? f.accuracy : null,
  };
};

async function fences(db: Db): Promise<Fence[]> {
  const { data } = await db.from("properties")
    .select("id, name, kind, lat, lng, fence_m")
    .not("lat", "is", null).not("lng", "is", null);
  return (data ?? []).map((p) => ({
    propertyId: String(p.id),
    name: String(p.name),
    lat: Number(p.lat), lng: Number(p.lng),
    radius: p.fence_m ? Number(p.fence_m) : defaultRadius(p.kind as string | null),
  }));
}

/**
 * Every property, for "which job are you on?".
 *
 * NOT the fences. The picker was built from the fence list and a property
 * with no pin on the map therefore was not in it -- so the first crew member
 * to open the screen got an empty dropdown and no way to say where he was.
 *
 * Two different questions. The fence answers "can the phone tell me where
 * this man is", and most properties cannot answer it, because nobody has
 * dropped a pin on them. "Which job are you on" is about every property we
 * have, and the whole point of asking is that the phone could not tell.
 */
async function places(db: Db) {
  const { data } = await db.from("properties").select("id, name").order("name");
  return (data ?? []).map((p) => ({ id: String(p.id), name: String(p.name) }));
}

async function rulesOf(db: Db): Promise<Rules> {
  const { data } = await db.from("clock_rules").select("*").maybeSingle();
  if (!data) return RULES;
  return {
    dailyCap: Number(data.daily_cap ?? RULES.dailyCap),
    breakAfter: Number(data.break_after ?? RULES.breakAfter),
    breakMinutes: Number(data.break_minutes ?? RULES.breakMinutes),
    abandonedAfter: Number(data.abandoned_after ?? RULES.abandonedAfter),
  };
}

/** This person's shifts since `from`, breaks attached. */
async function since(db: Db, staffId: string, from: string): Promise<Shift[]> {
  const { data } = await db.from("shifts")
    // One string literal. The client infers the row type from the select
    // text, and a joined string turns every field on the result into an
    // error rather than a column.
    .select("id, staff_id, property_id, property_from, started_at, ended_at, signed_off_at, start_fence, end_fence, shift_breaks(started_at, ended_at)")
    .eq("staff_id", staffId).gte("started_at", from)
    .order("started_at", { ascending: true });

  return (data ?? []).map((s) => ({
    id: String(s.id),
    staffId: String(s.staff_id),
    propertyId: (s.property_id as string | null) ?? null,
    startedAt: String(s.started_at),
    endedAt: (s.ended_at as string | null) ?? null,
    signedOffAt: (s.signed_off_at as string | null) ?? null,
    breaks: ((s.shift_breaks ?? []) as { started_at: string; ended_at: string | null }[])
      .map((b) => ({ startedAt: b.started_at, endedAt: b.ended_at })),
  }));
}

/**
 * Everything the screen shows.
 *
 * `offset` is what the HANDSET said its timezone offset is, because the
 * person reading this is the person whose Tuesday it is. A server in UTC
 * files a shift that started at eight on Monday evening under Tuesday, and
 * produces a timesheet nobody recognises.
 */
async function state(db: Db, staffId: string, offset = 0) {
  const now = new Date();
  // Back far enough to hold the week being reviewed AND the one before it,
  // so last week is readable on a Monday morning when this week is empty.
  const from = new Date(now.getTime() - 21 * 864e5).toISOString();

  const [shifts, rules, where, asks] = await Promise.all([
    since(db, staffId, from), rulesOf(db), places(db), pending(db, staffId),
  ]);

  // Today in the handset's own terms, not the server's.
  const localNow = new Date(now.getTime() - offset * 60_000);
  const todayKey = localNow.toISOString().slice(0, 10);
  const todays = shifts.filter((s) =>
    new Date(new Date(s.startedAt).getTime() - offset * 60_000)
      .toISOString().slice(0, 10) === todayKey);

  const w = worked(todays, now, rules);
  const open = shifts.find((s) => !s.endedAt) ?? null;
  const onBreak = open?.breaks?.some((b) => !b.endedAt) ?? false;
  const thisWeek = weekStart(now, offset);

  return {
    shifts: todays,
    rules,
    worked: w,
    onBreak,
    openShiftId: open?.id ?? null,
    nudges: nudges(w, todays, now, rules),
    places: where,
    week: week(shifts, thisWeek, now, { offsetMinutes: offset, rules }),
    lastWeek: week(shifts, lastWeekOf(thisWeek), now, { offsetMinutes: offset, rules }),
    asks,
  };
}

const lastWeekOf = (start: string) => {
  const ms = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1,
                      Number(start.slice(8, 10))) - 7 * 864e5;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    + `-${String(d.getUTCDate()).padStart(2, "0")}`;
};

/** Requests this person has asked about and nobody has decided yet.
 *
 *  Tolerant of 039 being absent: without it the screen simply has no
 *  requests on it rather than failing to load at all. */
async function pending(db: Db, staffId: string) {
  const { data, error } = await db.from("shift_edits")
    .select("id, shift_id, kind, asked_start, asked_end, asked_break_minutes, reason, state, created_at")
    .eq("staff_id", staffId).order("created_at", { ascending: false }).limit(30);
  if (error) return [];
  return data ?? [];
}

export async function GET(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const db = await supabaseServer();
  const offset = Number(new URL(req.url).searchParams.get("offset") ?? 0);
  return NextResponse.json(
    await state(db, me.id, Number.isFinite(offset) ? offset : 0));
}

export async function POST(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const db = await supabaseServer();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const fix = asFix(body.fix);
  // The handset's own offset, so every total it gets back is in its own day.
  const offset = Number.isFinite(Number(body.offset)) ? Number(body.offset) : 0;

  if (action === "in") {
    const sites = await fences(db);
    const { on } = whichSite(fix, sites);
    const reading = on ? on.reading : null;

    // The fix is recorded, never enforced. Off site goes in as off site --
    // refusing it would leave somebody who worked a day with no record of it,
    // which is the worse failure by a long way.
    const { data, error } = await db.from("shifts").insert({
      staff_id: me.id,
      property_id: on?.fence.propertyId ?? null,
      property_from: on ? "fence" : null,
      start_lat: fix?.lat ?? null,
      start_lng: fix?.lng ?? null,
      start_acc: fix?.accuracy ?? null,
      start_fence: reading?.verdict
        ?? (fix && sites.length ? whichSite(fix, sites).maybe[0]?.reading.verdict : null)
        ?? "unsure",
    }).select("id").single();

    if (error) {
      // The one-open-shift index. Somebody double-tapped, or a second phone
      // is on. Saying which it is beats "could not save".
      const already = /shifts_one_open_per_person/.test(error.message);
      return NextResponse.json({
        error: already
          ? "You are already clocked in. Pull down to refresh."
          : error.message,
      }, { status: already ? 409 : 500 });
    }

    return NextResponse.json({ ok: true, shiftId: data!.id, ...await state(db, me.id, offset) });
  }

  if (action === "out") {
    const { data: open } = await db.from("shifts")
      .select("id, property_id").eq("staff_id", me.id).is("ended_at", null).maybeSingle();
    if (!open) {
      return NextResponse.json({ error: "You are not clocked in." }, { status: 409 });
    }

    // End any break still running first, or the shift closes around an open
    // break and the hours come out longer than the man was there.
    await db.from("shift_breaks").update({ ended_at: new Date().toISOString() })
      .eq("shift_id", open.id).is("ended_at", null);

    const sites = await fences(db);
    const here = open.property_id
      ? sites.find((f) => f.propertyId === open.property_id) ?? null
      : null;

    const { error } = await db.from("shifts").update({
      ended_at: new Date().toISOString(),
      end_lat: fix?.lat ?? null,
      end_lng: fix?.lng ?? null,
      end_acc: fix?.accuracy ?? null,
      end_fence: here ? readFix(fix, here).verdict : "unsure",
    }).eq("id", open.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, ...await state(db, me.id, offset) });
  }

  if (action === "break-start" || action === "break-end") {
    const { data: open } = await db.from("shifts")
      .select("id").eq("staff_id", me.id).is("ended_at", null).maybeSingle();
    if (!open) {
      return NextResponse.json({ error: "You are not clocked in." }, { status: 409 });
    }
    const { error } = action === "break-start"
      ? await db.from("shift_breaks").insert({ shift_id: open.id }).select("id").single()
      : await db.from("shift_breaks").update({ ended_at: new Date().toISOString() })
          .eq("shift_id", open.id).is("ended_at", null);
    if (error) {
      const twice = /breaks_one_open_per_shift/.test(error.message);
      return NextResponse.json({
        error: twice ? "You are already on a break." : error.message,
      }, { status: twice ? 409 : 500 });
    }
    return NextResponse.json({ ok: true, ...await state(db, me.id, offset) });
  }

  if (action === "sign-off") {
    // Only the finished ones, and only this person's. Nothing still running
    // can be agreed, because the number is still moving.
    const { error } = await db.from("shifts")
      .update({ signed_off_at: new Date().toISOString() })
      .eq("staff_id", me.id).not("ended_at", "is", null).is("signed_off_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, ...await state(db, me.id, offset) });
  }

  if (action === "where") {
    // The site, chosen by hand, when the fence could not tell or said two.
    const { data: open } = await db.from("shifts")
      .select("id").eq("staff_id", me.id).is("ended_at", null).maybeSingle();
    if (!open) return NextResponse.json({ error: "You are not clocked in." }, { status: 409 });
    const propertyId = String(body.propertyId ?? "") || null;
    const { error } = await db.from("shifts")
      .update({ property_id: propertyId, property_from: propertyId ? "chosen" : null })
      .eq("id", open.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, ...await state(db, me.id, offset) });
  }

  if (action === "ask") {
    // A REQUEST IS NOT A CHANGE. Nothing here touches `shifts`. The hours on
    // the record stay as the clock recorded them until somebody with the
    // authority to agree says otherwise -- letting a person edit their own
    // hours and calling it a request is not a request, it is a timesheet
    // anybody can write.
    const KINDS = new Set(["never_clocked_in", "missed_clock_in", "missed_clock_out",
                           "missed_break", "wrong_times", "other"]);
    const kind = String(body.kind ?? "");
    if (!KINDS.has(kind)) {
      return NextResponse.json({ error: "Say what went wrong." }, { status: 400 });
    }
    const reason = String(body.reason ?? "").trim();
    if (reason.length < 3) {
      return NextResponse.json({
        error: "Say why in a few words — whoever reads this will not remember the day.",
      }, { status: 400 });
    }

    const when = (v: unknown) => {
      const t = String(v ?? "").trim();
      if (!t) return null;
      const d = new Date(t);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };
    const mins = Number(body.breakMinutes);

    const row = {
      staff_id: me.id,
      shift_id: String(body.shiftId ?? "") || null,
      kind,
      asked_start: when(body.start),
      asked_end: when(body.end),
      asked_break_minutes: Number.isFinite(mins) && mins > 0 ? Math.round(mins) : null,
      reason,
      state: "asked",
    };
    if (kind !== "other" && !row.asked_start && !row.asked_end
        && row.asked_break_minutes === null) {
      return NextResponse.json({ error: "Say what the hours should be." }, { status: 400 });
    }

    const { error } = await db.from("shift_edits").insert(row);
    if (error) {
      // Two people arguing with the same stretch of time produces two
      // approvals and whichever lands second wins, silently.
      const twice = /shift_edits_one_open_per_shift/.test(error.message);
      const missing = /relation .*shift_edits.* does not exist/i.test(error.message);
      return NextResponse.json({
        error: twice ? "There is already a question open about that shift."
             : missing ? "Migration 039 has not been run, so questions about hours"
                       + " cannot be saved yet."
             : error.message,
      }, { status: twice ? 409 : 500 });
    }
    return NextResponse.json({ ok: true, ...await state(db, me.id, offset) });
  }

  return NextResponse.json({ error: `not an action: ${action}` }, { status: 400 });
}
