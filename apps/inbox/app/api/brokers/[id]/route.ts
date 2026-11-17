import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { isDesk } from "@/lib/roles";
import { BROKER_STAGES, BROKER_TOUCHES } from "@/lib/brokers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One broker: listings and history (GET), details and stage (PATCH), a
 *  touch logged (POST). An email logged against somebody not yet contacted
 *  moves them to Emailed, so the list says who still needs one. */

async function gate() {
  const me = await requireStaff();
  if (!me) return { err: NextResponse.json({ error: "not signed in" }, { status: 401 }) };
  if (!isDesk(me.role)) return { err: NextResponse.json({ error: "office and admin only" }, { status: 403 }) };
  return { me };
}
const okId = (s: string) => /^[0-9a-f-]{36}$/.test(s);
const COLS = "id, name, firm, kind, parks_listed, phone, email, city, state, covers, evidence, source_url, stage, starred, next_touch, notes, created_at, updated_at";

export async function GET(_r: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(); if (g.err) return g.err;
  const { id } = await ctx.params;
  if (!okId(id)) return NextResponse.json({ error: "not a broker" }, { status: 400 });
  const db = await supabaseServer();
  const [l, t] = await Promise.all([
    db.from("broker_listings").select("id, title, location, price, lots, url, source, seen_at").eq("broker_id", id).order("seen_at", { ascending: false }),
    db.from("broker_touches").select("id, kind, body, at, by, staff:staff!broker_touches_by_fkey(full_name)").eq("broker_id", id).order("at", { ascending: false }).limit(200),
  ]);
  if (l.error || t.error) return NextResponse.json({ error: (l.error ?? t.error)!.message }, { status: 500 });
  return NextResponse.json({ listings: l.data, touches: t.data });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(); if (g.err) return g.err;
  const { id } = await ctx.params;
  if (!okId(id)) return NextResponse.json({ error: "not a broker" }, { status: 400 });
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if ("stage" in b) {
    if (!BROKER_STAGES.some(([k]) => k === b.stage)) return NextResponse.json({ error: "unknown stage" }, { status: 400 });
    patch.stage = b.stage;
  }
  if ("kind" in b) {
    if (b.kind !== "commercial" && b.kind !== "residential") return NextResponse.json({ error: "unknown kind" }, { status: 400 });
    patch.kind = b.kind;
  }
  if ("starred" in b) patch.starred = Boolean(b.starred);
  if ("next_touch" in b) {
    if (b.next_touch !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.next_touch)))
      return NextResponse.json({ error: "next contact must be a date" }, { status: 400 });
    patch.next_touch = b.next_touch;
  }
  for (const f of ["name", "firm", "phone", "email", "city", "state", "covers", "evidence", "notes"] as const) {
    if (f in b) patch[f] = b[f] == null || String(b[f]).trim() === "" ? null : String(b[f]).trim().slice(0, 4000);
  }
  if ("name" in patch && !patch.name) return NextResponse.json({ error: "a broker needs a name" }, { status: 400 });
  if (patch.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(patch.email)))
    return NextResponse.json({ error: "that is not an email address" }, { status: 400 });
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  const db = await supabaseServer();
  const { data, error } = await db.from("brokers")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: g.me!.id })
    .eq("id", id).select(COLS).single();
  if (error) return NextResponse.json({ error: /brokers_email_once/.test(error.message) ? "Another broker already has that email." : error.message }, { status: 500 });
  return NextResponse.json({ broker: data });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(); if (g.err) return g.err;
  const { id } = await ctx.params;
  if (!okId(id)) return NextResponse.json({ error: "not a broker" }, { status: 400 });
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const db = await supabaseServer();

  // A listing of theirs, typed in or carried over from an alert.
  if (b.listing) {
    const L = b.listing as Record<string, unknown>;
    const title = String(L.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "a listing needs a name" }, { status: 400 });
    const { data, error } = await db.from("broker_listings").insert({
      broker_id: id, title: title.slice(0, 300),
      location: L.location ? String(L.location).slice(0, 300) : null,
      price: Number(L.price) || null, lots: Number(L.lots) || null,
      url: L.url ? String(L.url).slice(0, 1000) : null, source: String(L.source ?? "typed").slice(0, 40),
    }).select("id, title, location, price, lots, url, source, seen_at").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ listing: data });
  }

  const kind = String(b.kind ?? "");
  if (!(BROKER_TOUCHES as readonly string[]).includes(kind)) return NextResponse.json({ error: "unknown kind of touch" }, { status: 400 });
  const text = b.body ? String(b.body).slice(0, 8000) : null;
  if (kind === "note" && !text?.trim()) return NextResponse.json({ error: "a note needs words" }, { status: 400 });
  const { data, error } = await db.from("broker_touches")
    .insert({ broker_id: id, kind, body: text, by: g.me!.id }).select("id, kind, body, at, by").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let broker = null;
  if (kind !== "note") {
    const { data: cur } = await db.from("brokers").select("stage").eq("id", id).maybeSingle();
    if (cur?.stage === "new") {
      const r = await db.from("brokers").update({ stage: kind === "email" ? "emailed" : "replied", updated_at: new Date().toISOString(), updated_by: g.me!.id })
        .eq("id", id).select(COLS).single();
      broker = r.data;
    }
  }
  return NextResponse.json({ touch: { ...data, staff: { full_name: g.me!.full_name } }, broker });
}
