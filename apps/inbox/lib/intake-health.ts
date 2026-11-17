/**
 * Whether the paths that bring work in are actually bringing it in.
 *
 * WHY THIS EXISTS. Five fixes shipped in one week downstream of a pipe
 * that has never carried water. A tenant's maintenance request reaches
 * this office two ways, and only ONE of them carries the address:
 *
 *   the email  -- Rent Manager's TWA notification, which names the
 *                 tenant, their number and the lot, in its subject line
 *   the pull   -- the hourly API read, which carries the issue and no
 *                 address at all, because Rent Manager's endpoint has
 *                 none to give
 *
 * 309 requests arrived by the pull. ZERO have ever arrived by email --
 * not one, since the day it was built. So every request in the inbox
 * named nobody and sat against no property, and the matching, the
 * repair pass and the lot lookup were all rebuilt in turn against a
 * thing none of them could ever see.
 *
 * Nothing said so. The chain is Rent Manager, a Gmail filter, Postmark,
 * a webhook, and a request can fall down silently at any of the four.
 *
 * THE RULE THIS GETS RIGHT, AND IT IS THE ONE THAT IS EASY TO GET
 * WRONG. "Nothing arrived" is not a fault. A quiet week is a quiet
 * week, and a check that shouts about one is a check the office stops
 * reading by Thursday -- which is worse than no check, because the real
 * finding is in that list too.
 *
 * The fault is one path silent WHILE ANOTHER IS BUSY. Requests are
 * coming in; the one that carries the address is not. That is a broken
 * forward and nothing else, and it is a thing somebody can go and fix.
 *
 * Same shape as the fence, and "which job are you on", and `described`
 * keyed on rows: counting arrivals answers a narrower question than the
 * one being asked, and answers it confidently.
 */

/** What arrived, over the window the verdict is about. */
export type Arrivals = {
  /** Requests that came in as a forwarded email -- the only path that
   *  carries the tenant and the lot. */
  byEmail: number;
  /** Requests the hourly API read found. No address on any of them. */
  byPull: number;
  /** Texts to the shared line. Counted because they prove the
   *  application itself is alive and receiving. */
  byText: number;
  /** When an email last arrived, ever. Null means not once. */
  lastEmailAt: string | null;
  /** How many days the counts above cover. */
  days: number;
};

export type Verdict = {
  level: "ok" | "warn" | "bad";
  /** One line, for a subject or a banner. */
  headline: string;
  /** What to do about it, or why there is nothing to do. */
  detail: string;
};

/**
 * Read the arrivals.
 *
 * `bad` is reserved for the case where something is provably broken and
 * somebody must go and fix it. `warn` is for the case that may be
 * nothing. Spending `bad` on a quiet week is how a check stops being
 * believed.
 */
export function intakeVerdict(a: Arrivals): Verdict {
  const busy = a.byPull + a.byText;

  /* NOTHING AT ALL. Not evidence of a fault: tenants do not submit
     every day and the office is shut at the weekend. The only thing
     worth saying is that there is nothing to report. */
  if (busy === 0 && a.byEmail === 0) {
    return {
      level: "ok",
      headline: "No maintenance requests came in.",
      detail: `Nothing arrived by any route in the last ${a.days} days,`
        + " which on a quiet week is exactly what it looks like. Nothing"
        + " here says anything is broken.",
    };
  }

  if (a.byEmail > 0) {
    return {
      level: "ok",
      headline: `${a.byEmail} request${a.byEmail === 1 ? "" : "s"} arrived by email.`,
      detail: "The email path is the one that carries the tenant's name,"
        + " their number and the lot, so these filed themselves against a"
        + " property. The hourly pull brought"
        + ` ${a.byPull} more, which carry none of that.`,
    };
  }

  /* THE FAULT. Work is coming in, and not one of it by the route that
     knows where it came from. */
  const ever = a.lastEmailAt
    ? `The last one was ${a.lastEmailAt}.`
    : "NOT ONE HAS EVER ARRIVED, since the day the forward was set up.";

  return {
    level: "bad",
    headline: "No maintenance request has arrived by email,"
      + ` while ${busy} came in another way.`,
    detail: `${busy} arrived in the last ${a.days} days — ${a.byPull} from`
      + ` the hourly Rent Manager read and ${a.byText} by text — and zero`
      + ` by email. ${ever}`
      + " Rent Manager's notification is the ONLY thing that carries the"
      + " tenant's name, their number and the lot: the API read has none"
      + " of them. So every one of those requests is sitting against no"
      + " property and naming nobody, and will keep doing so."
      + " The chain is Rent Manager, a Gmail filter, Postmark, then this"
      + " app, and one of the last three is not delivering.",
  };
}

