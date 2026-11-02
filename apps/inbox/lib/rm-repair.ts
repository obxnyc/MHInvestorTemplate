/**
 * Putting a name, a number and a lot back on requests that arrived without.
 *
 * THE PULL CANNOT DO THIS, AND THAT IS THE WHOLE REASON THIS EXISTS.
 *
 * `pullServiceIssues` resolves the tenant properly -- it reads
 * `CreateWebUserID` off the issue and turns it into a person through
 * `whoSubmitted`. But the first thing `ingest` does is refuse an
 * `external_id` it has seen before, and return. That refusal is what makes
 * the pull safe to re-run, and it is also what makes the pull unable to
 * mend anything: every request filed before the lookup worked is filed for
 * good, naming nobody, and pressing the pull button again walks straight
 * past all of them reporting "already had it".
 *
 * Two hundred and eighty-five requests are in that state. They are not
 * going to fix themselves on the next tenant, because they are already in.
 *
 * So this goes the other way round: it starts from the threads we HOLD,
 * asks which of them cannot say who or where, and goes back to Rent
 * Manager for just those.
 *
 * WHAT IT WILL NOT DO.
 *
 * It only ever fills a blank. Anything already on the thread was put there
 * by the email path, which carries the tenant and the lot in its subject
 * line, or by a person -- and both of those beat a second guess made from
 * an id. The same rule `openJob` states about the address it works out.
 *
 * And it does not touch the contact's own lot. A tenant reports a leak at
 * their neighbour's as readily as their own; writing an address onto a
 * PERSON from one request is how somebody's record quietly becomes wrong.
 * The thread gets the lot. The person gets their name and their number.
 */
import { supabaseAdmin } from "./supabase-admin";
import { rmAuthorize, type RmSession } from "./rentmanager";
import {
  readIssue, whoSubmitted, type Issue, type Who, type WhoAttempt,
} from "./rm-issues";
import { unitFromHint } from "./intake";
// From `phone`, not from `twilio` which re-exports it: `twilio` pulls the
// whole SDK in at module load, and this needs one pure function.
import {
  isPlaceholderPhone, whatIsMissing, needsMending, placeOf, mendFor,
  keepGoing, type Held, type Mend,
} from "./fillblanks";
/* Re-exported so the one import still reaches the whole rule: the
   decision about what is missing belongs with the thing that acts
   on it, even though it is shared with `intake`. */
export {
  isPlaceholderPhone, whatIsMissing, needsMending, placeOf, mendFor,
  keepGoing, GIVE_UP_AFTER,
} from "./fillblanks";
export type { Held, Mend } from "./fillblanks";

/* ----------------------------------------------------------- the result */

/** One thread that was looked at, and what came of it. */
export type Mended = {
  conversationId: string;
  issueId: string;
  missing: ("who" | "reach" | "where")[];
  /** Where the identity came from. The issue record itself, where the
   *  office typed a tenant in afterwards; or the web user behind it. */
  from: "issue" | "webuser" | null;
  mend: Mend;
  /** Whether a lot was matched, and to what. */
  placed: boolean;
  /** The real number already belonged to somebody we hold, so the thread
   *  was pointed at them rather than a second record being made. */
  mergedInto: string | null;
  note: string | null;
};

export type RepairResult = {
  ok: boolean;
  signedIn: boolean;
  dryRun: boolean;
  /** Threads from Rent Manager that cannot say who or where. The size of
   *  the problem, whether or not this run got through them. */
  unidentified: number;
  /** How many were asked about this run. */
  looked: number;
  /** How many came back with something worth writing. */
  found: number;
  /** How many were actually written. Zero on a rehearsal. */
  mended: number;
  /** How many got a real lot out of it. */
  placed: number;
  /** How many were pointed at a person we already held. */
  merged: number;
  failed: number;
  /** The clock ran out, or the cap was reached. Pressing again carries on:
   *  a thread that has been mended no longer counts as unidentified, so
   *  the next run starts where this one stopped. */
  more: boolean;
  /** Why it stopped early, where it did. `"nothing-coming-back"` means
   *  Rent Manager is answering and telling us nothing, which is a
   *  different problem from running out of time and is not worth
   *  spending three hundred round trips to confirm. */
  stopped: "time" | "nothing-coming-back" | null;
  /** Every path tried for the first web-user lookup, so a run that mends
   *  nothing names the guesses rather than just not working. */
  whoTried?: WhoAttempt[];
  whoShape?: string[] | null;
  samples: Mended[];
  error: string | null;
};

/* ------------------------------------------------------------- the work */

/** One issue, fetched on its own. The list endpoint is cheaper per record
 *  but we want a handful out of hundreds, and asking for the ones we need
 *  beats paging past the ones we do not. */
