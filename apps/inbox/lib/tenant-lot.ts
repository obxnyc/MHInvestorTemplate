/**
 * Which lot a maintenance request is about, worked out from WHO reported it.
 *
 * THE STATE THIS EXISTS FOR. 315 maintenance requests were on file and two
 * of them knew which home they were about. Every other one sat against
 * nothing, which is why the queue was unusable: a fridge is out somewhere,
 * and nobody can say where without ringing the tenant back.
 *
 * Rent Manager's `/ServiceManagerIssues` carries no PropertyID, UnitID or
 * TenantID, and the Property, Unit and Tenant embeds all 404 on this
 * account. That was measured, not assumed, and it is written down in the
 * working agreements as settled: there is no route from a pulled issue to a
 * lot.
 *
 * That is true of the ISSUE. It is not true of the REQUEST, because 84 of
 * those threads had captured the tenant's own email address, and the
 * portfolio import knows where 308 tenants live. Nobody had put the two
 * together. 61 requests were placed the moment somebody did.
 *
 * WHAT THIS IS NOT. It is not fuzzy matching, for the same reason
 * `matchPlace` is not: **a request filed against the wrong home is worse
 * than one filed against none**, because somebody is sent to a stranger's
 * door. One email on two lots is not a near miss to be broken by a
 * tiebreak; it is a question, and the answer is no.
 */

/** A tenant we know the home of. */
export type RosterRow = {
  email: string | null;
  full_name: string | null;
  unit_id: string;
};

/** Who reported it, as much as the request said. */
export type Reporter = { email?: string | null; name?: string | null };

export type LotMatch = { unitId: string; how: "email" | "name" };

/** One address, in the one shape both sides are compared in. Empty is
 *  EMPTY and never a value: a reporter with no email must not match the
 *  roster rows that also have none, which is the shape of fault that lets
 *  one person's broken boiler be filed against a stranger. */
export function emailKey(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/** A person's name, flattened. Runs of space collapse, case goes. */
export function nameKey(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Whether a name is specific enough to identify anybody.
 *
 *  "Mike" is not. Two parts of at least two letters each is the floor,
 *  because a single given name matches several households in a park of
 *  fifty-nine and matching any of them is worse than matching none. */
export function isFullName(raw: string | null | undefined): boolean {
  const parts = nameKey(raw).split(" ").filter((p) => p.length >= 2);
  return parts.length >= 2;
}

/**
 * The one lot this person lives at, or null.
 *
 * Email first and name second, and the first rule that finds ANYTHING
 * decides -- including deciding the answer is no. Falling through from an
 * ambiguous email to a name match would let the vaguer evidence break a tie
 * the stronger evidence could not, which is exactly the wrong way round and
 * is the same ordering rule `matchPlace` follows.
 */
export function lotForTenant(who: Reporter, roster: RosterRow[]): LotMatch | null {
  const wantEmail = emailKey(who.email);
  if (wantEmail) {
    const hit = unique(roster.filter((r) => emailKey(r.email) === wantEmail));
    /* An email that matched rows is an answer either way: one lot is the
       lot, and two is a question. Neither falls through to the name. */
    if (hit.length) return hit.length === 1 ? { unitId: hit[0]!, how: "email" } : null;
  }

  if (isFullName(who.name)) {
    const wantName = nameKey(who.name);
    const hit = unique(roster.filter((r) => nameKey(r.full_name) === wantName));
    if (hit.length === 1) return { unitId: hit[0]!, how: "name" };
  }

  return null;
}

/** The distinct lots in a set of matches. Two rows for one household --
 *  a tenant and a co-tenant on the same lot -- is one answer, not two. */
function unique(rows: RosterRow[]): string[] {
  return [...new Set(rows.map((r) => r.unit_id))];
}

/* ------------------------------------------------------------- reading it */

/**
 * Ask the database the same question.
 *
 * Only tenants whose home is known are candidates, and the placeholder
 * contacts the pull creates are excluded -- they carry an email and no lot,
 * so leaving them in would let one unplaced request answer for another.
 */
export async function unitFromTenant(
  db: { from: (t: string) => any }, who: Reporter,
): Promise<LotMatch | null> {
  const wantEmail = emailKey(who.email);
  if (!wantEmail && !isFullName(who.name)) return null;

  let q = db.from("contacts")
    .select("email, full_name, unit_id")
    .eq("party", "current_tenant")
    .not("unit_id", "is", null);

  /* Narrowed to the people who could possibly match, so this is a small
     read rather than the whole roster on every request. PostgREST's `or`
     takes one string; the name half is left off when the name is not
     specific enough to be asked about. */
  q = isFullName(who.name) && wantEmail
    ? q.or(`email.ilike.${wantEmail},full_name.ilike.${nameKey(who.name)}`)
    : wantEmail
      ? q.ilike("email", wantEmail)
      : q.ilike("full_name", nameKey(who.name));

  const { data, error } = await q;
  if (error) {
    /* Raised, not swallowed: a read that failed is not "this tenant lives
       nowhere", and filing the request against nothing because the database
       hiccupped is the absence of an answer being reported as an answer. */
    throw new Error(`tenant lookup: ${error.message}`);
  }

  return lotForTenant(who, (data ?? []) as RosterRow[]);
}
