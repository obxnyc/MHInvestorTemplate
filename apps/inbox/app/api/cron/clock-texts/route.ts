import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSms } from "@/lib/notify";
import { pushToStaff } from "@/lib/push";
import { autoOuts, autoOutText, dueKinds, localOf, plan, type DayShift } from "@/lib/clock-texts";
import { worked } from "@/lib/shift";
import { loadSetup, loadTextSettings, asPerson } from "@/lib/crew-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The clock's texts: reminders to the crew, reports to the crew lead and the
 * office.
 *
 * Woken every five minutes by pg_cron in the database (migration 051), not
 * by vercel.json. Vercel's Hobby crons fire once a day somewhere inside an
 * hour, and "8:45" cannot be said in that language. Most wakes find nothing
 * due and return in a few milliseconds.
 *
 * The scheduler's token is generated inside the database and checked there
 * (`clock_cron_ok`), so nobody ever copies a secret between two dashboards.
 * CRON_SECRET is accepted too, for running it by hand.
 *
 * A TEXT IS CLAIMED BEFORE IT IS SENT. The ledger row goes in first, keyed on
 * kind, person and day; a second wake that overlaps the first loses the
 * insert and sends nothing. The other order -- send, then record -- sends
 * twice whenever two wakes overlap, which on a five-minute timer with a
 * sixty-second ceiling is not hypothetical.
 */

async function authorized(req: Request): Promise<boolean> {
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!given) return false;
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const a = Buffer.from(given), b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  const { data } = await supabaseAdmin().rpc("clock_cron_ok", { p_token: given });
  return data === true;
}

/** The address in the link. The host the scheduler called is the live site;
 *  PUBLIC_BASE_URL is the fallback, not the first choice, because a stale
 *  value there sends every man a link to a host that does not resolve. */
function base(req: Request): string {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0].trim();
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return `https://${host}`;
  return (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

export async function GET(req: Request) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const now = new Date();
  const settings = await loadTextSettings();
  const db = supabaseAdmin();

  // The forgotten shifts first, every wake, whether the texts are on or not:
  // this is a pay record, not a reminder. And first so the 9pm recap sees
  // the shift the clock has just closed rather than one still running.
  const closed = await closeForgotten(db, settings, now);
  if (closed.length && settings.enabled) await tellThem(db, closed, settings, req);

  if (!settings.enabled) return NextResponse.json({ ok: true, off: true, closed: closed.length });

  // The cheap question first: most wakes end here.
  const due = dueKinds(now, settings);
  if (!due.length) return NextResponse.json({ ok: true, due: [], closed: closed.length });

  const { day } = localOf(now, settings.tz);

  const [people, shiftsRes, sentRes] = await Promise.all([
    loadSetup(),
    // A day and a half back covers "today" in any US zone; the plan keeps
    // only the shifts that started on the local day.
    db.from("shifts")
      .select("id, staff_id, property_id, started_at, ended_at, signed_off_at, start_fence, auto_clocked_out, start_metres, start_lat, start_photos, properties(name), shift_breaks(started_at, ended_at)")
      .gte("started_at", new Date(now.getTime() - 36 * 3_600_000).toISOString()),
    db.from("clock_texts_sent").select("key").like("key", `%:${day}`),
  ]);

  const shifts: DayShift[] = (shiftsRes.data ?? [])
    .filter((s) => localOf(new Date(String(s.started_at)), settings.tz).day === day)
    .map((s) => ({
      id: String(s.id),
      staffId: String(s.staff_id),
      propertyId: (s.property_id as string | null) ?? null,
      siteName: (s.properties as unknown as { name: string } | null)?.name ?? null,
      startFence: (s.start_fence as string | null) ?? null,
      autoOut: !!s.auto_clocked_out,
      startMetres: s.start_metres === null ? null : Number(s.start_metres),
      // Known: a clock-in either carried a position or it did not.
      startFix: s.start_lat !== null,
      startPhotos: Array.isArray(s.start_photos) ? s.start_photos.length : 0,
      startedAt: String(s.started_at),
      endedAt: (s.ended_at as string | null) ?? null,
      signedOffAt: (s.signed_off_at as string | null) ?? null,
      breaks: ((s.shift_breaks ?? []) as { started_at: string; ended_at: string | null }[])
        .map((b) => ({ startedAt: b.started_at, endedAt: b.ended_at })),
    }));

  const sent = new Set((sentRes.data ?? []).map((r) => String(r.key)));
  const texts = plan(now, { ...settings, base: base(req) }, people.map(asPerson), shifts, sent);

  const done: { key: string; ok: boolean }[] = [];
  for (const t of texts) {
    // Leave room under the sixty-second ceiling. What is left goes on the
    // next wake, five minutes later, still inside its window.
    if (Date.now() - started > 45_000) break;

    const claim = await db.from("clock_texts_sent").insert({
      key: t.key, kind: t.kind, staff_id: t.staffId, to_phone: t.to, body: t.body,
    });
    if (claim.error) continue; // another wake has it

    const ok = await deliver(db, t.via, t.staffId, t.to, t.body, t.key, base(req));
    done.push({ key: t.key, ok });
  }

  return NextResponse.json({ ok: true, closed: closed.length, due, sent: done.length, failed: done.filter((d) => !d.ok).length,
                             left: texts.length - done.length });
}

