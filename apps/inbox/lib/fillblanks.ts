/**
 * Filling in a blank without ever overwriting an answer.
 *
 * The same question is asked by two completely different arrivals, and
 * both of them were getting it wrong in the same way.
 *
 * A maintenance request reaches this office twice. Rent Manager emails a
 * notification the moment a tenant submits it, carrying their name, their
 * number and the lot in the subject line. The hourly pull finds the same
 * issue later carrying none of those, because `/ServiceManagerIssues`
 * hands an issue over with no tenant, no phone and no lot.
 *
 * `ingest` joins the two on what the tenant actually wrote, and then kept
 * whichever got here FIRST -- on the reasoning that the email arrives
 * within the minute and the pull is hourly. That reasoning is sound and
 * the premise is false: no notification email has ever reached this
 * application, so for every one of the three hundred requests already
 * filed the pull got there first, and an email arriving now is the
 * richer of the two and was being thrown away.
 *
 * `rm-repair` asks the same question from the other end, of threads
 * already filed. So the rule lives here, once, where both can reach it
 * and neither can drift from the other.
 *
 * It is in its own file rather than in `intake` or in `rm-repair`
 * because each of those imports the other the moment it is not.
 */
import { toE164, isValidPhone } from "./phone";

/* ------------------------------------------------------------- the state
 *
 * These are pure on purpose. Deciding WHETHER a thread needs mending is
 * the part that has been got wrong repeatedly in this codebase -- a screen
 * that reports a state by testing whether one field is there at all -- so
 * it is a function that can be asked the awkward cases directly rather
 * than a condition buried in a query.
 */

/** What a contact's phone says when there is no phone.
 *
 *  `ingest` writes `email:<something>` into `contacts.phone` when it has no
 *  number, because the column will not take a null. So the placeholder is
 *  not an absent value -- it is a PRESENT value meaning absent, and code
 *  that tests `phone ? ... : ...` reads it as a phone number and reports a
 *  tenant as reachable who cannot be rung.
 *
 *  Same family as the empty string that `pick` must not report as the field
 *  that answered. */
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  return !phone || phone.startsWith("email:");
}

/** A thread as far as we hold it, which is what decides whether to ask. */
export type Held = {
  conversationId: string;
  issueId: string;
  /** The lot, if the thread was ever filed against one. */
  unitId: string | null;
  /** The words somebody or something put in the place box. */
  placeHint: string | null;
  contactId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
};

/** The things this thread cannot say. Empty means there is nothing to ask.
 *
 *  Each is asked separately, because they go missing separately: the pull
 *  files plenty of requests that name a property and no tenant, and the
 *  three are not one question. A thread that is only missing its lot is
 *  worth a round trip; reporting it as identified because it has a name is
 *  the narrower question answered confidently. */
export function whatIsMissing(h: Held): ("who" | "reach" | "where")[] {
  const out: ("who" | "reach" | "where")[] = [];
  if (!h.name) out.push("who");
  if (isPlaceholderPhone(h.phone) && !h.email) out.push("reach");
  if (!h.unitId) out.push("where");
  return out;
}

export function needsMending(h: Held): boolean {
  return whatIsMissing(h).length > 0;
}

/** How many requests in a row may come back empty before it is not worth
 *  asking again this run. */
export const GIVE_UP_AFTER = 8;

/**
 * Whether to ask Rent Manager about one more request.
 *
 * A function rather than two conditions in the loop, because the rule has
 * a trap in it that a type cannot see and a source rule reports badly:
 * the count is of blanks IN A ROW, and a run that forgets to reset it
 * stops after eight scattered misses instead of eight consecutive ones.
 * On a backlog of three hundred, where plenty of requests legitimately
 * have nothing to add, that is a repair that gives up almost at once and
 * reports itself as having finished.
 *
 * `"nothing-coming-back"` is a different answer from `"time"` on purpose.
 * Out of time means press again. Nothing coming back means Rent Manager
 * is answering and will not say who the tenant is, and pressing again
 * will do exactly the same thing -- which is worth saying rather than
 * leaving somebody to press it twenty times.
 */
export function keepGoing(
  state: { blanksInARow: number; now: number; until: number },
): "go" | "time" | "nothing-coming-back" {
  if (state.now > state.until) return "time";
  if (state.blanksInARow >= GIVE_UP_AFTER) return "nothing-coming-back";
  return "go";
}

/** The place name to look a lot up by.
 *
 *  `unitFromHint` wants a string it can read both a property and a lot
 *  number out of -- it matches on the digits, then breaks a tie between
 *  parks on the words. Handing it the bare unit ("51") gives it the digits
 *  and nothing to break a tie with, which is why a lot number every park
 *  has could never be matched. The pull passes exactly that.
 *
 *  So both go in, in the order a subject line writes them. */
export function placeOf(
  issue: { property: string | null; unit: string | null },
): string | null {
  const bits = [issue.property, issue.unit && `Lot ${issue.unit}`].filter(Boolean);
  return bits.length ? bits.join(" ") : null;
}

/** What the lookup found, merged over what the thread already holds.
 *
 *  Only blanks are filled, and the placeholder phone counts as a blank
 *  while a real one does not. Returns ONLY the things that would change,
 *  so an unchanged thread is not written to and does not count as mended. */
export type Mend = {
  name?: string;
  phone?: string;
  email?: string;
  placeHint?: string;
};

export function mendFor(h: Held, found: {
  tenant: string | null; phone: string | null;
  email: string | null; place: string | null;
}): Mend {
  const m: Mend = {};
  if (!h.name && found.tenant) m.name = found.tenant;
  if (isPlaceholderPhone(h.phone) && found.phone) {
    /* `toE164` NEVER RETURNS NULL, and that is correct where it is used:
       it is a join key, and a half-typed number has to normalise to the
       same string every time or one person becomes two contacts. Its last
       line is `return "+" + d`, so "n/a" comes back as "+" -- truthy, and
       written onto a tenant as their phone number.

       Worse than useless: "+" is the SAME string for every junk value, so
       it is one contact that every unidentified tenant merges into.

       The question here is not "can this be normalised" but "is this a
       number somebody can be rung on", and `isValidPhone` is the function
       for that. A blank is visible on screen and askable; a phone number
       that is not one is neither. */
    const e164 = toE164(found.phone);
    if (e164 && isValidPhone(e164)) m.phone = e164;
  }
  if (!h.email && found.email) m.email = found.email;
  if (!h.placeHint && found.place) m.placeHint = found.place;
  return m;
}
