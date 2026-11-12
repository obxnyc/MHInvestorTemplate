/**
 * Who an automatic email goes to.
 *
 * WHY THIS IS A TABLE AND NOT A SETTING. `BOOKKEEPER_EMAIL` lived in the
 * hosting dashboard, which means adding Alex to the list is: sign in to
 * Vercel, find the right project among several, open the right Environment
 * Variables page (not the team-wide one, which has no Add button), type the
 * addresses, save, and then redeploy -- because settings are read at build
 * time, so the edit on its own changes nothing and reads as the fix having
 * failed.
 *
 * That is six steps and a deployment to write down four email addresses, and
 * not one of them can be done from a session like this one. The morning
 * report solved the same problem in migration 051 and the note on it is
 * already in the working agreements: **who gets it is a table, not code.**
 * Adding somebody is an insert.
 *
 * So `report_recipients` carries both lists now, told apart by `report`.
 * `delinquency` is the morning email; `invoices` is the bookkeeper's.
 *
 * THE ONE RULE THAT IS EASY TO GET WRONG. An empty table and a table whose
 * every row has finished are NOT the same state.
 *
 *   No rows at all      nobody has ever said who gets these, so the old
 *                       environment variable is still worth honouring -- a
 *                       deployment that had it set keeps working.
 *
 *   Rows, none active   somebody decided. Every one has an `ends_on` that
 *                       has passed, which is a list of nobody, deliberately.
 *                       Falling back here would be the application quietly
 *                       overruling a decision with a value from a dashboard
 *                       nobody has looked at in a year.
 *
 * Same family as `described` keyed on rows and the fence keyed on one number:
 * asking "is there anything there" answers a narrower question than the one
 * being asked.
 */
import { activeRecipients, newYork, type Recipient } from "./delinquency";
import { recipients } from "./invoices";

/** Where the answer came from, so a screen can say which rather than just
 *  whether there is one. A line drawn by eye is not the deed line. */
export type ListSource = "table" | "environment" | "nobody";

export type MailList = {
  /** Addresses to send to, in the order the table gave them. */
  to: string[];
  from: ListSource;
  /** Rows that exist but are not active today -- somebody who starts next
   *  month, or who has been taken off. Reported so a list that looks empty
   *  can be explained instead of merely being empty. */
  waiting: number;
};

/**
 * The current list for one report.
 *
 * `fallback` is the old environment variable, used only when the table has
 * never been told about this report at all.
 */
export async function mailList(
  db: { from: (t: string) => any },
  report: string,
  fallback?: string | null,
  day?: string,
): Promise<MailList> {
  const { data, error } = await db.from("report_recipients")
    .select("email, name, starts_on, ends_on")
    .eq("report", report);

  /* A read that failed is not an empty list. Falling back to the environment
     here would send a bookkeeper's invoice to whoever a dashboard names on a
     morning the database was unreachable, and returning "nobody" would drop
     it silently -- so it is raised, and the caller decides. */
  if (error) throw new Error(`report_recipients (${report}): ${error.message}`);

  const rows = (data ?? []) as Recipient[];
  if (rows.length === 0) {
    const env = recipients(fallback);
    return { to: env, from: env.length ? "environment" : "nobody", waiting: 0 };
  }

  const on = day ?? newYork(new Date()).day;
  const live = activeRecipients(rows, on);
  return {
    to: live.map((r) => r.email),
    from: live.length ? "table" : "nobody",
    waiting: rows.length - live.length,
  };
}
