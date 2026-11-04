import { supabaseAdmin } from "@/lib/supabase-admin";
import ApplyForm, { type Lead } from "@/components/ApplyForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Check if you prequalify — Larabee Homes" };

/**
 * Public. Deliberately asks NOTHING that invites a protected-class disclosure:
 * no questions about children, marital status, disability, national origin or
 * religion. Every field here maps to a published criterion, which is what makes
 * the process defensible — and what stops a reviewer from being influenced by
 * information they should never have had.
 */
export default async function Apply(
  { searchParams }: { searchParams: Promise<{ lead?: string }> },
) {
  const { lead: token } = await searchParams;
  const db = supabaseAdmin();

  // Their own link, from the message the pipeline sent. Unknown or stale
  // tokens fall through to the ordinary form rather than an error page: the
  // questions are public anyway, and a dead end loses a person who wanted in.
  let lead: Lead | null = null;
  if (token) {
    const { data: q } = await db.from("inquiries")
      .select("unit_id, contacts(full_name, email)").eq("prescreen_token", token)
      .eq("outcome", "open").maybeSingle();
    if (q) {
      const c = q.contacts as unknown as { full_name: string | null; email: string | null } | null;
      lead = {
        token,
        name: c?.full_name ?? null,
        email: c?.email && !/@convo\.zillow\.com$/i.test(c.email) ? c.email : null,
        unitId: (q.unit_id as string | null) ?? null,
      };
    }
  }

  const { data: units } = await db
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

  return <ApplyForm homes={homes} lead={lead} />;
}
