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
/**
 * WHICH HOMES A STRANGER IS OFFERED, and it was the wrong question.
 *
 * This asked `is_vacant`, which is RENT MANAGER'S answer: no lease on the
 * unit. The office's answer is `units.listing`, set on the Properties page
 * (migration 052), and the two are not the same question at all -- a park
 * bought last month is fifty "vacancies" with no home on any of them, and a
 * home being turned around is advertised weeks before its lease ends.
 *
 * On 17 November the numbers were: Rent Manager called ONE unit vacant, the
 * office was advertising SIX for rent and SEVEN upcoming -- and the one
 * vacant unit was not among them. So the public application page offered a
 * stranger the single home nobody was advertising and none of the six that
 * were, which is a leasing funnel with nothing in it by construction.
 *
 * The same distinction the morning report already makes, and the same shape
 * as the crew clock's "which job are you on": a list keyed on the narrower
 * question looks complete and is empty.
 */
export default async function Apply() {
  const { data: units } = await supabaseAdmin()
    .from("units")
    .select("id, label, bedrooms, monthly_rent, available_on, listing, properties(name, address)")
    .in("listing", ["for_rent", "upcoming"])
    .order("monthly_rent");

  const homes = (units ?? []).map((u) => {
    const p = u.properties as unknown as { name: string; address: string | null };
    return {
      id: u.id,
      label: `${p.name}${u.label ? ` — ${u.label}` : ""}`,
      address: p.address,
      bedrooms: u.bedrooms,
      rent: u.monthly_rent ? Number(u.monthly_rent) : null,
      /* A home that is coming up is worth applying for and must say so. An
         `available_on` of null on an upcoming home reads as "available now"
         and is the sort of thing somebody gives notice over. */
      availableOn: u.available_on,
      upcoming: u.listing === "upcoming",
    };
  });

  return <ApplyForm homes={homes} />;
}