/** A line for the daily report. Kept apart from the verdict so the same
 *  reading can be shown on a screen without the email's wording. */
export function intakeLines(v: Verdict): string[] {
  if (v.level === "ok") return [v.headline];
  return [v.headline, "", v.detail];
}

/** Which path an inbound message arrived by, from the id it carries.
 *
 * THE IDS BELOW ARE REAL, read out of the database rather than
 * imagined, which is the whole reason this function exists:
 *
 *   rm:issue:310                            the hourly API read
 *   (null)                                  a text to the shared line
 *   c6c580be-d5f1-4883-94d7-91d5a023cb5a    an email, via Postmark
 *
 * The first rule here asked whether the id contained an `@`, because
 * mail carries an RFC Message-ID. Postmark does not pass that through.
 * So email counted zero while email was working, and the morning report
 * would have shouted "not arriving" every day for ever.
 */
export function arrivedBy(externalId: string | null): "pull" | "text" | "email" {
  if (externalId === null) return "text";
  return externalId.startsWith("rm:") ? "pull" : "email";
}

/* ------------------------------------------------------------ reading it */

/**
 * Count what arrived, by the mark each path leaves on the message.
 *
 * NOT by `conversations.source`. The setup page counted that for
 * months and reported "Email intake. Arriving. 200 zego" on a database
 * where no email had ever landed -- because `source` is the
 * maintenance-intake key and the API pull writes the same one. It is a
 * statement about what the thread is ABOUT, not about how it got here.
 *
 * What tells them apart is the id each path stamps on the message.
 *
 * AND THE FIRST VERSION OF THAT RULE WAS WRONG, in the one direction
 * that matters. It looked for an `@`, on the reasoning that mail
 * carries an RFC Message-ID. Postmark does not pass that through: the
 * id on the two emails that have actually arrived is a plain UUID,
 * `c6c580be-d5f1-4883-94d7-91d5a023cb5a`. So the check would have gone
 * on reporting "nothing has arrived by email" every morning for ever,
 * with the forward working perfectly -- crying wolf, which this file's
 * own comment calls worse than no check at all.
 *
 * Written from imagination and never held against a real row. The real
 * rows say: the pull writes `rm:issue:<n>`, a text writes nothing, and
 * EVERYTHING ELSE came in through the mail webhook. So the rule is by
 * exclusion of the two paths we can name, not by recognising a shape
 * nobody checked.
 *
 * `channel` cannot do it either, and that is worth knowing: the same
 * email lands as `email` when it joins an existing thread and as
 * `zego` when it opens one, because two different code paths insert it.
 */
export async function readArrivals(
  db: { from: (t: string) => any }, days = 7,
): Promise<Arrivals> {
  const since = new Date(Date.now() - days * 864e5).toISOString();

  const count = async (shape: (q: any) => any): Promise<number> => {
    const { count: n, error } = await shape(
      db.from("messages").select("id", { count: "exact", head: true })
        .eq("direction", "inbound").gte("created_at", since));
    if (error) throw new Error(error.message);
    return n ?? 0;
  };

  const byPull = await count((q) => q.like("external_id", "rm:issue:%"));
  /* Not null, and not the pull's. Everything that reaches this
     application any other way comes through the mail webhook. */
  const byEmail = await count((q) =>
    q.not("external_id", "is", null).not("external_id", "like", "rm:%"));
  const byText = await count((q) => q.is("external_id", null));

  const { data: last } = await db.from("messages")
    .select("created_at").eq("direction", "inbound")
    .not("external_id", "is", null).not("external_id", "like", "rm:%")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  return {
    byEmail, byPull, byText, days,
    lastEmailAt: last?.created_at
      ? new Date(String(last.created_at)).toLocaleDateString("en-US",
          { month: "short", day: "numeric", year: "numeric",
            timeZone: "America/New_York" })
      : null,
  };
}
