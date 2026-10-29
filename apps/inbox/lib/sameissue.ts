/**
 * The same maintenance request, arriving twice.
 *
 * A tenant submits one issue in Tenant Web Access and it reaches us two
 * ways. Rent Manager emails it immediately, with the tenant's name, their
 * number and the address in the subject line. The hourly pull from
 * `/ServiceManagerIssues` finds the same issue later carrying none of
 * that -- no tenant, no number, no property, because that endpoint does
 * not hand them over.
 *
 * Both paths are worth having: the pull catches issues the office types
 * straight into Rent Manager, which never produce an email. What is not
 * worth having is two threads for one broken fridge, one of them empty,
 * which is what the office has been looking at.
 *
 * They cannot be matched on an id -- the email carries none -- so they
 * are matched on what the tenant actually wrote, which is identical in
 * both and is the one thing neither path invents.
 */

/** The description, however the path happened to label it. */
export function describedAs(raw: string): string | null {
  const m = /^\s*Description:\s*(.+(?:\n(?!\s*\w[\w ]{0,20}:).*)*)/im.exec(raw ?? "");
  const said = (m?.[1] ?? "").replace(/\s+/g, " ").trim();
  return said || null;
}

/** And the title, which on its own is never enough. */
export function titledAs(raw: string): string | null {
  const m = /^\s*Issue(?:\s+Title)?:\s*(.+)$/im.exec(raw ?? "");
  const said = (m?.[1] ?? "").replace(/\s+/g, " ").trim();
  return said || null;
}

/**
 * How much of the tenant's words to look for.
 *
 * SHORT ONES ARE NOT DISTINCTIVE. "Heat" and "Furnace" are both real
 * issue titles here, and "no heat" is a description a dozen households
 * write in the same week -- matching on that would join two different
 * houses' problems into one thread, which is far worse than two threads
 * for one problem.
 */
export const ENOUGH = 40;

/**
 * A fragment distinctive enough to find the twin by, or null.
 *
 * Deliberately a slice of the ORIGINAL text rather than a normalised
 * key: it is used as a LIKE against what was stored, and the two paths
 * store the tenant's sentence verbatim. Normalising would mean storing a
 * key as well, which is a migration, and this needs none.
 */
export function twinFragment(raw: string): string | null {
  const said = describedAs(raw);
  if (!said || said.length < ENOUGH) return null;
  /* From the start, which both paths reproduce exactly. The tail is
     where a path adds its own trailing matter. */
  const slice = said.slice(0, 80);
  /* A fragment with a % or an _ in it is a LIKE pattern rather than a
     search for those characters, and would match far too much. */
  return /[%_\\]/.test(slice) ? null : slice;
}
