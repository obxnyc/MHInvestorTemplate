import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Replace the showing hours, and the rules beside them. */
export async function PUT(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const hours = Array.isArray(body.hours) ? body.hours : [];
  for (const h of hours) {
    if (!(h.weekday >= 0 && h.weekday <= 6) || !TIME.test(h.starts) || !TIME.test(h.ends)
        || h.ends <= h.starts) {
      return NextResponse.json({ error: "Each row needs a day and a start before its end." },
                               { status: 400 });
    }
  }
  const db = supabaseAdmin();
  // Delete-then-insert of a settings list nobody else writes; the rows are
  // the whole of the setting, not records anybody typed about a person.
  const { error: e1 } = await db.from("showing_hours").delete().gte("weekday", 0);
  if (e1) return NextResponse.json({ error: "Run migration 051 first." }, { status: 500 });
  if (hours.length) {
    const { error } = await db.from("showing_hours").insert(
      hours.map((h: { weekday: number; starts: string; ends: string }) =>
        ({ weekday: h.weekday, starts: h.starts, ends: h.ends })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (body.rules) {
    const r = body.rules;
    const { error } = await db.from("showing_rules").update({
      slot_minutes: Number(r.slotMinutes), notice_minutes: Number(r.noticeMinutes),
      horizon_days: Number(r.horizonDays), at_once: Number(r.atOnce),
    }).eq("id", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
