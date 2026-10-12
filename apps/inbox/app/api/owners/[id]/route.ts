import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The shape Postgres uses to say a column is not there. */
const missing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "42P01"
    || /does not exist/i.test(e.message ?? ""));

/**
 * One investor, and every home they own.
 *
 * Across parks, not within one: an investor who holds four at Cross
 * Creek and eight at Northside is one relationship and one conversation,
 * and the question "what do they own" has never had a screen that could
 * answer it. The sale terms come with each home, because the papers are
 * generated from them and so is what they are owed every month.
 *
 * Live holdings only -- a sale that has ended is a home they used to
 * own, and a lease for it would be wrong paper.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();

  const who = await supabase
    .from("owners").select("id, name, legal_name, notes").eq("id", id).maybeSingle();
  if (who.error) {
    return NextResponse.json({ error: who.error.message }, { status: 400 });
  }
  if (!who.data) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Asked for in descending order of how much the database might have, so
  // a park on a server where 032 and 034 have not been run still opens.
  const UNIT = "units(id, label, property_id, properties(id, name, address))";
  const CORE = "id, sold_on, price_cents, down_cents, financed, monthly_cents,"
    + " rate_bps, term_months, first_due_on, home_year, home_make, home_serial,"
    + " ended_on, note";
  const MONEY = `${CORE}, lot_rent_cents, management_cents, warranty_cents,`
    + ` tenant_rent_cents, pet_fee_cents, late_fee_cents, owner_insures, ${UNIT}`;
  const LESS = `${CORE}, lot_rent_cents, management_cents, warranty_cents,`
    + ` tenant_rent_cents, pet_fee_cents, late_fee_cents, ${UNIT}`;
  const PLAIN = `${CORE}, ${UNIT}`;

  const read = (cols: string) => supabase
    .from("home_sales").select(cols)
    .eq("owner_id", id).is("ended_on", null)
    .order("sold_on", { ascending: false });

  let got = await read(MONEY);
  let money = true;
  if (got.error && missing(got.error)) { money = false; got = await read(LESS); }
  if (got.error && missing(got.error)) { got = await read(PLAIN); }
  if (got.error) {
    return NextResponse.json({ error: got.error.message }, { status: 400 });
  }

  type Row = Record<string, unknown> & {
    units?: {
      id: string; label: string; property_id: string;
      properties?: { id: string; name: string; address: string | null } | null;
    } | null;
  };

  const homes = ((got.data ?? []) as unknown as Row[]).map((r) => {
    const unit = r.units ?? null;
    const park = unit?.properties ?? null;
    return {
      saleId: String(r.id),
      unitId: unit?.id ?? null,
      lot: unit?.label ?? "",
      parkId: park?.id ?? unit?.property_id ?? null,
      parkName: park?.name ?? "",
      parkAddress: park?.address ?? null,
      soldOn: r.sold_on ?? null,
      priceCents: Number(r.price_cents ?? 0),
      downCents: Number(r.down_cents ?? 0),
      financed: Boolean(r.financed),
      monthlyCents: r.monthly_cents == null ? null : Number(r.monthly_cents),
      rateBps: r.rate_bps == null ? null : Number(r.rate_bps),
      termMonths: r.term_months == null ? null : Number(r.term_months),
      firstDueOn: r.first_due_on ?? null,
      homeYear: r.home_year == null ? null : Number(r.home_year),
      homeMake: r.home_make ?? null,
      homeSerial: r.home_serial ?? null,
      lotRentCents: r.lot_rent_cents == null ? null : Number(r.lot_rent_cents),
      consultingCents: r.management_cents == null ? null : Number(r.management_cents),
      warrantyCents: r.warranty_cents == null ? null : Number(r.warranty_cents),
      tenantRentCents: r.tenant_rent_cents == null ? null : Number(r.tenant_rent_cents),
      lateFeeCents: r.late_fee_cents == null ? null : Number(r.late_fee_cents),
      ownerInsures: r.owner_insures == null ? null : Boolean(r.owner_insures),
      note: r.note ?? null,
    };
  });

  // Sorted the way somebody reads them: by park, then by lot, with lot
  // numbers compared as numbers so 9 comes before 10.
  homes.sort((a, b) => a.parkName.localeCompare(b.parkName)
    || String(a.lot).localeCompare(String(b.lot), undefined, { numeric: true }));

  return NextResponse.json({ owner: who.data, homes, money });
}
