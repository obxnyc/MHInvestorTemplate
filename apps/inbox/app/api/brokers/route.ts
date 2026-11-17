import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { isDesk } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every broker and realtor (071), the last time each was reached, how many
 *  listings we know of, and the pitch -- GET.
 *  Add one, or a whole spreadsheet of them -- POST { rows: [...] }.
 *  A row already here (same email, or same name at the same firm) is
 *  skipped, not overwritten: what somebody typed about a broker outranks an
 *  import. */

const COLS = "id, name, firm, kind, parks_listed, phone, email, city, state, covers, evidence, source_url, stage, starred, next_touch, notes, created_at, updated_at, opted_out_at";

async function gate() {
  const me = await requireStaff();
  if (!me) return { err: NextResponse.json({ error: "not signed in" }, { status: 401 }) };
  if (!isDesk(me.role)) return { err: NextResponse.json({ error: "office and admin only" }, { status: 403 }) };
  return { me };
}

export async function GET() {
  const g = await gate(); if (g.err) return g.err;
  const db = await supabaseServer();
  const brokers: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("brokers").select(COLS).order("name").range(from, from + 999);
    if (error) return NextResponse.json({
      error: /brokers/.test(error.message) && /exist|schema cache/.test(error.message)
        ? "Migration 071 has not been applied yet, so there is nowhere to keep brokers."
        : `Could not read the brokers: ${error.message}`,
    }, { status: 500 });
    brokers.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const last: Record<string, { kind: string; at: string }> = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("broker_touches").select("broker_id, kind, at")
      .order("at", { ascending: false }).range(from, from + 999);
    if (error) return NextResponse.json({ error: `Could not read the touch history: ${error.message}` }, { status: 500 });
    for (const t of data ?? []) if (!last[t.broker_id]) last[t.broker_id] = { kind: t.kind, at: t.at };
    if (!data || data.length < 1000) break;
  }
  const { data: s } = await db.from("acquisition_settings").select("pitch, pitch_residential, signature").maybeSingle();
  return NextResponse.json({ brokers, last, pitch: { pitch: s?.pitch ?? null, pitch_residential: s?.pitch_residential ?? null, signature: s?.signature ?? null } });
}

const clean = (v: unknown, n = 500) => {
  const s = v == null ? "" : String(v).trim();
  return s ? s.slice(0, n) : null;
};

export async function POST(req: Request) {
  const g = await gate(); if (g.err) return g.err;
  const body = await req.json().catch(() => ({})) as { rows?: Record<string, unknown>[] };
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
  if (!rows.length) return NextResponse.json({ error: "no rows" }, { status: 400 });

  const db = await supabaseServer();
  const { data: have, error: he } = await db.from("brokers").select("name, firm, email").range(0, 9999);
  if (he) return NextResponse.json({ error: he.message }, { status: 500 });
  const seenEmail = new Set((have ?? []).map((b) => (b.email ?? "").toLowerCase()).filter(Boolean));
  const seenName = new Set((have ?? []).map((b) => `${b.name.toLowerCase()}|${(b.firm ?? "").toLowerCase()}`));

  const add: Record<string, unknown>[] = [];
  let skipped = 0, bad = 0;
  for (const r of rows) {
    const name = clean(r.name, 200);
    if (!name) { bad++; continue; }
    const email = clean(r.email, 200)?.toLowerCase() ?? null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { bad++; continue; }
    const firm = clean(r.firm, 200);
    const nk = `${name.toLowerCase()}|${(firm ?? "").toLowerCase()}`;
    if ((email && seenEmail.has(email)) || seenName.has(nk)) { skipped++; continue; }
    if (email) seenEmail.add(email);
    seenName.add(nk);
    const evidence = clean(r.evidence ?? r.mhp_evidence, 1000);
    const kind = String(r.kind ?? "").toLowerCase() === "residential" || /^residential/i.test(evidence ?? "")
      ? "residential" : "commercial";
    add.push({
      name, firm, kind, email,
      phone: clean(r.phone, 60), city: clean(r.city, 120), state: clean(r.state, 40),
      covers: clean(r.covers, 300), evidence, source_url: clean(r.source_url ?? r.url, 1000),
      parks_listed: Number.isFinite(Number(r.parks_listed)) && r.parks_listed !== "" && r.parks_listed != null ? Number(r.parks_listed) : null,
      updated_by: g.me!.id,
    });
  }
  if (add.length) {
    const { error } = await db.from("brokers").insert(add);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ added: add.length, skipped, bad });
}
