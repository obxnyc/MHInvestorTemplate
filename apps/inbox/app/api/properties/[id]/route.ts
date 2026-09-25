import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { KINDS, type Kind } from "@/lib/property";

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

/** Changing a property: its name, address, where it is, or what kind it is.
 *
 *  The code is not editable. It is what a work order, a lease and a bank line
 *  are filed under, and a code that can be changed is a code nobody can rely
 *  on -- rename the property instead, which is free. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();

  const patch: Record<string, unknown> = {};

  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (name.length < 2) {
      return NextResponse.json({ error: "Give it a name." }, { status: 400 });
    }
    patch.name = name;
  }
  if ("address" in body) patch.address = String(body.address ?? "").trim() || null;
  if ("ownerId" in body) patch.owner_id = String(body.ownerId ?? "").trim() || null;

  if ("kind" in body) {
    const spec = KINDS[String(body.kind) as Kind];
    if (!spec) {
      return NextResponse.json({ error: "Pick what kind of property it is." }, { status: 400 });
    }
    // The code keeps its original prefix even if the kind changes. It is an
    // identifier, not a description: SFH-004 becoming MHP-004 would break
    // every document that already names it.
    patch.kind = body.kind;
    patch.color = spec.color;
  }

  if ("lat" in body && "lng" in body) {
    const ok = Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lng))
      && body.lat !== null && body.lng !== null;
    patch.lat = ok ? Number(body.lat) : null;
    patch.lng = ok ? Number(body.lng) : null;
    patch.place_id = String(body.placeId ?? "").trim() || null;
    patch.confirmed_at = ok && body.confirmed ? new Date().toISOString() : null;
    patch.confirmed_by = ok && body.confirmed ? me.id : null;
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  }

  const { error } = await db.from("properties").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** Removing a property entered by mistake.
 *
 *  Refused the moment anything real points at it. A property deleted out from
 *  under a conversation takes the address off it -- and units cascade, so the
 *  lots go with it. That is right for a typo and catastrophic for a park
 *  somebody has been texting about for a year, and the two look identical
 *  from this endpoint. So: count first, refuse with the count. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "admins only" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const db = supabaseAdmin();

  const { data: units } = await db.from("units").select("id").eq("property_id", id);
  const unitIds = (units ?? []).map((u) => u.id);

  const [{ count: convos }, { count: jobs }] = unitIds.length
    ? await Promise.all([
        db.from("conversations").select("id", { count: "exact", head: true })
          .in("unit_id", unitIds),
        db.from("work_orders").select("id", { count: "exact", head: true })
          .in("unit_id", unitIds),
      ])
    : [{ count: 0 }, { count: 0 }];

  const attached = (convos ?? 0) + (jobs ?? 0);
  if (attached > 0) {
    return NextResponse.json({
      error: `${attached} conversation${attached === 1 ? "" : "s"} or job${attached === 1 ? "" : "s"}`
        + ` reference${attached === 1 ? "s" : ""} this property. Deleting it would take the`
        + ` address off them. Rename it instead, or clear those first.`,
    }, { status: 409 });
  }

  const { error } = await db.from("properties").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
