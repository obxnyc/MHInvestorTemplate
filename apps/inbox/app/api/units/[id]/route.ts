import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Changing one lot: whether it is empty, what it asks, how many bedrooms.
 *
 *  is_vacant is the field the rest of the application reads -- the dashboard
 *  counts it and prices the gap -- so it is worth being able to set from the
 *  list rather than only through an import that does not exist yet. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const patch: Record<string, unknown> = {};
  if (typeof body.isVacant === "boolean") {
    patch.is_vacant = body.isVacant;
    // A lot that has just been let has no meaningful "available from" date, and
    // leaving yesterday's on it would put it back in the vacancy list.
    if (!body.isVacant) patch.available_on = null;
  }
  if ("rent" in body) {
    const n = Number(body.rent);
    patch.monthly_rent = body.rent === "" || !Number.isFinite(n) ? null : n;
  }
  if ("bedrooms" in body) {
    const n = Number(body.bedrooms);
    patch.bedrooms = body.bedrooms === "" || !Number.isFinite(n) ? null : n;
  }
  if ("availableOn" in body) {
    patch.available_on = String(body.availableOn ?? "").trim() || null;
  }
  for (const [field, col] of [["bathrooms", "bathrooms"], ["squareFeet", "square_feet"],
                             ["homeYear", "home_year"]] as const) {
    if (field in body) {
      const n = Number(body[field]);
      patch[col] = body[field] === "" || !Number.isFinite(n) ? null : n;
    }
  }
  for (const [field, col] of [["homeMake", "home_make"], ["homeSerial", "home_serial"]] as const) {
    if (field in body) patch[col] = String(body[field] ?? "").trim() || null;
  }
  if ("homeOwner" in body) {
    // Who owns the home on this lot. Never inferred from anything: getting it
    // wrong is an argument with a resident about whose water heater it is.
    const v = String(body.homeOwner);
    if (!["ours", "theirs", "none"].includes(v)) {
      return NextResponse.json({ error: "whose home is it?" }, { status: 400 });
    }
    patch.home_owner = v;
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db.from("units").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** Removing a lot that was entered by mistake. Refused once anything points at
 *  it, because a unit id on a conversation or a job is how an address is known
 *  and deleting it would quietly detach that history. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "admins only" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const db = supabaseAdmin();

  const [{ count: convos }, { count: jobs }] = await Promise.all([
    db.from("conversations").select("id", { count: "exact", head: true }).eq("unit_id", id),
    db.from("work_orders").select("id", { count: "exact", head: true }).eq("unit_id", id),
  ]);
  if ((convos ?? 0) + (jobs ?? 0) > 0) {
    return NextResponse.json({
      error: "Something is filed against this lot — a conversation or a job — so"
        + " removing it would detach that history. Mark it occupied instead.",
    }, { status: 409 });
  }

  const { error } = await db.from("units").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
