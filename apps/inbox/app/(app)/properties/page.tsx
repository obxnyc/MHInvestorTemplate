import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import PropertyBoard, { type Property, type Kind } from "@/components/PropertyBoard";

export const dynamic = "force-dynamic";

/** Everything you own, and every lot in it. */
export default async function Properties() {
  const me = await requireStaff();
  if (!me) redirect("/login");

  const supabase = await supabaseServer();

  // The wide select first, the narrow one if that fails.
  //
  // Everything after `color` arrives with migration 016, and one unknown column
  // takes the whole query with it -- which would leave this screen empty until
  // the migration is run, rather than simply showing less. A feature waiting on
  // a migration degrades to being absent; it does not break the page it is on.
  const UNITS = "id, label, bedrooms, bathrooms, square_feet, monthly_rent, is_vacant, available_on, home_owner, home_year, home_make, home_serial";
  const CLOCK = ", vacant_since, vacant_since_estimated, blocker";
  const HEAD = "id, name, address, color, code, owner_id, owners(name), kind, lat, lng, confirmed_at";

  // Three tiers rather than two, and the reason is worth keeping.
  //
  // The vacancy clock arrives with 037, and bolting it onto the wide select
  // would have meant a database without that migration failing the wide query
  // and falling all the way back to the narrow one -- losing the serial
  // number, the make and the year along with it. One missing column would
  // have taken away six working features instead of the one it belongs to.
  const FULL = `${HEAD}, units(${UNITS}${CLOCK})`;
  const WIDE = `${HEAD}, units(${UNITS})`;
  const BASE = "id, name, address, color, units(id, label, bedrooms, monthly_rent, is_vacant, available_on)";

  // Typed loosely on purpose. Each tier returns a different row shape and the
  // mapping below reads every field defensively anyway, which is the whole
  // point of having tiers.
  const tiers = [FULL, WIDE, BASE];
  let rows: unknown[] | null = null;
  let answered = tiers.length;            // which tier came back
  for (let i = 0; i < tiers.length; i++) {
    const got = await supabase.from("properties").select(tiers[i]).order("name");
    if (!got.error) { rows = got.data as unknown[]; answered = i; break; }
  }
  // Two different questions, and asking one of them for the other is the
  // mistake this codebase keeps making. `ready` asks whether 016 and 017 are
  // real -- both wide tiers name those columns. `clock` asks whether 037 is,
  // which only the first tier does. A screen with the clock missing has to
  // say so rather than draw every lot as empty since today.
  const ready = answered <= 1;
  const clock = answered === 0;

  type Row = Record<string, unknown> & { units?: unknown };
  const properties: Property[] = ((rows ?? []) as unknown as Row[]).map((p) => ({
    id: String(p.id),
    name: String(p.name),
    address: (p.address as string | null) ?? null,
    color: (p.color as string | null) ?? null,
    code: (p.code as string | null) ?? null,
    ownerId: (p.owner_id as string | null) ?? null,
    owner: (p.owners as { name: string } | null)?.name ?? null,
    kind: ((p.kind as Kind | undefined) ?? "sfh"),
    lat: p.lat === null || p.lat === undefined ? null : Number(p.lat),
    lng: p.lng === null || p.lng === undefined ? null : Number(p.lng),
    confirmed_at: (p.confirmed_at as string | null) ?? null,
    units: (((p.units ?? []) as unknown as Property["units"]) ?? []).map((u) => ({
      ...u,
      // Absent until 016 runs. Defaulted here so the row renders either way.
      bathrooms: u.bathrooms ?? null,
      square_feet: u.square_feet ?? null,
      // Absent until 037 runs, and absent is its own answer: no clock at all
      // reads differently from a clock at zero, so neither is invented here.
      vacant_since: u.vacant_since ?? null,
      vacant_since_estimated: u.vacant_since_estimated ?? false,
      blocker: u.blocker ?? null,
      home_owner: u.home_owner ?? "ours",
      home_year: u.home_year ?? null,
      home_make: u.home_make ?? null,
      home_serial: u.home_serial ?? null,
    }))
      // Numeric lots sort as numbers, so lot 10 comes after lot 9 rather than
      // after lot 1. Everything else falls back to plain text.
      .sort((a, b) => {
        const [x, y] = [Number(a.label), Number(b.label)];
        return Number.isFinite(x) && Number.isFinite(y)
          ? x - y : a.label.localeCompare(b.label);
      }),
  }));

  return <PropertyBoard properties={properties}
                        // The wide select succeeding IS the migration check:
                        // it names every column 016 and 017 add, and the join
                        // to the owners table they create. If it came back,
                        // codes and LLCs are real and the screen can offer
                        // them; if it did not, the screen says so rather than
                        // showing a dropdown that cannot be filled.
                        ready={ready}
                        clock={clock}
                        canEdit={me.role === "admin" || me.role === "office"}
                        canDelete={me.role === "admin"} />;
}
