import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Adding a park or a building.
 *
 *  Written with the service role, like every other write in here: properties
 *  and units are readable by any signed-in employee and writable by none of
 *  them directly, so the check that it is an admin or the office happens once,
 *  here, rather than being a policy that has to be kept in step with a grant. */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { name, address, color, kind, lat, lng, placeId, confirmed } =
    await req.json().catch(() => ({}));
  const label = String(name ?? "").trim();
  if (label.length < 2) {
    return NextResponse.json({ error: "Give it a name." }, { status: 400 });
  }
  const tint = String(color ?? "").trim();
  if (tint && !/^#[0-9A-Fa-f]{6}$/.test(tint)) {
    return NextResponse.json({ error: "A colour looks like #405981." }, { status: 400 });
  }

  const KINDS = new Set(["sfh", "mh", "duplex", "triplex", "multi", "mhp", "lot"]);
  const type = String(kind ?? "sfh");
  if (!KINDS.has(type)) {
    return NextResponse.json({ error: "Pick what kind of property it is." }, { status: 400 });
  }

  // A point is only kept when both halves are real. Half a coordinate would
  // put a pin in the Atlantic, and a wrong pin is worse than none -- somebody
  // drives to it.
  const point = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    && lat !== null && lng !== null
    ? { lat: Number(lat), lng: Number(lng) } : null;

  const db = supabaseAdmin();
  const { data, error } = await db.from("properties").insert({
    name: label,
    address: String(address ?? "").trim() || null,
    color: tint || null,
    kind: type,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    place_id: String(placeId ?? "").trim() || null,
    // Only recorded as confirmed when somebody actually looked at the aerial
    // and said yes. It is a claim about a person having checked, so it is not
    // set just because coordinates arrived.
    confirmed_at: point && confirmed ? new Date().toISOString() : null,
    confirmed_by: point && confirmed ? me.id : null,
  }).select("id").single();

  // 23505 = two people adding the same park at once, or a second attempt after
  // a slow first one.
  if (error) {
    return NextResponse.json(
      { error: error.code === "23505" ? "There is already one by that name." : error.message },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, id: data.id });
}
