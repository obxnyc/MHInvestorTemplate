import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { KINDS, nextCode, type Kind } from "@/lib/property";

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

  const { name, address, kind, lat, lng, placeId, confirmed, ownerId } =
    await req.json().catch(() => ({}));
  const label = String(name ?? "").trim();
  if (label.length < 2) {
    return NextResponse.json({ error: "Give it a name." }, { status: 400 });
  }
  const type = String(kind ?? "sfh") as Kind;
  const spec = KINDS[type];
  if (!spec) {
    return NextResponse.json({ error: "Pick what kind of property it is." }, { status: 400 });
  }

  // A point is only kept when both halves are real. Half a coordinate would
  // put a pin in the Atlantic, and a wrong pin is worse than none -- somebody
  // drives to it.
  const point = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    && lat !== null && lng !== null
    ? { lat: Number(lat), lng: Number(lng) } : null;

  const db = supabaseAdmin();
  // Codes are derived from what exists, and the unique index is what actually
  // decides. Two people adding in the same second both count the same set and
  // both get 004; the loser retries rather than being told it failed.
  const { data: existing } = await db.from("properties").select("code");
  const taken = ((existing ?? []).map((p) => p.code).filter(Boolean)) as string[];

  let made: { id: string; code: string } | null = null;
  let failed: { code?: string; message: string } | null = null;

  for (let attempt = 0; attempt < 5 && !made; attempt++) {
    const code = nextCode(spec.prefix, taken);
    const res = await db.from("properties").insert({
      name: label,
      address: String(address ?? "").trim() || null,
      // Shared by every property of its kind, so the tint on a conversation
      // says what sort of place it is rather than what somebody picked.
      color: spec.color,
      code,
      kind: type,
      owner_id: String(ownerId ?? "").trim() || null,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      place_id: String(placeId ?? "").trim() || null,
      // Only recorded as confirmed when somebody actually looked at the aerial
      // and said yes. It is a claim about a person having checked, so it is not
      // set just because coordinates arrived.
      confirmed_at: point && confirmed ? new Date().toISOString() : null,
      confirmed_by: point && confirmed ? me.id : null,
    }).select("id, code").single();

    if (!res.error) { made = res.data as { id: string; code: string }; break; }

    failed = res.error;
    // Somebody took that code between our count and our insert. Remember it
    // and go round again. Anything else is a real failure.
    if (res.error.code === "23505") { taken.push(code); continue; }
    break;
  }

  if (!made) {
    return NextResponse.json({ error: failed?.message ?? "Could not add it." },
                             { status: 400 });
  }

  // A house is not a park with one lot. Where a property holds exactly one
  // dwelling, that dwelling IS the property, so it is created here and the
  // person is never asked to add it -- which is what "no lots on this one yet"
  // under a single-family home was really saying.
  if (spec.holds === "one") {
    await db.from("units").insert({
      property_id: made.id,
      label: made.code,
      is_vacant: true,
      home_owner: type === "lot" ? "none" : "ours",
    });
  }

  return NextResponse.json({ ok: true, id: made.id, code: made.code });
}
