import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/** The screening criteria, in public, with the date they took effect.
 *
 *  Declined applicants are sent here by name, so this page 404-ing would make
 *  the decline letter worse than useless. It is also the cheapest fair-housing
 *  defence available: a dated, published, consistently applied standard that
 *  anyone can read, next to an audit log showing it was applied the same way
 *  every time.
 *
 *  It renders the ruleset the database is actually using rather than a copy
 *  written by hand. A criteria page that has drifted from the rules being
 *  applied is evidence against you, not for you. */

type Criterion = { key: string; label: string; pass: string; marginal: string; explain: string };
type Rules = { version: number; guarantor_rescues?: string[]; criteria: Criterion[] };

const asOf = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US",
    { year: "numeric", month: "long", day: "numeric" });

export default async function Criteria() {
  const db = supabaseAdmin();
  const { data: rs } = await db
    .from("prequal_rule_sets")
    .select("version, criteria, effective_from")
    .is("effective_to", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Never invent criteria. If the ruleset cannot be read, say so plainly and
  // give people a way to ask -- a made-up standard on this page is exactly the
  // inconsistency the page exists to disprove.
  if (!rs) {
    return (
      <main className="crit">
        <h1>Rental criteria</h1>
        <p>Our criteria are temporarily unavailable. Please call the office and
        we will go through them with you.</p>
      </main>
    );
  }

  const rules = rs.criteria as Rules;
  const rescues = new Set(rules.guarantor_rescues ?? []);

  return (
    <main className="crit">
      <h1>Rental criteria</h1>
      <p className="lede">
        These are the standards we apply to every application for a home at
        Larabee Homes, in the same way for everyone. They took effect on{" "}
        <strong>{asOf(rs.effective_from)}</strong>.
      </p>

      <ol className="crules">
        {rules.criteria.map((c) => (
          <li key={c.key}>
            <h2>{c.label}</h2>
            <p>For an automatic showing, {c.explain}.</p>
            <p className="sub">
              Applications close to that standard go to a person for review
              rather than being turned down automatically.
              {rescues.has(c.key) &&
                " If you can offer a guarantor, that also moves this to review."}
            </p>
          </li>
        ))}
      </ol>

      <h2>How income is counted</h2>
      <p>
        We count the income of everyone who would live in the home, including
        wages, benefits, child support, disability, retirement income and
        housing assistance. We do not treat any lawful source of income
        differently from any other.
      </p>
      <p>
        Where a housing voucher or other assistance pays part of the rent, we
        apply the income test to <strong>the portion you would actually
        pay</strong>, not to the full contract rent.
      </p>

      <h2>If we cannot offer you a home</h2>
      <p>
        We will tell you which standard was not met and you are welcome to ask
        us to look again — particularly if something on your record is wrong,
        out of date, or does not belong to you. Homes come available regularly,
        and you are welcome to apply again.
      </p>

      <h2>Equal housing</h2>
      <p>
        Larabee Homes does business in accordance with the Fair Housing Act. We
        do not discriminate on the basis of race, color, religion, sex, national
        origin, familial status, or disability. If you need a reasonable
        accommodation at any point in this process, including with this form,
        tell us and we will arrange one.
      </p>

      <p className="ver">Criteria version {rules.version}, effective{" "}
        {asOf(rs.effective_from)}.</p>
    </main>
  );
}
