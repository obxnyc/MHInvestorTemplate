import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The LLCs that hold the property.
 *
 *  Tolerant of migration 017 not having run: returns an empty list rather than
 *  failing, so the properties screen still works and simply does not offer an
 *  owner to file things under. */
export async function GET() {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("owners").select("id, name, legal_name, kind").eq("active", true).order("name");

  /* `kind` arrives with migration 050. Before it has been run the column
     is not there and the select fails -- which must not empty a list
     that worked yesterday, so it falls back and everybody reads as an
     investor, which is exactly what they were before the column
     existed. */
  const fell = error
    ? await supabase.from("owners").select("id, name, legal_name")
        .eq("active", true).order("name")
    : null;
  const kinds = !error;
  const rows = (error ? (fell?.data ?? []) : (data ?? [])) as
    { id: string; name: string; legal_name: string | null; kind?: string }[];
  const broken = error && fell?.error;
  const owners = broken ? [] : rows;

  // What each one holds, which a dropdown never needed and a list of
  // investors is unreadable without: two rows reading "Larabee Homes LLC"
  // say nothing about which of them has the eight homes on it.
  //
  // Asked for in its own request rather than as an embed from owners,
  // because home_sales arrives with migration 031 and owners with 017 --
  // an embed naming a table that is not there fails the whole request and
  // the dropdown that depends on this would go empty with it.
  const held = new Map<string, { homes: number; owesCents: number; parks: Set<string> }>();
  let holdings = false;
  if (!broken && owners.length) {
    type Row = {
      owner_id: string | null;
      monthly_cents?: number | null;
      lot_rent_cents?: number | null;
      management_cents?: number | null;
      warranty_cents?: number | null;
      units?: { properties?: { name?: string | null } | null } | null;
    };
    const rich = await supabase.from("home_sales")
      .select("owner_id, monthly_cents, lot_rent_cents, management_cents, warranty_cents, units(properties(name))")
      .is("ended_on", null);
    const got = rich.error
      ? await supabase.from("home_sales")
          .select("owner_id, monthly_cents, units(properties(name))")
          .is("ended_on", null)
      : rich;
    if (!got.error) {
      holdings = true;
      for (const r of (got.data ?? []) as unknown as Row[]) {
        const who = r.owner_id;
        if (!who) continue;
        const run = held.get(who)
          ?? { homes: 0, owesCents: 0, parks: new Set<string>() };
        run.homes += 1;
        run.owesCents += (r.monthly_cents ?? 0) + (r.lot_rent_cents ?? 0)
          + (r.management_cents ?? 0) + (r.warranty_cents ?? 0);
        const park = r.units?.properties?.name;
        if (park) run.parks.add(park);
        held.set(who, run);
      }
    }
  }

  /* WHERE EACH ONE'S PAPERS STAND. Until now the only way to find out
     whether somebody had signed was to open their page -- so a list of
     six investors said nothing at all about the one thing you check a
     list of investors FOR.

     Its own request again, and tolerated when it fails: signing_requests
     arrives with migration 048, and an embed naming a table that is not
     there would take the whole list down with it.

     Newest first and the first one wins, because what matters is where
     the LATEST pack stands -- an old withdrawn one does not describe
     where a deal is. A withdrawn pack with nothing after it is skipped
     rather than reported, for the same reason: it is not a state the
     deal is in, it is a thing that was undone. */
  const paper = new Map<string, { state: string; at: string }>();
  let papers = false;
  if (!broken && owners.length) {
    type Pack = {
      owner_id: string | null; sent_at: string; expires_at: string;
      opened_at: string | null; signed_at: string | null;
      voided_at: string | null;
    };
    const got = await supabase.from("signing_requests")
      .select("owner_id, sent_at, expires_at, opened_at, signed_at, voided_at")
      .order("sent_at", { ascending: false });
    if (!got.error) {
      papers = true;
      for (const r of (got.data ?? []) as Pack[]) {
        if (!r.owner_id || paper.has(r.owner_id) || r.voided_at) continue;
        paper.set(r.owner_id, {
          state: r.signed_at ? "signed"
            : Date.parse(r.expires_at) < Date.now() ? "expired"
            : r.opened_at ? "opened" : "sent",
          at: r.signed_at ?? r.opened_at ?? r.sent_at,
        });
      }
    }
  }

  return NextResponse.json({
    owners: owners.map((o) => {
      const run = held.get(o.id);
      const pack = paper.get(o.id);
      return {
        ...o,
        homes: run?.homes ?? 0,
        owesCents: run?.owesCents ?? 0,
        parks: run ? [...run.parks].sort() : [],
        /* Null is "nothing has gone out", which is a different answer
           from "we cannot tell" -- see `papers` below. */
        papers: pack?.state ?? null,
        papersAt: pack?.at ?? null,
        /* Three different things were sharing this list: somebody who
           buys homes from us, somebody who owns their own home on one of
           our lots, and one of our own companies. */
        kind: o.kind ?? "investor",
      };
    }),
    configured: !broken,
    /* Whether the kinds could be read, as opposed to everybody really
       being an investor -- the same pair as `holdings` and `papers`. */
    kinds,
    /* Whether signing could be read at all, so the list can say nothing
       rather than draw every investor as never having been sent
       anything. */
    papers,
    // Whether the holdings were readable at all, so a screen can say "not
    // recorded" rather than drawing every investor as holding nothing.
    holdings,
  });
}

