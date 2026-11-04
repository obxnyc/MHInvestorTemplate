import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { missing, type FeedListing } from "@/lib/zillow-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PETS = new Set(["cats", "dogs", "both", "none", "ask"]);

/**
 * Save a listing, and press the button.
 *
 * `onZillow: true` is refused while anything Zillow needs is missing, and the
 * refusal lists what -- a listing with no photo is the kind that gets a whole
 * feed turned down, and finding that out from Zillow weeks later is finding
 * it out late.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const unitId = String(body.unitId ?? "");
  if (!unitId) return NextResponse.json({ error: "which home?" }, { status: 400 });

  const db = supabaseAdmin();
  const text = (v: unknown) => (v === undefined ? undefined : String(v ?? "").trim() || null);
  const num = (v: unknown) => {
    if (v === undefined) return undefined;
    const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
    return v === "" || v === null || !Number.isFinite(n) ? null : n;
  };

  const patch: Record<string, unknown> = { unit_id: unitId, updated_at: new Date().toISOString() };
  for (const k of ["headline", "description", "street", "city", "zip"] as const) {
    const v = text(body[k]); if (v !== undefined) patch[k] = v;
  }
  if (body.state !== undefined) patch.state = (text(body.state) ?? "").toUpperCase() || null;
  const dep = num(body.deposit); if (dep !== undefined) patch.deposit = dep;
  const lease = num(body.leaseMonths); if (lease !== undefined) patch.lease_months = lease;
  if (body.pets !== undefined) {
    if (!PETS.has(String(body.pets))) return NextResponse.json({ error: "pets?" }, { status: 400 });
    patch.pets = body.pets;
  }
  if (Array.isArray(body.photos)) {
    patch.photos = body.photos.map(String).filter((u: string) => /^https:\/\//.test(u)).slice(0, 40);
  }

  // Bedrooms, bathrooms and rent live on the unit, where everything else in
  // the app already reads them. Editing them here edits them there.
  const unitPatch: Record<string, unknown> = {};
  const beds = num(body.bedrooms); if (beds !== undefined) unitPatch.bedrooms = beds;
  const baths = num(body.bathrooms); if (baths !== undefined) unitPatch.bathrooms = baths;
  const rent = num(body.rent); if (rent !== undefined) unitPatch.monthly_rent = rent;
  const sqft = num(body.squareFeet); if (sqft !== undefined) unitPatch.square_feet = sqft;
  if (Object.keys(unitPatch).length) {
    const { error } = await db.from("units").update(unitPatch).eq("id", unitId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: had } = await db.from("listings").select("on_zillow").eq("unit_id", unitId).maybeSingle();
  const { error: saveError } = await db.from("listings").upsert(patch, { onConflict: "unit_id" });
  if (saveError) {
    return NextResponse.json({
      error: /listings/.test(saveError.message)
        ? "Run migration 051 first -- the listings table is not there yet."
        : saveError.message,
    }, { status: 500 });
  }

  if (body.onZillow !== undefined) {
    const want = !!body.onZillow;
    if (want) {
      const { data: l } = await db.from("listings")
        .select("street, city, state, zip, description, photos, units(bedrooms, monthly_rent, is_vacant)")
        .eq("unit_id", unitId).single();
      const u = l?.units as unknown as { bedrooms: number | null; monthly_rent: number | null;
                                         is_vacant: boolean } | null;
      const gaps = missing({
        street: l?.street ?? "", city: l?.city ?? "", state: l?.state ?? "", zip: l?.zip ?? "",
        description: l?.description ?? "", photos: (l?.photos ?? []) as string[],
        rent: Number(u?.monthly_rent ?? 0),
        bedrooms: u?.bedrooms === null || u?.bedrooms === undefined ? (undefined as unknown as number) : u.bedrooms,
      } as Partial<FeedListing>);
      if (!u?.is_vacant) gaps.unshift("the home marked empty (it is not, so it cannot be advertised)");
      if (gaps.length) {
        return NextResponse.json({ error: `Before it can go on Zillow it needs: ${gaps.join(", ")}.`,
                                   missing: gaps }, { status: 400 });
      }
    }
    await db.from("listings").update({
      on_zillow: want,
      ...(want && !had?.on_zillow ? { listed_at: new Date().toISOString(), unlisted_at: null } : {}),
      ...(!want && had?.on_zillow ? { unlisted_at: new Date().toISOString() } : {}),
    }).eq("unit_id", unitId);
  }

  return NextResponse.json({ ok: true });
}
