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

  // Codes arrive with migration 017 and the type, point and owner with 016.
  // Until those are run the columns are not there, and an insert that names
  // one fails whole -- which would mean nobody can add a property at all. So
  // the write is attempted complete, and on an unknown column it drops back to
  // the three fields that have always existed and says so. A feature waiting
  // on a migration degrades to absent; it does not take the screen with it.
  const { data: existing, error: noCodes } = await db.from("properties").select("code");
  const taken = ((existing ?? []).map((p) => p.code).filter(Boolean)) as string[];

  let made: { id: string; code: string | null } | null = null;
  let failed: { code?: string; message: string } | null = null;
  let plain = Boolean(noCodes);

  for (let attempt = 0; attempt < 6 && !made; attempt++) {
    const code = plain ? null : nextCode(spec.prefix, taken);
    const row: Record<string, unknown> = {
      name: label,
      address: String(address ?? "").trim() || null,
      // Shared by every property of its kind, so the tint on a conversation
      // says what sort of place it is rather than what somebody picked.
      color: spec.color,
    };
    if (!plain) {
      Object.assign(row, {
        code,
        kind: type,
        owner_id: String(ownerId ?? "").trim() || null,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        place_id: String(placeId ?? "").trim() || null,
        // Only recorded as confirmed when somebody actually looked at the
        // aerial and said yes. It is a claim about a person having checked, so
        // it is not set just because coordinates arrived.
        confirmed_at: point && confirmed ? new Date().toISOString() : null,
        confirmed_by: point && confirmed ? me.id : null,
      });
    }

    const res = await db.from("properties").insert(row).select("id").single();
    if (!res.error) { made = { id: String(res.data.id), code }; break; }

    failed = res.error;
    // Somebody took that code between our count and our insert. Remember it
    // and go round again.
    if (res.error.code === "23505" && code) { taken.push(code); continue; }
    // The migration has not been run. Try again with what exists.
    if (!plain && missingColumn(res.error)) { plain = true; continue; }
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
    const unit = {
      property_id: made.id,
      label: made.code ?? label.slice(0, 40),
      is_vacant: true,
    };
    const res = await db.from("units")
      .insert({ ...unit, home_owner: type === "lot" ? "none" : "ours" });
    if (res.error && missingColumn(res.error)) await db.from("units").insert(unit);
  }

  return NextResponse.json({
    ok: true, id: made.id, code: made.code,
    // Said out loud rather than silently skipped. A property with no code and
    // no type looks like a bug six weeks later, and "the migration has not
    // been run" is a five-minute answer only while somebody remembers.
    pending: made.code
      ? null
      : "Added — but without a code, a type or an owner, because migration 017"
        + " has not been run on the database yet.",
  });
}

/** PostgREST reports an unknown column two ways depending on whether its
 *  schema cache or Postgres itself noticed first. Both mean the same thing:
 *  the migration that adds it has not been run. */
function missingColumn(e: { code?: string; message?: string }) {
  return e.code === "PGRST204" || e.code === "42703"
    || /could not find the .* column|column .* does not exist/i.test(e.message ?? "");
}
