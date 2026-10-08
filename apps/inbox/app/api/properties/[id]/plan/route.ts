import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { layRow, clamp, angleOf } from "@/lib/park";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The shape Postgres uses to say a column is not there. */
const missing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "42P01"
    || /does not exist/i.test(e.message ?? ""));

/**
 * A park, as a plan: every pad, who owns the home on it, and who lives there.
 *
 * One request rather than one per lot. A park is fifty lots and a screen that
 * asks fifty times is a screen that takes four seconds to open on a phone in
 * a driveway, which is where this gets looked at.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();

  const { data: property } = await supabase
    .from("properties").select("id, name, kind").eq("id", id).maybeSingle();
  if (!property) return NextResponse.json({ error: "not found" }, { status: 404 });

  // The layout columns arrive with 024 and 030. Asked for tolerantly so the
  // page says "run the migration" rather than failing to open at all.
  const read = (cols: string) => supabase.from("units")
    .select(cols).eq("property_id", id).order("label");

  let pending = false;
  // Asked for in descending order of how much the database might have:
  // 031's ownership columns, then 024 and 030's layout columns, then the
  // bare minimum. A page that says "run the migration" beats one that
  // will not open.
  let got = await read(
    "id, label, lat, lng, map_x, map_y, map_rot, is_vacant, monthly_rent,"
    + " home_kind, we_manage, park_use, tenant_rent_cents");
  if (got.error && missing(got.error)) {
    got = await read(
      "id, label, lat, lng, map_x, map_y, map_rot, is_vacant, monthly_rent, home_kind, we_manage");
  }
  if (got.error && missing(got.error)) {
    got = await read("id, label, lat, lng, map_x, map_y, map_rot, is_vacant, monthly_rent");
  }
  if (got.error && missing(got.error)) {
    pending = true;
    got = await read("id, label, is_vacant, monthly_rent");
  }
  if (got.error) {
    return NextResponse.json({ error: got.error.message }, { status: 500 });
  }
  const rows = (got.data ?? []) as unknown as {
    id: string; label: string; is_vacant: boolean; monthly_rent: number | null;
    map_x?: number | null; map_y?: number | null; map_rot?: number | null;
    home_kind?: "poh" | "toh" | "ioh" | "none" | null;
    we_manage?: boolean | null;
    park_use?: "to_sell" | "we_rent" | "not_home" | null;
    tenant_rent_cents?: number | null;
    lat?: number | null; lng?: number | null;
  }[];
  const unitIds = rows.map((u) => u.id);

  // Who owns the home on each pad: the sale that has not ended. One query for
  // the park, matched up here, rather than a query per lot.
  const owners = new Map<string, Record<string, unknown>>();
  if (unitIds.length) {
    const sales = await supabase.from("home_sales")
      .select("unit_id, sold_on, price_cents, financed, monthly_cents, home_year, home_make, home_serial, owners(id, name)")
      .in("unit_id", unitIds).is("ended_on", null);
    if (sales.error && !missing(sales.error)) {
      console.error("reading home sales failed", sales.error);
    }
    for (const s of sales.data ?? []) {
      const o = s.owners as unknown as { id: string; name: string } | null;
      owners.set(s.unit_id as string, {
        ownerId: o?.id ?? null,
        owner: o?.name ?? null,
        soldOn: s.sold_on,
        priceCents: s.price_cents,
        financed: s.financed,
        monthlyCents: s.monthly_cents,
        homeYear: s.home_year,
        homeMake: s.home_make,
        homeSerial: s.home_serial,
      });
    }
  }

  // Who lives there. A pad can have a home nobody is in -- an investor's
  // empty rental is a different thing from a bare pad, and the plan should
  // not render them the same colour.
  const tenants = new Map<string, string>();
  if (unitIds.length) {
    const { data: people } = await supabase.from("contacts")
      .select("unit_id, full_name, phone, party")
      .in("unit_id", unitIds).eq("party", "current_tenant");
    for (const p of people ?? []) {
      if (p.unit_id) tenants.set(p.unit_id as string, p.full_name || p.phone || "Tenant");
    }
  }

  return NextResponse.json({
    property: { id: property.id, name: property.name, kind: property.kind },
    pending,
    lots: rows.map((u) => ({
      id: u.id,
      label: u.label,
      lat: u.lat === null || u.lat === undefined ? null : Number(u.lat),
      lng: u.lng === null || u.lng === undefined ? null : Number(u.lng),
      x: u.map_x ?? null,
      y: u.map_y ?? null,
      rot: u.map_rot ?? 0,
      kind: u.home_kind ?? null,
      manage: Boolean(u.we_manage),
      // Of the homes we still own, which are stock. Null before 033,
      // and the tally says so rather than counting the laundry.
      use: u.park_use ?? null,
      tenantRent: u.tenant_rent_cents ?? null,
      vacant: u.is_vacant,
      rent: u.monthly_rent,
      tenant: tenants.get(u.id) ?? null,
      sale: owners.get(u.id) ?? null,
    })),
  });
}

/**
 * Changing the plan: laying a street out, moving a pad, adding one.
 *
 * Writes go through the service role AFTER the read above has established
 * through the user's own client that this person may see the property. The
 * alternative is a second set of rules that drifts away from the first.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { data: property } = await supabase
    .from("properties").select("id").eq("id", id).maybeSingle();
  if (!property) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();

  // --- lay out a street in one go ---
  if (body.action === "row") {
    const count = Number(body.count);
    if (!Number.isFinite(count) || count < 1 || count > 200) {
      return NextResponse.json({ error: "between 1 and 200 pads" }, { status: 400 });
    }
    const from = { x: clamp(Number(body.fromX)), y: clamp(Number(body.fromY)) };
    const to = { x: clamp(Number(body.toX)), y: clamp(Number(body.toY)) };
    const lots = layRow({
      count: Math.floor(count),
      startAt: Math.floor(Number(body.startAt) || 1),
      step: Math.floor(Number(body.step) || 1),
      from, to,
      // Taken from the street unless somebody overrode it, because homes face
      // the road and the road is the line the row follows.
      rot: Number.isFinite(Number(body.rot)) ? Number(body.rot) : angleOf(from, to),
    });

    // A label that already exists is MOVED, not duplicated. Re-laying a
    // street after getting the ends wrong is the normal case, and a second
    // lot 3107 would be a data problem created by a drawing mistake.
    const { data: existing } = await db.from("units")
      .select("id, label").eq("property_id", id);
    const byLabel = new Map((existing ?? []).map((u) => [String(u.label), u.id as string]));

    const made: string[] = [];
    for (const lot of lots) {
      const known = byLabel.get(lot.label);
      if (known) {
        const { error } = await db.from("units")
          .update({ map_x: lot.x, map_y: lot.y, map_rot: lot.rot }).eq("id", known);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { error } = await db.from("units").insert({
          property_id: id, label: lot.label,
          map_x: lot.x, map_y: lot.y, map_rot: lot.rot,
          is_vacant: true,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        made.push(lot.label);
      }
    }

    await db.from("properties").update({ map_kind: "plan" }).eq("id", id);
    return NextResponse.json({ ok: true, placed: lots.length, created: made.length });
  }

  // --- nudge one pad ---
  if (body.action === "move") {
    const patch: Record<string, number> = {};
    if (body.x !== undefined) patch.map_x = clamp(Number(body.x));
    if (body.y !== undefined) patch.map_y = clamp(Number(body.y));
    if (body.rot !== undefined) patch.map_rot = Math.round(Number(body.rot));
    const { error } = await db.from("units")
      .update(patch).eq("id", String(body.unitId)).eq("property_id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // --- one more pad, where they clicked ---
  if (body.action === "add") {
    const label = String(body.label ?? "").trim();
    if (!label) return NextResponse.json({ error: "give it a number" }, { status: 400 });
    const { error } = await db.from("units").insert({
      property_id: id, label,
      map_x: clamp(Number(body.x)), map_y: clamp(Number(body.y)),
      map_rot: Math.round(Number(body.rot) || 0),
      is_vacant: true,
    });
    if (error) {
      // The unique index on (property_id, label) is doing its job.
      return NextResponse.json({
        error: /duplicate|unique/i.test(error.message)
          ? `There is already a lot ${label} here.` : error.message,
      }, { status: 400 });
    }
    await db.from("properties").update({ map_kind: "plan" }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  // --- a home put somewhere by hand ---
  //
  // Written to the database rather than to the browser. These are
  // corrections somebody made by dragging fifty one pads into place, and
  // keeping them in local storage meant they lived on one machine, in
  // one browser, until something cleared it -- which is what happened.
  //
  // Stored as the pad's own position, not as an offset from where the
  // layout put it, so that changing the layout cannot move a corrected
  // home. A correction is a statement about the ground.
  if (body.action === "place") {
    const label = String(body.label ?? "").trim();
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!label) return NextResponse.json({ error: "which lot" }, { status: 400 });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)
        || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ error: "that is not a place" }, { status: 400 });
    }
    // The rows that were actually written come back, because an update
    // against a label no lot carries succeeds and changes nothing. A
    // caller that treats that as saved will throw away the only other
    // copy of the correction.
    const { data, error } = await db.from("units")
      .update({ lat, lng }).eq("property_id", id).eq("label", label)
      .select("id");
    if (error) {
      return NextResponse.json({
        error: missing(error)
          ? "Migration 024 hasn't been run, so there is nowhere to keep this."
          : error.message,
      }, { status: 400 });
    }
    if (!data?.length) {
      return NextResponse.json({
        error: `There is no lot ${label} here yet, so there is nothing to move.`,
      }, { status: 404 });
    }
    return NextResponse.json({ ok: true, hit: data.length });
  }

  // --- put a home back where the layout wants it ---
  if (body.action === "unplace") {
    const labels: unknown[] = Array.isArray(body.labels) ? body.labels : [];
    const q = db.from("units").update({ lat: null, lng: null }).eq("property_id", id);
    const { error } = labels.length
      ? await q.in("label", labels.map((l) => String(l)))
      : await q.not("lat", "is", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // --- the whole park at once ---
  //
  // Fifty one lots typed in one at a time is an afternoon, and an afternoon
  // nobody spends, so the park sits empty and the map has nothing to say
  // about any of it. The plan already knows every number; this writes them.
  // Only the columns that exist before 024 are named, so seeding works on a
  // database where the layout migrations have not been run yet.
  if (body.action === "seed") {
    const given: unknown[] = Array.isArray(body.labels) ? body.labels : [];
    const labels = [...new Set(
      given.map((l) => String(l ?? "").trim()).filter(Boolean),
    )];
    if (!labels.length) return NextResponse.json({ error: "nothing to add" }, { status: 400 });

    const { data: have } = await db.from("units")
      .select("label").eq("property_id", id);
    const known = new Set((have ?? []).map((u: { label: string }) => u.label));
    const fresh = labels.filter((l) => !known.has(l));
    if (!fresh.length) return NextResponse.json({ ok: true, added: 0 });

    const { error } = await db.from("units").insert(
      fresh.map((label) => ({ property_id: id, label, is_vacant: true })),
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await db.from("properties").update({ map_kind: "plan" }).eq("id", id);
    return NextResponse.json({ ok: true, added: fresh.length });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
