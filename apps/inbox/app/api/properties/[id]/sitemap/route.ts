import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { signMedia } from "@/lib/media";
import { centreOf, zoomFor } from "@/lib/sitemap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the map of one property needs.
 *
 * Assembled here rather than in the page because a lot's answer to "what is
 * this" comes from four places -- the unit, whoever owns the home on it, what
 * is open against it, and whatever anybody wrote about the place itself --
 * and doing that from the browser would be four round trips per pin.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();

  const WIDE = "id, name, code, kind, color, address, lat, lng, map_kind, map_image, map_zoom, map_note";
  const wide = await supabase.from("properties").select(WIDE).eq("id", id).maybeSingle();
  // Same reason as the units below: the narrow fallback has a different
  // shape, and naming the union once beats asserting at every use.
  type PropRow = Record<string, unknown> & { id: string; name: string };
  const property = (wide.error
    // Before migration 024 the map columns are not there. The screen then says
    // there is no map rather than failing to load at all.
    ? (await supabase.from("properties")
        .select("id, name, code, kind, color, address").eq("id", id).maybeSingle()).data
    : wide.data) as unknown as PropRow | null;
  if (!property) return NextResponse.json({ error: "not found" }, { status: 404 });

  const UNITS = "id, label, bedrooms, bathrooms, square_feet, monthly_rent, is_vacant,"
    + " home_owner, home_year, home_make, home_serial, lat, lng, map_x, map_y,"
    + " meter_water, meter_electric, owners:home_owner_id(name)";
  // The narrow fallback returns a different row shape, and the union of the
  // two defeats inference, so it is named once here rather than asserted at
  // every use below.
  type UnitRow = Record<string, unknown> & { id: string };
  const wideUnits = await supabase.from("units").select(UNITS)
    .eq("property_id", id).order("label");
  const units = (wideUnits.error
    ? (await supabase.from("units")
        .select("id, label, bedrooms, monthly_rent, is_vacant")
        .eq("property_id", id).order("label")).data ?? []
    : wideUnits.data ?? []) as unknown as UnitRow[];

  const unitIds = units.map((u) => String(u.id));

  // What is open against each lot, and what was done recently. Both, because
  // "nothing outstanding" reads very differently next to "and four jobs in
  // the last year" than it does alone.
  const { data: jobs } = unitIds.length
    ? await supabase.from("work_orders")
        .select("id, summary, status, urgency, scheduled_for, completed_at, cost_cents, unit_id")
        .in("unit_id", unitIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  const notes = await supabase.from("unit_notes")
    .select("id, body, pinned, created_at, unit_id, staff:author_id(full_name)")
    .in("unit_id", unitIds.length ? unitIds : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at", { ascending: false });

  // The backdrop. Signed with the service role and short-lived: a site plan
  // shows where people live, so it is never a public URL.
  const path = (property.map_image as string | null) ?? null;
  const signed = path
    ? (await signMedia(supabaseAdmin(), [path], 900)).get(path) ?? null
    : null;

  const placed = units
    .map((u) => ({ lat: Number(u.lat), lng: Number(u.lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  return NextResponse.json({
    property,
    units: units.map((u) => ({
      ...u,
      owner: (u.owners as { name: string } | null)?.name ?? null,
      jobs: (jobs ?? []).filter((j) => j.unit_id === u.id),
      notes: (notes.error ? [] : notes.data ?? []).filter((n) => n.unit_id === u.id),
    })),
    map: {
      image: signed,
      // Suggested, not stored: the picture should frame whatever is currently
      // placed, and that changes as lots are added.
      // Falls back to the property's own confirmed pin, so a park with
      // nothing placed still opens looking at itself.
      centre: centreOf(placed)
        ?? (property.lat != null
          ? { lat: Number(property.lat), lng: Number(property.lng) } : null),
      zoom: (property.map_zoom as number | null) ?? zoomFor(placed, 900, 620),
      placed: placed.length,
      total: units.length,
    },
    // Whether an aerial can be drawn at all. Without a key the map still
    // works over an uploaded plan, and says so rather than showing grey.
    aerial: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    canEdit: me.role === "admin" || me.role === "office",
  });
}
