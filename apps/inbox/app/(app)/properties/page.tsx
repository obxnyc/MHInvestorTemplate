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
  const FULL = "id, name, address, color, kind, lat, lng, confirmed_at, units(id, label, bedrooms, bathrooms, square_feet, monthly_rent, is_vacant, available_on, home_owner, home_year, home_make, home_serial)";
  const BASE = "id, name, address, color, units(id, label, bedrooms, monthly_rent, is_vacant, available_on)";

  const wide = await supabase.from("properties").select(FULL).order("name");
  const rows = wide.error
    ? (await supabase.from("properties").select(BASE).order("name")).data
    : wide.data;

  type Row = Record<string, unknown> & { units?: unknown };
  const properties: Property[] = ((rows ?? []) as unknown as Row[]).map((p) => ({
    id: String(p.id),
    name: String(p.name),
    address: (p.address as string | null) ?? null,
    color: (p.color as string | null) ?? null,
    kind: ((p.kind as Kind | undefined) ?? "sfh"),
    lat: p.lat === null || p.lat === undefined ? null : Number(p.lat),
    lng: p.lng === null || p.lng === undefined ? null : Number(p.lng),
    confirmed_at: (p.confirmed_at as string | null) ?? null,
    units: (((p.units ?? []) as unknown as Property["units"]) ?? []).map((u) => ({
      ...u,
      // Absent until 016 runs. Defaulted here so the row renders either way.
      bathrooms: u.bathrooms ?? null,
      square_feet: u.square_feet ?? null,
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
                        canEdit={me.role === "admin" || me.role === "office"}
                        canDelete={me.role === "admin"} />;
}
