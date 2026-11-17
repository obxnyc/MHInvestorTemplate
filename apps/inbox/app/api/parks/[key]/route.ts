import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { isDesk } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One park owner: their parcels and their history (GET), where they stand
 *  (PATCH), and a touch logged against them (POST).
 *
 *  Nothing here deletes. A stage is somebody's typing and the touch log is
 *  the record of who was told what; both only ever grow or change. */

const STAGES = ["new", "researching", "contacted", "talking", "offer", "contract", "closed", "dead"];
const KINDS = ["letter", "call", "text", "email", "visit", "note"];

async function gate() {
  const me = await requireStaff();
  if (!me) return { err: NextResponse.json({ error: "not signed in" }, { status: 401 }) };
  if (!isDesk(me.role)) return { err: NextResponse.json({ error: "office and admin only" }, { status: 403 }) };
  return { me };
}

const okKey = (k: string) => /^[0-9a-f]{32}$/.test(k);

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const g = await gate(); if (g.err) return g.err;
  const { key } = await ctx.params;
  if (!okKey(key)) return NextResponse.json({ error: "not an owner key" }, { status: 400 });
  const db = await supabaseServer();

  const { data: owner, error } = await db.from("mhp_owners")
    .select("key, owner, mail_address, mail_zip").eq("key", key).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!owner) return NextResponse.json({ error: "no such owner" }, { status: 404 });

  // The parcels are found the way the view groups them: name, mailing
  // address and zip, compared the same way, so the two cannot disagree.
  const { data: rows, error: pe } = await db.from("mhp_parcels")
    .select("key, cnty, parno, ownname, mailadd, mzip, siteadd, scity, acres, parval, landval, improvval, usedesc, subdivision, saledate, structyear, lat, lon, matched_on")
    .ilike("ownname", owner.owner.replace(/[%_\\]/g, (c: string) => "\\" + c));
  if (pe) return NextResponse.json({ error: pe.message }, { status: 500 });
  const norm = (s: string | null) => (s ?? "").trim().toUpperCase();
  const parcels = (rows ?? []).filter((p) =>
    norm(p.ownname) === owner.owner &&
    norm(p.mailadd) === norm(owner.mail_address) &&
    norm(p.mzip) === norm(owner.mail_zip))
    .sort((a, b) => (Number(b.acres) || 0) - (Number(a.acres) || 0));

  const { data: touches, error: te } = await db.from("mhp_touches")
    .select("id, kind, body, at, by, staff:staff!mhp_touches_by_fkey(full_name)")
    .eq("owner_key", key).order("at", { ascending: false }).limit(200);
  if (te) return NextResponse.json({ error: te.message }, { status: 500 });

  return NextResponse.json({ parcels, touches });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const g = await gate(); if (g.err) return g.err;
  const { key } = await ctx.params;
  if (!okKey(key)) return NextResponse.json({ error: "not an owner key" }, { status: 400 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if ("stage" in body) {
    if (!STAGES.includes(String(body.stage))) return NextResponse.json({ error: "unknown stage" }, { status: 400 });
    patch.stage = body.stage;
  }
  if ("starred" in body) patch.starred = Boolean(body.starred);
  if ("next_touch" in body) {
    const d = body.next_touch;
    if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(d)))
      return NextResponse.json({ error: "next contact must be a date" }, { status: 400 });
    patch.next_touch = d;
  }
  for (const f of ["phone", "email", "notes"] as const) {
    if (f in body) patch[f] = body[f] === null ? null : String(body[f]).slice(0, 4000);
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to change" }, { status: 400 });

  const db = await supabaseServer();
  const { data, error } = await db.from("mhp_leads")
    .upsert({ owner_key: key, ...patch, updated_at: new Date().toISOString(), updated_by: g.me!.id },
      { onConflict: "owner_key" })
    .select("owner_key, stage, starred, next_touch, phone, email, notes, updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lead: data });
}

export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const g = await gate(); if (g.err) return g.err;
  const { key } = await ctx.params;
  if (!okKey(key)) return NextResponse.json({ error: "not an owner key" }, { status: 400 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const kind = String(body.kind ?? "");
  if (!KINDS.includes(kind)) return NextResponse.json({ error: "unknown kind of touch" }, { status: 400 });
  const text = body.body ? String(body.body).slice(0, 4000) : null;
  if (kind === "note" && !text?.trim()) return NextResponse.json({ error: "a note needs words" }, { status: 400 });

  const db = await supabaseServer();
  const { data, error } = await db.from("mhp_touches")
    .insert({ owner_key: key, kind, body: text, by: g.me!.id })
    .select("id, kind, body, at, by").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // A first letter or call moves a fresh lead to "contacted" on its own --
  // otherwise every lead worked stays "new" until somebody remembers.
  let lead = null;
  if (kind !== "note") {
    const { data: cur } = await db.from("mhp_leads").select("stage").eq("owner_key", key).maybeSingle();
    if (!cur || cur.stage === "new" || cur.stage === "researching") {
      const r = await db.from("mhp_leads")
        .upsert({ owner_key: key, stage: "contacted", updated_at: new Date().toISOString(), updated_by: g.me!.id },
          { onConflict: "owner_key" })
        .select("owner_key, stage, starred, next_touch, phone, email, notes, updated_at").single();
      lead = r.data;
    }
  }
  return NextResponse.json({ touch: { ...data, staff: { full_name: g.me!.full_name } }, lead });
}
