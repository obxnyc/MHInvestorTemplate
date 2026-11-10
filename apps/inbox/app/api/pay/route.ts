import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadSetup, loadTextSettings } from "@/lib/crew-data";
import { payWeek } from "@/lib/pay";
import { weekStart, type Shift } from "@/lib/shift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Friday's pay: what each man is owed for a week, by crew, and who has been
 * paid.
 *
 * The week defaults to LAST week -- Friday to Thursday, finished -- because a
 * week still being worked is not one anybody can be paid for.
 *
 * Marking paid records the amount as it was when it was paid. If a
 * correction later moves the hours, the screen shows the difference rather
 * than quietly rewriting what was sent.
 */

const desk = (role: unknown) => role === "admin" || role === "office";

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function build(week: string, offset: number) {
  const db = supabaseAdmin();
  const from = new Date(Date.parse(`${week}T00:00:00Z`) + offset * 60_000).toISOString();
  const to = new Date(Date.parse(`${addDays(week, 7)}T00:00:00Z`) + offset * 60_000).toISOString();

  const [people, settings, shiftsRes, paidRes] = await Promise.all([
    loadSetup(),
    loadTextSettings(),
    db.from("shifts")
      .select("id, staff_id, property_id, started_at, ended_at, signed_off_at, auto_clocked_out, shift_breaks(started_at, ended_at)")
      .gte("started_at", from).lt("started_at", to),
    db.from("pay_runs").select("*").eq("week_start", week),
  ]);

  const shifts: (Shift & { autoOut: boolean })[] = (shiftsRes.data ?? []).map((s) => ({
    autoOut: !!s.auto_clocked_out,
    id: String(s.id), staffId: String(s.staff_id),
    propertyId: (s.property_id as string | null) ?? null,
    startedAt: String(s.started_at), endedAt: (s.ended_at as string | null) ?? null,
    signedOffAt: (s.signed_off_at as string | null) ?? null,
    breaks: ((s.shift_breaks ?? []) as { started_at: string; ended_at: string | null }[])
      .map((b) => ({ startedAt: b.started_at, endedAt: b.ended_at })),
  }));

  // Everybody who worked, and everybody on the clock programme even if they
  // did not -- "nobody paid" has to be distinguishable from "nobody listed".
  const worked = new Set(shifts.map((s) => s.staffId));
  const payees = people.filter((p) => p.onClock || worked.has(p.id));
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));

  const week_ = payWeek(payees, shifts, names, {
    overtime: settings.overtime,
    note: `Wages week of ${week}`,
  });
  const paid = Object.fromEntries((paidRes.error ? [] : paidRes.data ?? [])
    .map((r) => [String(r.staff_id), {
      amountCents: Number(r.amount_cents), paidAt: String(r.paid_at),
      method: r.method as string | null,
    }]));

  return { week, overtime: settings.overtime, ...week_, paid, migrationMissing: !!paidRes.error };
}

export async function GET(req: Request) {
  const me = await requireStaff();
  if (!desk(me?.role)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
  const week = url.searchParams.get("week") || addDays(weekStart(new Date(), offset), -7);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return NextResponse.json({ error: "bad week" }, { status: 400 });
  return NextResponse.json(await build(week, offset));
}

/** Mark people paid. Takes a list so "pay everyone shown" is one press. */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (!desk(me?.role)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const week = String(body.week ?? "");
  const ids: string[] = Array.isArray(body.staffIds) ? body.staffIds.map(String) : [];
  const offset = Number(body.offset ?? 0) || 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !ids.length) {
    return NextResponse.json({ error: "which week, and who?" }, { status: 400 });
  }

  // The amount is worked out HERE, from the record, never taken from the
  // browser. A number the page sent is a number anybody could have typed.
  const now = await build(week, offset);
  const rows = now.lines
    .filter((l) => ids.includes(l.staffId))
    .filter((l) => l.amountCents !== null && l.amountCents > 0 && !now.paid[l.staffId])
    .map((l) => ({
      week_start: week, staff_id: l.staffId, hours: l.hours, overtime: l.overtime,
      rate_cents: l.rateCents, amount_cents: l.amountCents, method: l.method, handle: l.handle,
      paid_by: me!.id,
    }));
  if (!rows.length) {
    return NextResponse.json({ error: "Nobody in that list is owed anything that is not already paid." },
                             { status: 400 });
  }
  const { error } = await supabaseAdmin().from("pay_runs")
    .upsert(rows, { onConflict: "week_start,staff_id", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, marked: rows.length, ...(await build(week, offset)) });
}
