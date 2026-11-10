import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadSetup, loadTextSettings } from "@/lib/crew-data";
import { KINDS } from "@/lib/clock-texts";
import { toE164, isValidPhone, canSmsFromLine } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Crews, rates, how each man is paid, and when the texts go.
 *
 * Office and admin only: this is everybody's wage. Writes go through the
 * service role after that check, the way every other write in this app does.
 */

const desk = (role: unknown) => role === "admin" || role === "office";

export async function GET() {
  const me = await requireStaff();
  if (!desk(me?.role)) return NextResponse.json({ error: "not allowed" }, { status: 403 });

  const db = supabaseAdmin();
  const [people, settings, texts] = await Promise.all([
    loadSetup(),
    loadTextSettings(),
    db.from("clock_texts_sent").select("key, kind, staff_id, to_phone, body, sid, error, created_at")
      .order("created_at", { ascending: false }).limit(40),
  ]);
  return NextResponse.json({
    people, settings,
    texts: texts.error ? [] : texts.data ?? [],
    migrationMissing: !!texts.error,
  });
}

const METHODS = new Set(["zelle", "cashapp", "venmo", "cash", "check", "other"]);
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

export async function PATCH(req: Request) {
  const me = await requireStaff();
  if (!desk(me?.role)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const db = supabaseAdmin();
  const body = await req.json().catch(() => ({}));

  /* ----------------------------------------------------------- settings */
  if (body.settings && typeof body.settings === "object") {
    const s = body.settings as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("enabled" in s) patch.enabled = !!s.enabled;
    if ("overtime" in s) patch.overtime = !!s.overtime;
    if ("days" in s) {
      const days = (Array.isArray(s.days) ? s.days : []).map(Number)
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      patch.days = [...new Set(days)].sort();
    }
    if (s.at && typeof s.at === "object") {
      const at: Record<string, string | null> = {};
      for (const k of KINDS) {
        const v = (s.at as Record<string, unknown>)[k];
        if (v === null || v === "") { at[k] = null; continue; }
        if (typeof v !== "string" || !HHMM.test(v)) {
          return NextResponse.json({ error: `"${String(v)}" is not a time of day.` }, { status: 400 });
        }
        at[k] = v.padStart(5, "0");
      }
      patch.at = at;
    }
    const { error } = await db.from("clock_text_settings").upsert({ id: true, ...patch });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  /* -------------------------------------------------------- one person */
  const staffId = String(body.staffId ?? "");
  if (!staffId) return NextResponse.json({ error: "who?" }, { status: 400 });
  const row: Record<string, unknown> = {
    staff_id: staffId, updated_at: new Date().toISOString(), updated_by: me!.id,
  };

  if ("leadId" in body) {
    const lead = String(body.leadId ?? "") || null;
    if (lead === staffId) {
      return NextResponse.json({ error: "Somebody cannot be their own crew lead." }, { status: 400 });
    }
    row.lead_id = lead;
  }
  if ("onClock" in body) row.on_clock = !!body.onClock;
  if ("allReports" in body) row.all_reports = !!body.allReports;
  if ("rate" in body) {
    const raw = String(body.rate ?? "").replace(/[$,\s]/g, "");
    if (!raw) row.rate_cents = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1000) {
        return NextResponse.json({ error: "An hourly rate in dollars, like 18.50." }, { status: 400 });
      }
      row.rate_cents = Math.round(n * 100);
    }
  }
  if ("method" in body) {
    const m = String(body.method ?? "") || null;
    if (m && !METHODS.has(m)) return NextResponse.json({ error: "Pick how they are paid." }, { status: 400 });
    row.pay_method = m;
  }
  if ("lang" in body) row.lang = body.lang === "es" ? "es" : "en";
  if ("handle" in body) row.pay_handle = String(body.handle ?? "").trim() || null;
  if ("phone" in body) {
    const raw = String(body.phone ?? "").trim();
    if (!raw) row.phone = null;
    else {
      const e = toE164(raw);
      if (!isValidPhone(e) || !canSmsFromLine(e)) {
        return NextResponse.json({
          error: "That is not a US or Canadian mobile number the line can text.",
        }, { status: 400 });
      }
      row.phone = e;
    }
  }

  const { error } = await db.from("crew_setup").upsert(row, { onConflict: "staff_id" });
  if (error) {
    const missing = /crew_setup/.test(error.message) && /does not exist|schema cache/i.test(error.message);
    return NextResponse.json({
      error: missing ? "Migration 051 has not been run yet." : error.message,
    }, { status: missing ? 503 : 500 });
  }
  return NextResponse.json({ ok: true });
}
