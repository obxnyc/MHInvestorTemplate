import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { readFix, whichSite, defaultRadius, type Fence, type Fix } from "@/lib/fence";
import { worked, nudges, week, weekStart, type Shift, type Rules, RULES } from "@/lib/shift";
import { check, type Place } from "@/lib/clockin";
import { checkPhotos } from "@/lib/clock-photos";
import { alertText, onBehalfText } from "@/lib/integrity";
import { alertOwners } from "@/lib/alert-owner";
import { deviceOf, phoneFacts, DEVICE_COOKIE } from "@/lib/phones";

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
async function places(db: Db): Promise<Place[]> {
  // Where each job is, as well as what it is called, so the phone can say
  // which one you are standing at and ask "are you sure?" about the others.
  const { data } = await db.from("properties")
    .select("id, name, address, kind, lat, lng, fence_m").order("name");
  return (data ?? []).map((p) => ({
    id: String(p.id), name: String(p.name),
    address: (p.address as string | null) ?? null,
    lat: p.lat === null ? null : Number(p.lat),
    lng: p.lng === null ? null : Number(p.lng),
    radius: p.fence_m ? Number(p.fence_m) : defaultRadius(p.kind as string | null),
  }));
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
  // so last week is readable on a Friday morning when this week is empty.
  const from = new Date(now.getTime() - 21 * 864e5).toISOString();

  const [shifts, rules, where, asks, auto, crew] = await Promise.all([
    since(db, staffId, from), rulesOf(db), places(db), pending(db, staffId),
    autoOf(db), crewOf(db),
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
  // How the open shift was started: the phone only ever ends one it began.
  const openHow = open
    ? ((await db.from("shifts").select("start_how").eq("id", open.id).maybeSingle())
        .data?.start_how as string | undefined) ?? "self"
    : null;

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
    openHow,
    auto,
    crew,
  };
}

/**
 * Whether this man's phone clocks him in by itself (072), and the working
 * week it does it in. Asked of the database through two narrow functions,
 * because crew cannot read crew_setup or the text settings directly.
 * Absent (072 not run): off.
 */
async function autoOf(db: Db) {
  const [{ data: on, error }, { data: win }] = await Promise.all([
    db.rpc("my_auto_clock"), db.rpc("clock_window"),
  ]);
  if (error || on !== true) return { on: false as const, window: null };
  const w = (win ?? {}) as { tz?: string; days?: number[]; optional_days?: number[]; auto_out?: string | null };
  return {
    on: true as const,
    window: {
      tz: w.tz ?? "America/New_York",
      // A sometimes-day is a work day for this: arriving at a job on a
      // Saturday Jose's crew is working IS work.
      days: [...new Set([...(w.days ?? [1, 2, 3, 4, 5, 6]), ...(w.optional_days ?? [])])],
      from: "05:00",
      until: w.auto_out ?? "18:00",
    },
  };
}

/** The men this person can clock in for: a lead's crew; for the office,
 *  everybody on the clock. Empty for everybody else, and before 072. */
async function crewOf(db: Db) {
  const { data, error } = await db.rpc("my_crew");
  if (error || !Array.isArray(data)) return [];
  return (data as { staff_id: string; full_name: string | null; open_shift: string | null; open_since: string | null }[])
    .map((r) => ({
      id: String(r.staff_id), name: String(r.full_name ?? "Unknown"),
      openShiftId: r.open_shift, openSince: r.open_since,
    }));
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

/* Whose phone: see lib/phones.ts, which alone touches the register. */
const clockTimeEastern = (d: Date) =>
  d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

/** Where the owner goes to look: the man's trail for today, on this host. */
function trailLink(req: Request, staffId: string): string {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "app.larabeehomesllc.com")
    .split(",")[0].trim();
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return `https://${host}/trail?staff=${staffId}&day=${day}`;
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

    /* The job, if the man chose one on the way in -- which the screen now
       asks for BEFORE the clock starts, with the nearest suggested. What he
       chose is what is filed; how far he was from it is recorded beside it,
       and a clock-in from far away goes in as OFF SITE so his lead's report
       says so. The fix is recorded, never enforced: refusing a clock-in
       leaves somebody who worked a day with no record of it, which is the
       worse failure by a long way. */
    /* NO POSITION, THEN PHOTOS. A clock-in the phone cannot place needs a
       selfie (who) and a photo of the job (where), both taken in the app in
       the last fifteen minutes on this man's own account -- see
       lib/clock-photos.ts. Never a refusal of the hours: the camera always
       works, so this is a step to take, not a door that can stay shut. */
    /* HIS PHONE DID IT (072). Only with a position -- arriving at a site IS
       a position -- and at the moment he arrived, which the phone says and
       the database bounds to 35 minutes back. Whether he is ticked for it is
       the database's question too, not this route's. */
    const auto = body.auto === true;
    const at = auto ? new Date(String(body.at ?? "")) : null;
    if (auto && (!fix || !at || Number.isNaN(at.getTime()))) {
      return NextResponse.json({ error: "An automatic clock-in needs where and when." }, { status: 400 });
    }
    let photos: string[] | null = null;
    if (!fix) {
      const ok = checkPhotos(body.photos, me.id, Date.now());
      if (!ok.ok) return NextResponse.json({ error: ok.why, needPhotos: true }, { status: 400 });
      photos = [ok.face, ok.site];
    }

    const chosenId = String(body.propertyId ?? "") || null;
    const chosen = chosenId ? (await places(db)).find((p) => p.id === chosenId) ?? null : null;
    if (chosenId && !chosen) {
      return NextResponse.json({ error: "That job is not on file. Pick it again." }, { status: 400 });
    }
    const verdict = chosen ? check(fix, chosen) : null;
    const startFence = verdict
      ? (verdict.kind === "far" ? "outside"
         : verdict.kind === "ok" && on?.fence.propertyId === chosen!.id ? reading!.verdict
         : "unsure")
      : reading?.verdict
        ?? (fix && sites.length ? whichSite(fix, sites).maybe[0]?.reading.verdict : null)
        ?? "unsure";

    const { data, error } = await db.from("shifts").insert({
      staff_id: me.id,
      property_id: chosen?.id ?? on?.fence.propertyId ?? null,
      // "fence" only when the phone itself put him there; a choice that
      // happens to agree with the fence is still the phone's evidence.
      property_from: chosen
        ? (on?.fence.propertyId === chosen.id ? "fence" : "chosen")
        : on ? "fence" : null,
      start_lat: fix?.lat ?? null,
      start_lng: fix?.lng ?? null,
      start_acc: fix?.accuracy ?? null,
      start_fence: startFence,
      start_metres: verdict && "metres" in verdict ? Math.round(verdict.metres) : null,
      start_photos: photos,
      ...(auto ? { start_how: "auto", started_at: at!.toISOString() } : {}),
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

    /* WHOSE PHONE, and tell the owner when something looks wrong. After the
       insert, never before: the hours are on record whatever this finds. */
    const device = deviceOf(req);
    const facts = await phoneFacts(device.id, me.id, req.headers.get("user-agent") ?? "");
    // As the signed-in man, like every other write to his shift here.
    await db.from("shifts").update({ start_device: device.id }).eq("id", data!.id);
    const chosenName = chosen?.name
      ?? (on ? on.fence.name : null);
    const say = alertText({
      name: me.full_name ?? "Somebody", site: chosenName,
      farMetres: verdict?.kind === "far" ? verdict.metres : null,
      noFix: !fix, photos: photos?.length ?? 0,
      phoneUsedBy: facts.usedBy, newPhone: facts.newPhone,
    }, clockTimeEastern(new Date()), trailLink(req, me.id));
    if (say) await alertOwners(`in:${data!.id}`, say, trailLink(req, me.id));
    else if (auto) {
      // Nothing wrong with it, and the owner asked to know each one.
      await alertOwners(`in:${data!.id}`, onBehalfText({
        how: "auto", name: me.full_name ?? "Somebody", site: chosenName ?? "a job",
        at: clockTimeEastern(at!),
      }, trailLink(req, me.id)), trailLink(req, me.id));
    }

    const res = NextResponse.json({ ok: true, shiftId: data!.id, ...await state(db, me.id, offset) });
    if (device.fresh) {
      // The phone's id. httpOnly: the page never reads it and nothing in the
      // browser can change it; it only ever comes back to this server.
      res.cookies.set(DEVICE_COOKIE, device.id, {
        httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 400,
      });
    }
    return res;
  }

  if (action === "out") {
    const { data: open } = await db.from("shifts")
      .select("id, property_id").eq("staff_id", me.id).is("ended_at", null).maybeSingle();
    if (!open) {
      return NextResponse.json({ error: "You are not clocked in." }, { status: 409 });
    }
    // His phone closing a shift it opened, at the time he left (072). The
    // database refuses it for any shift the phone did not start.
    const auto = body.auto === true;
    const at = auto ? new Date(String(body.at ?? "")) : new Date();
    if (Number.isNaN(at.getTime())) {
      return NextResponse.json({ error: "An automatic clock-out needs when." }, { status: 400 });
    }

    // End any break still running first, or the shift closes around an open
    // break and the hours come out longer than the man was there.
    await db.from("shift_breaks").update({ ended_at: at.toISOString() })
      .eq("shift_id", open.id).is("ended_at", null);

    const sites = await fences(db);
    const here = open.property_id
      ? sites.find((f) => f.propertyId === open.property_id) ?? null
      : null;

    const { error } = await db.from("shifts").update({
      ended_at: at.toISOString(),
      ...(auto ? { end_how: "auto" } : {}),
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

  if (action === "for-in" || action === "for-out") {
    /* CLOCKING ANOTHER MAN IN OR OUT (072): his crew lead, or the office,
       for a man who does not use his phone. As the signed-in presser, so the
       row policies decide who may: a lead only for his own crew. The time is
       always NOW -- the database sets it -- and the presser's name and
       position go on the shift, and to the owner, because the lead is the
       one person who gains from his men showing more hours. */
    const who = String(body.staffId ?? "");
    const man = (await crewOf(db)).find((c) => c.id === who);
    if (!man) return NextResponse.json({ error: "That person is not on your crew." }, { status: 403 });
    const now = new Date();

    if (action === "for-in") {
      const chosenId = String(body.propertyId ?? "") || null;
      const chosen = chosenId ? (await places(db)).find((p) => p.id === chosenId) ?? null : null;
      if (chosenId && !chosen) {
        return NextResponse.json({ error: "That job is not on file. Pick it again." }, { status: 400 });
      }
      const verdict = chosen ? check(fix, chosen) : null;
      const { data, error } = await db.from("shifts").insert({
        staff_id: who,
        property_id: chosen?.id ?? null,
        property_from: chosen ? "chosen" : null,
        // Where the PRESSER's phone was. Evidence of where the lead was
        // standing, which is the thing the owner wants to check.
        start_lat: fix?.lat ?? null, start_lng: fix?.lng ?? null, start_acc: fix?.accuracy ?? null,
        start_fence: verdict ? (verdict.kind === "far" ? "outside" : "unsure") : "unsure",
        start_metres: verdict && "metres" in verdict ? Math.round(verdict.metres) : null,
        start_how: "lead",
        started_by: me.id,
      }).select("id").single();
      if (error) {
        const already = /shifts_one_open_per_person/.test(error.message);
        return NextResponse.json({
          error: already ? `${man.name} is already clocked in.` : error.message,
        }, { status: already ? 409 : 500 });
      }
      await alertOwners(`for-in:${data!.id}`, onBehalfText({
        how: "lead", name: man.name, by: me.full_name ?? "Somebody", site: chosen?.name ?? null,
        at: clockTimeEastern(now),
        byMetres: verdict && "metres" in verdict ? verdict.metres : null, byNoFix: !fix,
      }, trailLink(req, who)), trailLink(req, who));
      return NextResponse.json({ ok: true, ...await state(db, me.id, offset) });
    }

    const { data: open } = await db.from("shifts")
      .select("id, property_id").eq("staff_id", who).is("ended_at", null).maybeSingle();
    if (!open) return NextResponse.json({ error: `${man.name} is not clocked in.` }, { status: 409 });
    await db.from("shift_breaks").update({ ended_at: now.toISOString() })
      .eq("shift_id", open.id).is("ended_at", null);
    const site = open.property_id
      ? (await places(db)).find((p) => p.id === open.property_id) ?? null : null;
    const verdict = site ? check(fix, site) : null;
    const { error } = await db.from("shifts").update({
      ended_at: now.toISOString(),
      end_lat: fix?.lat ?? null, end_lng: fix?.lng ?? null, end_acc: fix?.accuracy ?? null,
      end_fence: verdict ? (verdict.kind === "far" ? "outside" : "unsure") : "unsure",
      end_how: "lead", ended_by: me.id,
    }).eq("id", open.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await alertOwners(`for-out:${open.id}`, onBehalfText({
      how: "lead", name: man.name, by: me.full_name ?? "Somebody", site: site?.name ?? null,
      at: clockTimeEastern(now), out: true,
      byMetres: verdict && "metres" in verdict ? verdict.metres : null, byNoFix: !fix,
    }, trailLink(req, who)), trailLink(req, who));
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
