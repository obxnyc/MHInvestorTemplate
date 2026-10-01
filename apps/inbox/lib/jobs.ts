/**
 * What a work order's status and urgency are called out loud.
 *
 * The database stores `needs_parts` and `in_progress` because those are good
 * column values. Nobody says that. These are the words a person would use
 * about their own building, and keeping them in one place means the dashboard
 * and the jobs board cannot drift into calling the same thing two names.
 */

const STATUS: Record<string, string> = {
  new: "Reported",
  assigned: "Assigned",
  accepted: "Accepted",
  scheduled: "Scheduled",
  in_progress: "Under way",
  needs_parts: "Waiting on parts",
  done: "Finished",
  cancelled: "Cancelled",
};

export function jobStatus(status: string): string {
  return STATUS[status] ?? status.replace(/_/g, " ");
}

/** Three buckets, not eight colours. A status pill is read at a glance and a
 *  palette with one shade per enum value is read as decoration. */
export type JobTone = "waiting" | "moving" | "stuck";

export function jobTone(status: string): JobTone {
  if (status === "needs_parts") return "stuck";
  if (status === "new" || status === "assigned") return "waiting";
  return "moving";
}

/** 1 is an emergency and 5 is whenever. Only the top two are named: a label on
 *  every row is a label nobody reads, and "normal" next to forty jobs tells
 *  you nothing. */
export function urgencyLabel(urgency: number | null): string | null {
  if (urgency === 1) return "Emergency";
  if (urgency === 2) return "Urgent";
  return null;
}

export type JobRow = {
  id: string;
  summary: string;
  status: string;
  urgency: number | null;
  scheduledFor: string | null;
  createdAt: string;
  conversationId: string | null;
  /** "1140 Northside · Lot #51", or null when nobody has said where it is. */
  where: string | null;
};

/** Worst first, and "worst" is a sentence rather than a column: an emergency
 *  outranks everything, then anything whose scheduled date has gone past,
 *  then by urgency, then oldest -- because a job nobody has touched in three
 *  weeks is the one that gets forgotten, not the one reported this morning. */
export function byWorst(now = Date.now()) {
  const late = (j: JobRow) =>
    j.scheduledFor !== null && new Date(j.scheduledFor).getTime() < now;
  return (a: JobRow, b: JobRow) => {
    const emergency = (j: JobRow) => (j.urgency === 1 ? 0 : 1);
    if (emergency(a) !== emergency(b)) return emergency(a) - emergency(b);
    if (late(a) !== late(b)) return late(a) ? -1 : 1;
    if ((a.urgency ?? 3) !== (b.urgency ?? 3)) return (a.urgency ?? 3) - (b.urgency ?? 3);
    return a.createdAt.localeCompare(b.createdAt);
  };
}
