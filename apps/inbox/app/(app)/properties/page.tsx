import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import PropertyBoard, { type Property } from "@/components/PropertyBoard";

export const dynamic = "force-dynamic";

/** Everything you own, and every lot in it. */
export default async function Properties() {
  const me = await requireStaff();
  if (!me) redirect("/login");

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("properties")
    .select("id, name, address, color, units(id, label, bedrooms, monthly_rent, is_vacant, available_on)")
    .order("name");

  const properties: Property[] = (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    address: p.address,
    color: p.color,
    units: ((p.units ?? []) as unknown as Property["units"])
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
