import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Adding lots to a park.
 *
 *  Takes one label or a run of them -- "1-24" or "1,3,5" -- because a park is
 *  entered once and typing twenty-four lots one at a time is how a property
 *  ends up half entered. Labels already present are skipped rather than
 *  refused, so running it again to add the lots you missed is safe. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const { labels, bedrooms, rent } = await req.json().catch(() => ({}));

  const wanted = expand(String(labels ?? ""));
  if (!wanted.length) {
    return NextResponse.json({ error: "Name at least one lot." }, { status: 400 });
  }
  if (wanted.length > 300) {
    return NextResponse.json({ error: "That is more than 300 lots at once." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: prop } = await db
    .from("properties").select("id").eq("id", id).maybeSingle();
  if (!prop) return NextResponse.json({ error: "no such property" }, { status: 404 });

  const { data: have } = await db
    .from("units").select("label").eq("property_id", id);
  const already = new Set((have ?? []).map((u) => u.label));
  const rows = wanted.filter((l) => !already.has(l)).map((label) => ({
    property_id: id,
    label,
    bedrooms: Number.isFinite(Number(bedrooms)) && bedrooms !== "" ? Number(bedrooms) : null,
    monthly_rent: Number.isFinite(Number(rent)) && rent !== "" ? Number(rent) : null,
    is_vacant: true,
  }));

  if (rows.length) {
    const { error } = await db.from("units").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, added: rows.length, skipped: wanted.length - rows.length });
}

/**
 * "1-24", "1,3,5", "A,B,C", or any mixture.
 *
 * A range only expands when both ends are plain numbers. "A1-B4" is one label
 * with a hyphen in it, not a range -- guessing otherwise would silently create
 * lots nobody asked for, and a wrong lot on a lease is a real problem.
 */
function expand(input: string): string[] {
  const out: string[] = [];
  for (const piece of input.split(",").map((p) => p.trim()).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(piece);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (a <= b && b - a < 300) {
        for (let n = a; n <= b; n++) out.push(String(n));
        continue;
      }
    }
    out.push(piece);
  }
  return [...new Set(out)];
}
