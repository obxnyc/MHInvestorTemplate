import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { closeInquiry, type Outcome } from "@/lib/inquiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTCOMES = new Set<Outcome>([
  "leased_with_us", "leased_elsewhere", "wrong_location", "price_mismatch",
  "bought_home", "relocated_away", "did_not_qualify", "unknown",
]);

/**
 * Correct what we read, or close an inquiry out.
 *
 * Correcting is the other half of reading the preferences out of a sentence.
 * The parser is a guess -- it says so, and it says which words it guessed
 * from -- and a guess nobody can correct is worse than no guess, because it
 * is the one that gets planned around.
 */
export async function PATCH(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "which inquiry?" }, { status: 400 });

  const db = supabaseAdmin();

  if (body.outcome) {
    const outcome = String(body.outcome) as Outcome;
    // No default, and 'unknown' has to be chosen rather than fallen into.
    // The outcome is what keeps a follow-up away from somebody who bought a
    // house, so an invalid one is refused rather than quietly stored.
    if (!OUTCOMES.has(outcome)) {
      return NextResponse.json({ error: `not an outcome: ${outcome}` }, { status: 400 });
    }
    try {
      const out = await closeInquiry(db, id, outcome, body.note);
      return NextResponse.json(out);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  const patch: Record<string, unknown> = {};
  if ("bedroomsMin" in body) {
    const n = Number(body.bedroomsMin);
    patch.bedrooms_min = body.bedroomsMin === "" || !Number.isFinite(n) ? null : n;
  }
  if ("priceCeiling" in body) {
    const n = Number(body.priceCeiling);
    patch.price_ceiling = body.priceCeiling === "" || !Number.isFinite(n) ? null : n;
  }
  if ("area" in body) patch.area = String(body.area ?? "").trim() || null;
  if ("moveInFrom" in body) patch.move_in_from = String(body.moveInFrom ?? "").trim() || null;
  if ("hasPets" in body) {
    // Three states, not two. Null is "nobody asked", and a tick box that can
    // only say yes or no turns that into a claim.
    patch.has_pets = body.hasPets === null || body.hasPets === "" ? null : !!body.hasPets;
  }
  if ("ownerId" in body) patch.owner_id = String(body.ownerId ?? "") || null;
  if ("unitId" in body) patch.unit_id = String(body.unitId ?? "") || null;

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  }

  // A hand-corrected field is no longer a guess, so the words it was read out
  // of are taken off it. Leaving them there would keep showing "we read this
  // from '3 kids'" beside a number somebody typed themselves.
  const { data: had } = await db.from("inquiries").select("read").eq("id", id).maybeSingle();
  const read = { ...((had?.read ?? {}) as Record<string, unknown>) };
  for (const [col, key] of [["bedrooms_min", "bedroomsMin"], ["price_ceiling", "priceCeiling"],
                            ["area", "area"], ["move_in_from", "moveInFrom"],
                            ["has_pets", "hasPets"]] as const) {
    if (col in patch) delete read[key];
  }

  const { error } = await db.from("inquiries").update({ ...patch, read }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
