import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSms } from "@/lib/notify";
import { dueKinds, localOf, plan, type DayShift } from "@/lib/clock-texts";
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
  if (!settings.enabled) return NextResponse.json({ ok: true, off: true });

  // The cheap question first: most wakes end here.
  const due = dueKinds(now, settings);
  if (!due.length) return NextResponse.json({ ok: true, due: [] });

  const db = supabaseAdmin();
  const { day } = localOf(now, settings.tz);

  const [people, shiftsRes, sentRes] = await Promise.all([
    loadSetup(),
    // A day and a half back covers "today" in any US zone; the plan keeps
    // only the shifts that started on the local day.
    db.from("shifts")
      .select("id, staff_id, property_id, started_at, ended_at, signed_off_at, start_fence, properties(name), shift_breaks(started_at, ended_at)")
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

    const sid = await sendSms(t.to, t.body);
    await db.from("clock_texts_sent")
      .update(sid ? { sid } : { error: "Twilio did not accept it -- see the function log" })
      .eq("key", t.key);
    done.push({ key: t.key, ok: !!sid });
  }

  return NextResponse.json({ ok: true, due, sent: done.length, failed: done.filter((d) => !d.ok).length,
                             left: texts.length - done.length });
}
