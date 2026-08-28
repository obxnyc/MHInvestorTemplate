import { supabaseAdmin } from "@/lib/supabase-admin";
import ApplyForm from "@/components/ApplyForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Check if you prequalify — Larabee Homes" };

/**
 * Public. Deliberately asks NOTHING that invites a protected-class disclosure:
 * no questions about children, marital status, disability, national origin or
 * religion. Every field here maps to a published criterion, which is what makes
 * the process defensible — and what stops a reviewer from being influenced by
 * information they should never have had.
 */
export default async function Apply() {
  const { data: units } = await supabaseAdmin()
    .from("units")
    .select("id, label, bedrooms, monthly_rent, available_on, properties(name, address)")
    .eq("is_vacant", true)
    .order("monthly_rent");

  const homes = (units ?? []).map((u) => {
    const p = u.properties as unknown as { name: string; address: string | null };
    return {
      id: u.id,
      label: `${p.name}${u.label ? ` — ${u.label}` : ""}`,
      address: p.address,
      bedrooms: u.bedrooms,
      rent: u.monthly_rent ? Number(u.monthly_rent) : null,
      availableOn: u.available_on,
    };
  });

  return <ApplyForm homes={homes} />;
}
