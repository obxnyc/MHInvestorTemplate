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
  const WITH_SPEND = "id, sold_on, price_cents, down_cents, financed, monthly_cents, rate_bps, term_months, first_due_on, home_year, home_make, home_serial, ended_on, ended_why, note, lot_rent_cents, management_cents, warranty_cents, tenant_rent_cents, pet_fee_cents, late_fee_cents, owner_insures, owners(id, name)";
  const WITH_MONEY = "id, sold_on, price_cents, down_cents, financed, monthly_cents, rate_bps, term_months, first_due_on, home_year, home_make, home_serial, ended_on, ended_why, note, lot_rent_cents, management_cents, warranty_cents, tenant_rent_cents, pet_fee_cents, late_fee_cents, owners(id, name)";
  const PLAIN = "id, sold_on, price_cents, down_cents, financed, monthly_cents, rate_bps, term_months, first_due_on, home_year, home_make, home_serial, ended_on, ended_why, note, owners(id, name)";

  // 032's monthly charges, then 030's bare sale. Two shapes, one read,
  // so the caller does not have to know which migrations have been run.
  const history = async (cols: string) => supabase.from("home_sales")
    .select(cols).eq("unit_id", id).order("sold_on", { ascending: false });
  // 034's self-insurance flag, then 032's charges, then 030's bare sale.
  let got = await history(WITH_SPEND);
  let money = true;
  let spend = true;
  if (got.error) { spend = false; got = await history(WITH_MONEY); }
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

  // The last sale recorded anywhere in this park, whoever bought it.
  //
  // Ten homes sold on the same terms is ten identical forms, and the
  // buyer-keyed memory above only helps on the second home the SAME
  // investor buys. What repeats is the deal, not the person: the price,
  // the note, the lot fee and the consultancy fee are the park's terms,
  // and typing them out ten times is ten chances to fat-finger a rate.
  //
  // The charges come with it, because those are the ones most likely to
  // be identical and the most tedious to re-enter.
  const LAST = "id, sold_on, price_cents, down_cents, financed, monthly_cents,"
    + " rate_bps, term_months, first_due_on, home_year, home_make,"
    + " lot_rent_cents, management_cents, warranty_cents,"
    + " tenant_rent_cents, pet_fee_cents, late_fee_cents,"
    + " units!inner(label, property_id), owners(id, name)";
  let recent: Record<string, unknown>[] = [];
  {
    // In this park, not in every park. Terms differ between properties
    // and recalling the wrong park's lot fee is worse than typing it.
    const got3 = await supabase.from("home_sales")
      .select(LAST)
      .eq("units.property_id", unit.property_id)
      .neq("unit_id", id)
      .order("sold_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8);
    if (!got3.error) recent = (got3.data ?? []) as unknown as Record<string, unknown>[];
  }
  const lastAny = recent[0] ?? null;

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

  // What we have spent on this home. Against the lot, not the sale, so a
  // water heater fitted in March is still on file when the home changes
  // hands in June -- the sale it was deducted from is its own column.
  const spent = await supabase.from("home_expenses")
    .select("id, sale_id, spent_on, what, amount_cents, from_owner, bills_on, note")
    .eq("unit_id", id).order("spent_on", { ascending: false }).limit(60);

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
    spend,
    expenses: spent.error ? [] : (spent.data ?? []),
    lastFor,
    lastAny,
    // The last few sales in this park, offered whole: ten homes to one
    // investor on one day is one form filled in and nine recalled.
    recent,
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
  // to and no consultancy fee to take from ourselves. The rent is the only
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
    // Their own insurance and a warranty fee cannot both be true, and
    // the database says so. Clearing the fee here means the person gets
    // the answer they chose rather than a constraint violation.
    const insures = Boolean(body.ownerInsures);
    const patch: Record<string, unknown> = {
      lot_rent_cents: cents(body.lotRent),
      management_cents: cents(body.management),
      warranty_cents: insures ? null : cents(body.warranty),
      owner_insures: insures,
      tenant_rent_cents: cents(body.tenantRent),
      pet_fee_cents: cents(body.petFee),
      late_fee_cents: cents(body.lateFee),
    };
    let wrote = await db.from("home_sales").update(patch).eq("id", live.id);
    if (wrote.error && /owner_insures/.test(wrote.error.message)) {
      // 034 not run. The charges still save; the insurance answer waits.
      delete patch.owner_insures;
      patch.warranty_cents = cents(body.warranty);
      wrote = await db.from("home_sales").update(patch).eq("id", live.id);
    }
    if (wrote.error) {
      return NextResponse.json({
        error: /lot_rent|management_cents|warranty|tenant_rent|pet_fee|late_fee/.test(wrote.error.message)
          ? "Migration 032 hasn't been run yet, so there is nowhere to record the charges."
          : wrote.error.message,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // --- something we paid for on this home ---
  //
  // We front it and take it off what we send the owner, so a statement
  // cannot be produced without these. Recorded against the lot, and
  // against the sale it comes off where it comes off one at all.
  if (body.action === "spend") {
    const what = String(body.what ?? "").trim();
    const amount = cents(body.amount);
    if (!what) return NextResponse.json({ error: "say what it was" }, { status: 400 });
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "say what it cost" }, { status: 400 });
    }
    const fromOwner = body.fromOwner === undefined ? true : Boolean(body.fromOwner);

    // A deduction has to name whose cheque it comes off, and the only
    // answer is the owner holding the home now.
    const { data: live } = await db.from("home_sales")
      .select("id").eq("unit_id", id).is("ended_on", null).maybeSingle();
    if (fromOwner && !live) {
      return NextResponse.json({
        error: "Nobody owns this home, so there is nobody to deduct it from. "
             + "Untick \u201ctake it off the owner\u201d to record it as ours.",
      }, { status: 400 });
    }

    const { error } = await db.from("home_expenses").insert({
      unit_id: id,
      sale_id: fromOwner ? live!.id : null,
      what,
      amount_cents: amount,
      from_owner: fromOwner,
      spent_on: String(body.on ?? "").trim() || undefined,
      note: String(body.note ?? "").trim() || null,
      created_by: staff.id,
    });
    if (error) {
      return NextResponse.json({
        error: /home_expenses/.test(error.message)
          ? "Migration 034 hasn't been run yet, so there is nowhere to record this."
          : error.message,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // --- and taking one back off ---
  if (body.action === "unspend") {
    const spendId = String(body.spendId ?? "");
    if (!spendId) return NextResponse.json({ error: "which one" }, { status: 400 });
    const { error } = await db.from("home_expenses")
      .delete().eq("id", spendId).eq("unit_id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
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

  // --- correcting a sale already recorded ---
  //
  // A sale is typed once from a bill of sale and gets a digit wrong, or
  // the rate turns out to be 5.2 and not 5.5. Ending it and recording it
  // again is the wrong shape: that says the home changed hands, which it
  // did not, and it puts a false line in the history. So the live sale
  // is amended in place, and the history keeps saying what happened
  // rather than what was mistyped.
  //
  // Falls through to the same validation as a new sale below, because
  // the rules about a financed sale needing terms do not change just
  // because the row already exists.
  const amending = body.action === "amend";

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
  if (live && !amending) {
    return NextResponse.json({
      error: "This home already has an owner. End that sale first, saying what happened.",
    }, { status: 400 });
  }
  if (amending && !live) {
    return NextResponse.json({
      error: "There is no current sale on this home to change.",
    }, { status: 400 });
  }

  const row: Record<string, unknown> = {
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
  };

  // The monthly charges, where the form sent them. They are set with the
  // sale so that ten homes on the park's standard terms are one form
  // each rather than two, and they are optional so that a database
  // without 032 still takes the sale.
  const charges: Record<string, unknown> = {
    lot_rent_cents: cents(body.lotRent),
    management_cents: cents(body.management),
    warranty_cents: cents(body.warranty),
    tenant_rent_cents: cents(body.tenantRent),
    pet_fee_cents: cents(body.petFee),
    late_fee_cents: cents(body.lateFee),
  };
  const any = Object.values(charges).some((v) => v !== null);

  // On an amend the charges are left alone unless the form sent them,
  // because the charges have their own form on the card and the sale
  // form is not where somebody expects to clear them by omission.
  const write = (cols: Record<string, unknown>) => (amending
    ? db.from("home_sales").update(cols).eq("id", live!.id)
    : db.from("home_sales").insert(cols));

  // `created_by` records who typed it, which stays true of whoever typed
  // it first; an amendment does not rewrite that.
  const base = amending
    ? Object.fromEntries(Object.entries(row).filter(([k]) =>
        k !== "unit_id" && k !== "created_by"))
    : row;

  let put = await write(any ? { ...base, ...charges } : base);
  if (put.error && any && /lot_rent|management_cents|warranty|tenant_rent|pet_fee|late_fee/
      .test(put.error.message)) {
    // 032 not run. The sale is the thing that matters; the charges can
    // be added once the migration is.
    put = await write(base);
  }
  if (put.error) return NextResponse.json({ error: put.error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
