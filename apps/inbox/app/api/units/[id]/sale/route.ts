import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseMoney } from "@/lib/invoices";
import { signMedia } from "@/lib/media";

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

  // The ownership columns arrive with 031 and what a park-owned home is
  // for, with its rent, arrives with 033. Asked for in that order and
  // tolerantly, so the card still opens on a database that has had
  // neither.
  const UNIT_033 = "id, label, property_id, home_kind, we_manage, park_use,"
    + " tenant_rent_cents, pet_fee_cents, late_fee_cents";
  let unitRow = await supabase.from("units").select(UNIT_033).eq("id", id).maybeSingle();
  let keeps = true;
  if (unitRow.error) {
    keeps = false;
    unitRow = await supabase.from("units")
      .select("id, label, property_id, home_kind, we_manage").eq("id", id).maybeSingle();
  }
  if (unitRow.error) {
    unitRow = await supabase.from("units")
      .select("id, label, property_id").eq("id", id).maybeSingle();
  }
  const unit = unitRow.data as {
    id: string; label: string; property_id: string;
    home_kind?: string | null; we_manage?: boolean | null;
    park_use?: string | null;
    tenant_rent_cents?: number | null;
    pet_fee_cents?: number | null;
    late_fee_cents?: number | null;
  } | null;
  if (!unit) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Everyone who could be the buyer. Owners are records rather than typed
  // names so the same investor across nine lots is one thing and not nine
  // spellings of one thing.
  const { data: owners } = await supabase
    .from("owners").select("id, name").order("name");

  // The whole history of this lot, newest first.
  const WITH_MONEY = "id, sold_on, price_cents, down_cents, financed, monthly_cents, rate_bps, term_months, first_due_on, home_year, home_make, home_serial, ended_on, ended_why, note, lot_rent_cents, management_cents, warranty_cents, tenant_rent_cents, pet_fee_cents, late_fee_cents, owners(id, name)";
  const PLAIN = "id, sold_on, price_cents, down_cents, financed, monthly_cents, rate_bps, term_months, first_due_on, home_year, home_make, home_serial, ended_on, ended_why, note, owners(id, name)";

  // 032's monthly charges, then 030's bare sale. Two shapes, one read,
  // so the caller does not have to know which migrations have been run.
  const history = async (cols: string) => supabase.from("home_sales")
    .select(cols).eq("unit_id", id).order("sold_on", { ascending: false });
  let got = await history(WITH_MONEY);
  let money = true;
  if (got.error) { money = false; got = await history(PLAIN); }
  if (got.error) {
    return NextResponse.json({
      error: "Migration 030 has not been run yet.", pending: true,
    }, { status: 200 });
  }
  const sales = (got.data ?? []) as unknown as Record<string, unknown>[];

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

  // The paperwork on the live sale, with links that work for five
  // minutes. Signed here rather than made public: a bill of sale is a
  // document with somebody's name and figures on it.
  const live = sales.find((x) => !x.ended_on);
  let papers: { id: string; kind: string; name: string | null; path: string;
                signed_on: string | null; url?: string }[] = [];
  if (live) {
    const got2 = await supabase.from("sale_papers")
      .select("id, kind, name, path, signed_on")
      .eq("sale_id", live.id as string).order("added_at");
    if (!got2.error) {
      papers = got2.data ?? [];
      const urls = await signMedia(supabaseAdmin(), papers.map((p) => p.path));
      papers = papers.map((p) => ({ ...p, url: urls.get(p.path) }));
    }
  }

  // The meters and the sheds, which belong to the lot rather than to any
  // one sale and so outlive every owner it has had.
  const meters = await supabase.from("meters")
    .select("id, kind, serial, provider, account_ref, lat, lng, fitted_on, removed_on")
    .eq("unit_id", id).is("removed_on", null).order("kind");
  const storage = await supabase.from("yard_storage")
    .select("id, label, size, monthly_cents, started_on, ended_on")
    .eq("unit_id", id).is("ended_on", null).order("started_on");

  return NextResponse.json({
    unit: {
      id: unit.id, label: unit.label,
      kind: unit.home_kind ?? null, manage: Boolean(unit.we_manage),
      // What a home we still own is for, and what the person living in
      // it pays. Both are the unit's own, because a home we own that we
      // let has no sale for them to hang off -- we are both sides of it.
      use: unit.park_use ?? null,
      rent: {
        tenant: unit.tenant_rent_cents ?? null,
        pet: unit.pet_fee_cents ?? null,
        late: unit.late_fee_cents ?? null,
      },
    },
    keeps,
    owners: owners ?? [],
    sales,
    papers,
    meters: meters.error ? [] : (meters.data ?? []),
    storage: storage.error ? [] : (storage.data ?? []),
    money,
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

  const cents = (v: unknown) => {
    const t = String(v ?? "").trim();
    if (!t) return null;
    return parseMoney(t);
  };

  // --- who owns the home standing here, and do we run it ---
  if (body.action === "kind") {
    const kind = String(body.kind ?? "");
    if (!["poh", "toh", "ioh", "none"].includes(kind)) {
      return NextResponse.json({ error: "pick who owns the home" }, { status: 400 });
    }
    // A home we own is one we manage, and there is nothing to manage on
    // a bare pad. The database says so too; saying it here means the
    // person gets a sentence rather than a constraint violation.
    const manage = kind === "poh" ? true : kind === "none" ? false : Boolean(body.manage);

    // What a park-owned home is for only means anything while we own it.
    // Clearing it on the way out is not tidying: the constraint refuses
    // the change otherwise, so a home sold to its tenant could not be
    // marked as sold while it still said `ours to sell`.
    //
    // And a home that becomes ours is inventory until somebody says it
    // is not, which is the answer that is right far more often.
    const patch: Record<string, unknown> = { home_kind: kind, we_manage: manage };
    if (kind === "poh") {
      const want = String(body.use ?? "");
      patch.park_use = ["to_sell", "we_rent", "not_home"].includes(want) ? want : "to_sell";
    } else {
      patch.park_use = null;
    }

    let got = await db.from("units").update(patch).eq("id", id);
    if (got.error && /park_use/.test(got.error.message)) {
      // 033 not run. The kind still saves; what the home is for waits.
      delete patch.park_use;
      got = await db.from("units").update(patch).eq("id", id);
    }
    if (got.error) {
      return NextResponse.json({
        error: /home_kind|we_manage/.test(got.error.message)
          ? "Migration 031 hasn't been run yet, so there is nowhere to record this."
          : got.error.message,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // --- a home we still own: inventory, a letting, or not a home at all ---
  //
  // The one question the plan screen exists to answer is what is left to
  // sell, and "park owned" was being asked to mean three things at once:
  // a home we will sell, a home we are letting and mean to keep, and the
  // office or the laundry, which was never a home.
  if (body.action === "use") {
    const want = String(body.use ?? "");
    if (!["to_sell", "we_rent", "not_home"].includes(want)) {
      return NextResponse.json({ error: "say what it is for" }, { status: 400 });
    }
    const { error } = await db.from("units").update({ park_use: want }).eq("id", id);
    if (error) {
      return NextResponse.json({
        error: /park_use/.test(error.message)
          ? "Migration 033 hasn't been run yet, so there is nowhere to record this."
          : /violates check/.test(error.message)
            ? "Only a home we own can be marked this way."
            : error.message,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // --- what the tenant of a home WE own pays ---
  //
  // Separate from the `money` action, which writes to the sale. A home we
  // own and let has no sale: there is no second party to charge lot rent
  // to and no management fee to take from ourselves. The rent is the only
  // money there is, and it belongs to the unit.
  if (body.action === "rent") {
    const { error } = await db.from("units").update({
      tenant_rent_cents: cents(body.tenantRent),
      pet_fee_cents: cents(body.petFee),
      late_fee_cents: cents(body.lateFee),
    }).eq("id", id);
    if (error) {
      return NextResponse.json({
        error: /tenant_rent_cents|pet_fee_cents|late_fee_cents/.test(error.message)
          ? "Migration 033 hasn't been run yet, so there is nowhere to keep the rent."
          : error.message,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // --- what this owner and their tenant pay every month ---
  if (body.action === "money") {
    const { data: live } = await db.from("home_sales")
      .select("id").eq("unit_id", id).is("ended_on", null).maybeSingle();
    if (!live) {
      return NextResponse.json({
        error: "Record who owns the home first — the charges hang off the sale.",
      }, { status: 400 });
    }
    const patch = {
      lot_rent_cents: cents(body.lotRent),
      management_cents: cents(body.management),
      warranty_cents: cents(body.warranty),
      tenant_rent_cents: cents(body.tenantRent),
      pet_fee_cents: cents(body.petFee),
      late_fee_cents: cents(body.lateFee),
    };
    const { error } = await db.from("home_sales").update(patch).eq("id", live.id);
    if (error) {
      return NextResponse.json({
        error: /lot_rent|management_cents|warranty|tenant_rent|pet_fee|late_fee/.test(error.message)
          ? "Migration 032 hasn't been run yet, so there is nowhere to record the charges."
          : error.message,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // --- a document filed against the sale ---
  if (body.action === "paper") {
    const { data: live } = await db.from("home_sales")
      .select("id").eq("unit_id", id).is("ended_on", null).maybeSingle();
    if (!live) {
      return NextResponse.json({
        error: "Record who owns the home first — papers are filed against the sale.",
      }, { status: 400 });
    }
    const kind = String(body.kind ?? "other");
    const path = String(body.path ?? "").trim();
    // The file has to be one this route put in this lot's folder. Taking
    // a path from the browser without checking it would let anybody read
    // any file in the bucket by filing it against their own sale.
    if (!path.startsWith(`units/${id}/`) || path.includes("..")) {
      return NextResponse.json({ error: "that file isn't on this lot" }, { status: 400 });
    }
    const { error } = await db.from("sale_papers").insert({
      sale_id: live.id, kind,
      path, name: String(body.name ?? "").trim() || null,
      signed_on: body.signedOn || null,
      added_by: staff.id,
    });
    if (error) {
      return NextResponse.json({
        error: /duplicate|unique/.test(error.message)
          ? "That file is already filed against this sale."
          : /sale_papers/.test(error.message)
          ? "Migration 032 hasn't been run yet."
          : error.message,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }
  if (body.action === "unpaper") {
    const { error } = await db.from("sale_papers")
      .delete().eq("id", String(body.paperId ?? ""));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // --- a meter ---
  if (body.action === "meter") {
    const kind = String(body.kind ?? "");
    if (!["water", "electric", "gas"].includes(kind)) {
      return NextResponse.json({ error: "water, electric or gas" }, { status: 400 });
    }
    // One live meter of each kind, which the database enforces. The old
    // one is taken out rather than overwritten, so its number stays
    // readable next to the bill that was argued about.
    await db.from("meters").update({ removed_on: new Date().toISOString().slice(0, 10) })
      .eq("unit_id", id).eq("kind", kind).is("removed_on", null);
    const { error } = await db.from("meters").insert({
      unit_id: id, kind,
      serial: String(body.serial ?? "").trim() || null,
      provider: String(body.provider ?? "").trim() || null,
      account_ref: String(body.account ?? "").trim() || null,
      fitted_on: body.fittedOn || null,
    });
    if (error) {
      return NextResponse.json({
        error: /meters/.test(error.message)
          ? "Migration 031 hasn't been run yet." : error.message,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // --- a shed in the yard ---
  if (body.action === "storage") {
    const monthly = cents(body.monthly);
    if (monthly === null) {
      return NextResponse.json({ error: "What does it cost a month?" }, { status: 400 });
    }
    const { error } = await db.from("yard_storage").insert({
      unit_id: id,
      label: String(body.label ?? "").trim() || null,
      size: String(body.size ?? "").trim() || null,
      monthly_cents: monthly,
      created_by: staff.id,
    });
    if (error) {
      return NextResponse.json({
        error: /yard_storage/.test(error.message)
          ? "Migration 031 hasn't been run yet." : error.message,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }
  if (body.action === "unstorage") {
    const { error } = await db.from("yard_storage")
      .update({ ended_on: new Date().toISOString().slice(0, 10) })
      .eq("id", String(body.storageId ?? ""));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

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
