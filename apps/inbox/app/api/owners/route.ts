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
    .from("owners").select("id, name, legal_name").eq("active", true).order("name");

  const owners = (error ? [] : (data ?? [])) as
    { id: string; name: string; legal_name: string | null }[];

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
  if (!error && owners.length) {
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

  return NextResponse.json({
    owners: owners.map((o) => {
      const run = held.get(o.id);
      return {
        ...o,
        homes: run?.homes ?? 0,
        owesCents: run?.owesCents ?? 0,
        parks: run ? [...run.parks].sort() : [],
      };
    }),
    configured: !error,
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