async function oneIssue(
  session: RmSession, id: string, readAs: Record<string, string>,
): Promise<Issue | null> {
  for (const path of [
    `/ServiceManagerIssues/${id}?embeds=Category,Status,Priority`,
    `/ServiceManagerIssues/${id}`,
  ]) {
    try {
      const res = await fetch(`${session.base}${path}`, {
        headers: { [session.header]: session.token, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      const row = (Array.isArray(data) ? data[0] : data) as
        Record<string, unknown> | null;
      if (row && typeof row === "object") return readIssue(row, readAs);
    } catch { /* next shape */ }
  }
  return null;
}

/** The threads that came from Rent Manager and cannot say who or where. */
export async function unidentifiedThreads(
  db: ReturnType<typeof supabaseAdmin>, cap = 2000,
): Promise<Held[]> {
  /* ONE STRING LITERAL. A select built by concatenation makes the client
     infer every field on the result as an error rather than a column,
     which typechecks as nonsense and is a round lost. */
  const { data, error } = await db.from("messages")
    .select("external_id, conversations(id, unit_id, place_hint, contact_id, contacts(id, full_name, phone, email))")
    .like("external_id", "rm:issue:%")
    .order("created_at", { ascending: false })
    .limit(cap);
  if (error) throw new Error(error.message);

  const held = new Map<string, Held>();
  for (const row of (data ?? []) as unknown as {
    external_id: string | null;
    conversations: {
      id: string; unit_id: string | null; place_hint: string | null;
      contact_id: string | null;
      contacts: { id: string; full_name: string | null;
                  phone: string | null; email: string | null } | null;
    } | null;
  }[]) {
    const c = row.conversations;
    const issueId = (row.external_id ?? "").replace(/^rm:issue:/, "");
    if (!c?.id || !issueId) continue;
    // One thread can carry several issues. The newest is the one on top of
    // the list, so the first seen wins and the rest are its history.
    if (held.has(c.id)) continue;
    held.set(c.id, {
      conversationId: c.id,
      issueId,
      unitId: c.unit_id,
      placeHint: c.place_hint,
      contactId: c.contacts?.id ?? c.contact_id,
      name: c.contacts?.full_name ?? null,
      phone: c.contacts?.phone ?? null,
      email: c.contacts?.email ?? null,
    });
  }
  return [...held.values()].filter(needsMending);
}

/**
 * Go back for the ones that arrived anonymous.
 *
 * A rehearsal unless told otherwise, same as the pull and for the same
 * reason: the first run of something that writes over a live inbox should
 * be readable before it is believed.
 */
export async function repairIssues(
  opts: { dryRun?: boolean; limit?: number; seconds?: number } = {},
): Promise<RepairResult> {
  const dryRun = opts.dryRun !== false;
  const blank: RepairResult = {
    ok: false, signedIn: false, dryRun,
    unidentified: 0, looked: 0, found: 0, mended: 0, placed: 0, merged: 0,
    failed: 0, more: false, stopped: null, samples: [], error: null,
  };

  const db = supabaseAdmin();
  let todo: Held[];
  try {
    todo = await unidentifiedThreads(db);
  } catch (e) {
    return { ...blank, error: (e as Error).message };
  }

  const auth = await rmAuthorize();
  if (!auth.ok) {
    return { ...blank, unidentified: todo.length,
             error: "Rent Manager would not accept the sign-in." };
  }
  const session = auth.session;

  const out: RepairResult = {
    ...blank, ok: true, signedIn: true, unidentified: todo.length,
  };

  /* Stops with room to spare. Sixty seconds is the ceiling on this plan and
     a function killed at the ceiling does not return JSON at all -- it
     returns whatever Vercel serves, which reads in the browser as the
     parser's fault. */
  const until = Date.now() + (opts.seconds ?? 35) * 1000;
  const readAs: Record<string, string> = {};
  const people = new Map<string, Who>();

  /* This runs by itself now, every few minutes, whenever somebody opens
     the inbox. If Rent Manager will not turn a web user id into a person
     on this account, then every one of three hundred threads is a round
     trip spent learning the same thing -- forever, and against somebody's
     live property-management system. So a run getting nothing stops and
     says so. Not a permanent decision: the next run starts from the top
     and picks straight back up the moment the lookup answers, at a cost
     of eight requests rather than three hundred. */
  let blanksInARow = 0;

  for (const h of todo.slice(0, opts.limit ?? 500)) {
    const verdict = keepGoing({ blanksInARow, now: Date.now(), until });
    if (verdict !== "go") { out.more = true; out.stopped = verdict; break; }
    out.looked += 1;

    let issue: Issue | null;
    try {
      issue = await oneIssue(session, h.issueId, readAs);
    } catch { issue = null; }
    if (!issue) {
      out.failed += 1;
      // A request Rent Manager will not hand back counts towards giving
      // up too. Otherwise a run that can reach nothing at all walks the
      // whole list to find that out.
      blanksInARow += 1;
      continue;
    }

    /* The issue record first. Where the office typed a tenant in after the
       fact, that is a person who looked at it -- it beats an id lookup. */
    let from: Mended["from"] = null;
    let tenant = issue.tenant;
    let phone = issue.phone;
    let email = issue.email;
    let unit = issue.unit;
    let property = issue.property;
    if (tenant || unit || property) from = "issue";

    if (!tenant && issue.webUserId) {
      const had = people.get(issue.webUserId);
      const who = had ?? await whoSubmitted(issue.webUserId, session);
      if (!had) people.set(issue.webUserId, who);
      if (who.tried.length && !out.whoTried) out.whoTried = who.tried;
      if (who.shape && !out.whoShape) out.whoShape = who.shape;
      if (who.tenant || who.unit || who.property) {
        from = "webuser";
        tenant ??= who.tenant;
        phone ??= who.phone;
        email ??= who.email;
        unit ??= who.unit;
        property ??= who.property;
      }
    }

    const place = placeOf({ property, unit });
    const mend = mendFor(h, { tenant, phone, email, place });
    const wantsLot = !h.unitId && Boolean(place ?? h.placeHint);
    if (!Object.keys(mend).length && !wantsLot) { blanksInARow += 1; continue; }
    /* THE RESET. Without it the count is of blanks in the whole run, not
       in a row, and a backlog with scattered misses gives up at once. */
    blanksInARow = 0;
    out.found += 1;

    const rec: Mended = {
      conversationId: h.conversationId, issueId: h.issueId,
      missing: whatIsMissing(h), from, mend,
      placed: false, mergedInto: null, note: null,
    };

    if (dryRun) {
      if (out.samples.length < 25) out.samples.push(rec);
      continue;
    }

    try {
      /* THE NUMBER MAY ALREADY BE SOMEBODY'S.
       *
       * A tenant who texts the mainline is already a contact with that
       * number on it, and `contacts.phone` is unique. Writing it onto the
       * placeholder would be refused -- and a thread that errored here
       * would stay anonymous while the run reported it mended.
       *
       * So where the number is held, the thread is pointed at the person
       * who holds it, which is the right answer anyway: one person, one
       * record, their texts and their maintenance requests together. */
      if (mend.phone && h.contactId) {
        const { data: already } = await db.from("contacts")
          .select("id, full_name").eq("phone", mend.phone).maybeSingle();
        if (already && already.id !== h.contactId) {
          await db.from("conversations")
            .update({ contact_id: already.id }).eq("id", h.conversationId);
          if (!already.full_name && mend.name) {
            await db.from("contacts")
              .update({ full_name: mend.name }).eq("id", already.id);
          }
          rec.mergedInto = already.id;
          out.merged += 1;
        }
      }

      if (!rec.mergedInto && h.contactId) {
        const patch: Record<string, string> = {};
        if (mend.name) patch.full_name = mend.name;
        if (mend.phone) patch.phone = mend.phone;
        if (mend.email) patch.email = mend.email;
        if (Object.keys(patch).length) {
          const { error } = await db.from("contacts")
            .update(patch).eq("id", h.contactId);
          if (error) throw new Error(error.message);
        }
      }

      /* The words go on the thread whether or not they match a lot we
         hold. A place name nobody has mapped is still the answer to
         "which house is this", and `PlaceNeeded` shows it and offers the
         box to map it. Left blank, the screen says we lost the address. */
      const hint = mend.placeHint ?? h.placeHint;
      const convo: Record<string, string> = {};
      if (mend.placeHint) convo.place_hint = mend.placeHint.slice(0, 200);

      if (!h.unitId && hint) {
        const unitId = await unitFromHint(db, hint);
        if (unitId) { convo.unit_id = unitId; rec.placed = true; }
      }
      if (Object.keys(convo).length) {
        const { error } = await db.from("conversations")
          .update(convo).eq("id", h.conversationId);
        if (error) throw new Error(error.message);
      }

      if (rec.placed) out.placed += 1;
      out.mended += 1;
      if (out.samples.length < 25) out.samples.push(rec);
    } catch (e) {
      rec.note = (e as Error).message;
      out.failed += 1;
      if (out.samples.length < 25) out.samples.push(rec);
    }
  }

  if (out.looked < todo.length) out.more = true;
  return out;
}
