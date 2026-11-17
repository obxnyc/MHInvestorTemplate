import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { isDesk } from "@/lib/roles";
import { ASSET_CLASSES } from "@/lib/buybox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Buy boxes (074): list (GET), add (POST), change one (PATCH { id, ... }).
 *  Switching a box off is the only way to retire it; nothing removes one. */

const COLS = "id, asset_class, area, min_units, max_units, min_price, max_price, max_price_per_unit, min_occupancy, financing, wants, avoids, notes, active, sort";
const NUMS = ["min_units", "max_units", "min_price", "max_price", "max_price_per_unit", "min_occupancy", "sort"] as const;
const TEXTS = ["area", "financing", "wants", "avoids", "notes"] as const;

async function gate() {
  const me = await requireStaff();
  if (!me) return { err: NextResponse.json({ error: "not signed in" }, { status: 401 }) };
  if (!isDesk(me.role)) return { err: NextResponse.json({ error: "office and admin only" }, { status: 403 }) };
  return { me };
}

/** A box as typed, cleaned: an empty number is "no limit", never zero --
 *  a max price of zero would be a box nothing fits. */
function clean(b: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if ("asset_class" in b) {
    if (!ASSET_CLASSES.some(([k]) => k === b.asset_class)) throw new Error("unknown asset class");
    out.asset_class = b.asset_class;
  }
  for (const k of NUMS) {
    if (!(k in b)) continue;
    const v = b[k];
    if (v === null || v === "" || v === undefined) { out[k] = k === "sort" ? 0 : null; continue; }
    const n = Number(String(v).replace(/[$,%\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) throw new Error(`${k.replace(/_/g, " ")} must be a number`);
    out[k] = n;
  }
  for (const k of TEXTS) {
    if (!(k in b)) continue;
    const s = b[k] == null ? "" : String(b[k]).trim().slice(0, 1000);
    out[k] = s || (k === "area" ? "" : null);
  }
  if ("active" in b) out.active = Boolean(b.active);
  if (out.min_units != null && out.max_units != null && Number(out.min_units) > Number(out.max_units)) throw new Error("the smallest size is bigger than the largest");
  if (out.min_price != null && out.max_price != null && Number(out.min_price) > Number(out.max_price)) throw new Error("the lowest price is above the highest");
  if (out.min_occupancy != null && Number(out.min_occupancy) > 100) throw new Error("occupancy is a percentage, 0 to 100");
  return out;
}

export async function GET() {
  const g = await gate(); if (g.err) return g.err;
  const db = await supabaseServer();
  const { data, error } = await db.from("buy_boxes").select(COLS).order("sort").order("asset_class");
  if (error) return NextResponse.json({
    error: /buy_boxes/.test(error.message) ? "Migration 074 has not been applied yet, so there is nowhere to keep buy boxes." : error.message,
  }, { status: 500 });
  return NextResponse.json({ boxes: data });
}

export async function POST(req: Request) {
  const g = await gate(); if (g.err) return g.err;
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  let row;
  try { row = clean({ asset_class: "mhp", ...b }); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  const db = await supabaseServer();
  const { data, error } = await db.from("buy_boxes").insert({ ...row, updated_by: g.me!.id }).select(COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ box: data });
}

export async function PATCH(req: Request) {
  const g = await gate(); if (g.err) return g.err;
  const { id: rawId, ...rest } = await req.json().catch(() => ({})) as Record<string, unknown>;
  const id = String(rawId ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "which buy box?" }, { status: 400 });
  let patch;
  try { patch = clean(rest); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  const db = await supabaseServer();
  const { data, error } = await db.from("buy_boxes")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: g.me!.id }).eq("id", id).select(COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ box: data });
}