export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { name, legalName } = await req.json().catch(() => ({}));
  const label = String(name ?? "").trim();
  if (label.length < 2) {
    return NextResponse.json({ error: "Give it a name." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin().from("owners").insert({
    name: label,
    legal_name: String(legalName ?? "").trim() || null,
  }).select("id, name").single();

  if (error) {
    // 42P01 is "no such table", which here means one thing only: migration 017
    // has not been run. Saying that is the difference between a five-minute
    // fix and an afternoon staring at a dropdown that will not fill.
    const why = error.code === "23505"
      ? "There is already an owner by that name."
      : error.code === "42P01" || /schema cache|does not exist/i.test(error.message)
        ? "Owners need migration 017 run on the database first."
        : error.message;
    return NextResponse.json({ error: why }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...data });
}

/**
 * Move somebody between investor, resident and one of ours.
 *
 * Twenty of the fifty-nine names on that list were never investors --
 * residents who own their own home on one of our lots, and our own
 * companies. Every one of them had to be read out to me and set by hand,
 * which is the shape of a job that belongs on the screen.
 *
 * It changes a label and nothing else: no sale, no lot, no money moves,
 * and nothing is deleted. Reversible by pressing the other chip.
 */
export async function PATCH(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as
    { id?: unknown; kind?: unknown };
  const id = String(body.id ?? "").trim();
  const kind = String(body.kind ?? "").trim();
  if (!id) return NextResponse.json({ error: "which owner?" }, { status: 400 });
  /* Checked here as well as by the constraint, so a typo comes back as a
     sentence rather than as a Postgres violation. */
  if (!["investor", "resident", "ours"].includes(kind)) {
    return NextResponse.json(
      { error: "An owner is an investor, a resident, or one of ours." },
      { status: 400 });
  }

  const { data, error } = await supabaseAdmin().from("owners")
    .update({ kind }).eq("id", id).select("id, name, kind").maybeSingle();

  if (error) {
    const why = /column .*kind|schema cache|does not exist/i.test(error.message)
      ? "Sorting owners into investors and residents needs migration 050"
        + " run on the database first."
      : error.message;
    return NextResponse.json({ error: why }, { status: 400 });
  }
  if (!data) return NextResponse.json({ error: "no such owner" }, { status: 404 });
  return NextResponse.json({ ok: true, ...data });
}