type Admin = ReturnType<typeof supabaseAdmin>;
type Closed = { shiftId: string; staffId: string; endedAt: string; hours: number };

/**
 * Close every shift nobody clocked out of, by the rule in `autoOuts`.
 *
 * Each update is guarded on `ended_at is null`, so a man who clocks out in
 * the same second wins and the clock writes nothing over him. Returns what
 * it actually closed, with the hours as they now stand.
 */
async function closeForgotten(db: Admin, settings: Awaited<ReturnType<typeof loadTextSettings>>,
                              now: Date): Promise<Closed[]> {
  if (!settings.autoOut) return [];
  const { data: open, error } = await db.from("shifts")
    .select("id, staff_id, started_at, shift_breaks(id, started_at, ended_at)")
    .is("ended_at", null);
  if (error || !open?.length) return [];

  const ids = open.map((o) => String(o.id));
  const { data: pings } = await db.from("shift_pings")
    .select("shift_id, at").in("shift_id", ids).order("at", { ascending: false }).limit(1000);
  const lastPing = new Map<string, string>();
  for (const p of pings ?? []) if (!lastPing.has(String(p.shift_id))) lastPing.set(String(p.shift_id), String(p.at));

  const breaksOf = new Map(open.map((o) => [String(o.id),
    ((o.shift_breaks ?? []) as { id: string; started_at: string; ended_at: string | null }[])]));

  const plan = autoOuts(open.map((o) => ({
    id: String(o.id), staffId: String(o.staff_id), startedAt: String(o.started_at),
    breaks: breaksOf.get(String(o.id))!.map((b) => ({ startedAt: b.started_at, endedAt: b.ended_at })),
    lastPing: lastPing.get(String(o.id)) ?? null,
  })), now, settings);

  const done: Closed[] = [];
  for (const a of plan) {
    const { data: hit, error: e } = await db.from("shifts").update({
      ended_at: a.endedAt, end_fence: "unsure",
      auto_clocked_out: true, settled_at: now.toISOString(),
    }).eq("id", a.shiftId).is("ended_at", null).select("id, started_at");
    if (e || !hit?.length) continue; // he clocked out himself, or 052 is not run

    const breaks = breaksOf.get(a.shiftId) ?? [];
    if (a.closeBreak) {
      await db.from("shift_breaks").update({ ended_at: a.endedAt })
        .eq("shift_id", a.shiftId).is("ended_at", null);
    }
    const w = worked([{
      id: a.shiftId, staffId: a.staffId, propertyId: null,
      startedAt: String(hit[0].started_at), endedAt: a.endedAt,
      breaks: breaks.map((b) => ({ startedAt: b.started_at,
        endedAt: b.ended_at ?? (a.closeBreak ? a.endedAt : null) })),
    }], now);
    done.push({ ...a, hours: w.hours });
  }
  return done;
}

/** Text each man whose shift the clock closed. Claimed in the ledger first,
 *  like every other text, keyed on the shift so it goes once. */
async function tellThem(db: Admin, closed: Closed[],
                        settings: Awaited<ReturnType<typeof loadTextSettings>>, req: Request) {
  const people = new Map((await loadSetup()).map((p) => [p.id, asPerson(p)]));
  for (const c of closed) {
    const p = people.get(c.staffId);
    const via = p?.phone ? "sms" : p?.push ? "push" : null;
    if (!p || !via) continue;
    // A shift closed weeks after it ended -- the first run after this ships,
    // or the clock having been switched off -- is flagged on Friday pay and
    // in the recap, not texted: "the clock closed your shift (10:00 today)"
    // about a day three weeks ago is a text nobody can act on.
    if (Date.now() - Date.parse(c.endedAt) > 24 * 3_600_000) continue;
    const key = `crew_autoout:${c.staffId}:${c.shiftId}`;
    const body = autoOutText(p, c.endedAt, c.hours, { tz: settings.tz, base: base(req) });
    const claim = await db.from("clock_texts_sent").insert({
      key, kind: "crew_autoout", staff_id: c.staffId, to_phone: p.phone ?? "app", body,
    });
    if (claim.error) continue;
    await deliver(db, via, c.staffId, p.phone ?? "app", body, key, base(req));
  }
}

/**
 * Send one, and write down what actually happened.
 *
 * A text records Twilio's sid. An app notification records "push:<n>" -- how
 * many of the person's devices took it -- and a push nobody's device took is
 * recorded as a failure, not as sent. A ledger that says "sent" for a
 * notification that went nowhere is the screen saying success for silence.
 */
async function deliver(db: Admin, via: "sms" | "push", staffId: string, to: string,
                       body: string, key: string, site: string): Promise<boolean> {
  if (via === "push") {
    const took = await pushToStaff([staffId], {
      title: "Larabee crew clock", body, url: `${site}/timesheets`, tag: key,
    }).catch(() => 0);
    await db.from("clock_texts_sent")
      .update(took ? { sid: `push:${took}` }
                   : { error: "No device took the notification (none on, or turned off)" })
      .eq("key", key);
    return took > 0;
  }
  const sid = await sendSms(to, body);
  await db.from("clock_texts_sent")
    .update(sid ? { sid } : { error: "Twilio did not accept it -- see the function log" })
    .eq("key", key);
  return !!sid;
}
