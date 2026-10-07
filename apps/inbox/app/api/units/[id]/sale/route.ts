import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseMoney } from "@/lib/invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who owns the home on this lot, and what they paid.
 *
 * GET also answers the question that makes this bearable to use: what did
 * this buyer agree last time. An investor with nine homes in a park buys the
 * tenth on the same terms as the ninth, and retyping them is both tedious and
 * how a rate ends up different on one lot for no reason anybody can explain
 * two years later.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();

  const { data: unit } = await supabase
    .from("units").select("id, label, property_id").eq("id", id).maybeSingle();
  if (!unit) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Everyone who could be the buyer. Owners are records rather than typed
  // names so the same investor across nine lots is one thing and not nine
  // spellings of one thing.
  const { data: owners } = await supabase
    .from("owners").select("id, name").order("name");

  // The whole history of this lot, newest first.
  const { data: sales, error } = await supabase.from("home_sales")
    .select("id, sold_on, price_cents, down_cents, financed, monthly_cents, rate_bps, term_months, first_due_on, home_year, home_make, home_serial, ended_on, ended_why, note, owners(id, name)")
    .eq("unit_id", id).order("sold_on", { ascending: false });
  if (error) {
    return NextResponse.json({
      error: "Migration 030 has not been run yet.", pending: true,
    }, { status: 200 });
  }

  // What this buyer last agreed, if the caller named one. Not the lot's last
  // sale -- the buyer's -- because the thing being repeated is their deal.
  let lastFor: Record<string, unknown> | null = null;
  const ownerId = new URL(req.url).searchParams.get("owner");
  if (ownerId) {
    const { data: prior } = await supabase.from("home_sales")
      .select("price_cents, down_cents, financed, monthly_cents, rate_bps, term_months")
      .eq("owner_id", ownerId).order("sold_on", { ascending: false }).limit(1).maybeSingle();
    if (prior) lastFor = prior;
  }

  return NextResponse.json({
    unit: { id: unit.id, label: unit.label },
    owners: owners ?? [],
    sales: sales ?? [],
    lastFor,
  });
}

/** Record a sale, or end one. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { data: unit } = await supabase
    .from("units").select("id").eq("id", id).maybeSingle();
  if (!unit) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();

  // --- the home changed hands, or left ---
  if (body.action === "end") {
    const why = String(body.why ?? "").trim();
    if (why.length < 3) {
      return NextResponse.json({
        error: "Say what happened — sold on, taken back, home removed.",
      }, { status: 400 });
    }
    const { error } = await db.from("home_sales")
      .update({ ended_on: body.on || new Date().toISOString().slice(0, 10), ended_why: why })
      .eq("unit_id", id).is("ended_on", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // --- a new owner ---
  const ownerId = String(body.ownerId ?? "").trim();
  if (!ownerId) return NextResponse.json({ error: "pick a buyer" }, { status: 400 });

  const price = parseMoney(String(body.price ?? ""));
  if (price === null) {
    return NextResponse.json({
      error: "That doesn't look like a price. Try something like 42500.",
    }, { status: 400 });
  }
  const down = parseMoney(String(body.down ?? "0")) ?? 0;
  const financed = Boolean(body.financed);
  const monthly = financed ? parseMoney(String(body.monthly ?? "")) : null;
  const termMonths = financed ? Math.floor(Number(body.termMonths) || 0) : null;

  if (financed && (monthly === null || !termMonths)) {
    return NextResponse.json({
      error: "A financed sale needs a monthly payment and a term.",
    }, { status: 400 });
  }

  const soldOn = String(body.soldOn ?? "").trim() || new Date().toISOString().slice(0, 10);

  // The lot can only have one current owner, which the database enforces. If
  // there is one, it has to be ended first -- and saying so is better than
  // letting a unique-index violation reach somebody as a sentence about
  // constraints.
  const { data: live } = await db.from("home_sales")
    .select("id").eq("unit_id", id).is("ended_on", null).maybeSingle();
  if (live) {
    return NextResponse.json({
      error: "This home already has an owner. End that sale first, saying what happened.",
    }, { status: 400 });
  }

  const { error } = await db.from("home_sales").insert({
    unit_id: id,
    owner_id: ownerId,
    sold_on: soldOn,
    price_cents: price,
    down_cents: down,
    financed,
    monthly_cents: monthly,
    rate_bps: body.ratePct ? Math.round(Number(body.ratePct) * 100) : null,
    term_months: termMonths,
    first_due_on: body.firstDueOn || null,
    home_year: body.homeYear ? Math.floor(Number(body.homeYear)) : null,
    home_make: String(body.homeMake ?? "").trim() || null,
    home_serial: String(body.homeSerial ?? "").trim() || null,
    note: String(body.note ?? "").trim() || null,
    created_by: staff.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
