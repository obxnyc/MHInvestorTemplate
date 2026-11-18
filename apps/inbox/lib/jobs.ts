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
  /** Who is on it. Null is not "nobody cares" -- a job reported an hour ago
   *  has nobody on it yet and that is fine -- but a week-old job with nobody
   *  on it is the thing this column exists to make visible. */
  who: string | null;
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

/**
 * How urgent a reported fault sounds.
 *
 * Keywords rather than a model call, for the same reason the classifier leads
 * with keywords: "no heat" at two in the morning must not wait on somebody
 * else's API, and must not quietly become "normal" when that API is down.
 *
 * Deliberately conservative. Everything unmatched stays at 3, because a
 * dashboard where half the rows shout is a dashboard where nobody looks at the
 * top. Only the things that damage a building or endanger somebody in it are
 * lifted, and a person can always change it afterwards.
 */
const EMERGENCY = [
  "gas leak", "smell gas", "smell of gas", "carbon monoxide", "co detector",
  "sewage", "sewer back", "flooding", "flooded", "water pouring",
  "no heat", "without heat", "heat is out", "furnace is out",
  "electrical fire", "sparking", "exposed wire", "no power",
  "break in", "broken window", "door won't lock", "door wont lock",
  /* A FIRE, NOT A FIREPLACE, AND NOT A DETECTOR.
   *
   * This list used to contain the bare word "smoke", and the dashboard
   * showed ten emergencies of which six were smoke detectors: "Smoke
   * dectectors", "Smoke dectors", "Same smoke dector beeping bedroom".
   * A detector beeping at 3am is a nine-volt battery, and an emergency
   * queue with batteries at the top is one nobody reads down.
   *
   * "fire" alone is no better -- "ceiling by fireplace looks like it has
   * water damage" is a real request on this account. So the phrases are
   * the ones that only ever mean a fire. */
  "on fire", "smell smoke", "smells like smoke", "smoke coming",
  "smoke filling", "house is smoking",
];

/** A detector is a safety item and it is not tonight's emergency.
 *
 *  Matched as a pattern rather than a word because every one of these is
 *  real, typed by a tenant on a phone: "dectector", "dector", "detecter". */
const DETECTOR = /\bsmoke\s*(?:detect|dectect|dector|detecter|alarm)/i;

const URGENT = [
  "no hot water", "no water", "water heater", "burst", "leak", "leaking",
  "toilet", "backed up", "clogged", "overflow",
  "no air", "no a/c", "no ac", "air conditioning", "refrigerator", "fridge",
  "stove", "oven", "mold", "roof", "ceiling",
];

export function urgencyFromText(text: string): number {
  const t = text.toLowerCase();

  /* First, and it wins: a detector that mentions nothing else is a battery.
     Asked BEFORE the emergency scan rather than after, because "smoke
     detectors and outlets" hits "no power"-adjacent wording often enough
     that ordering by accident is not ordering. A report that names a
     detector AND an actual fire still reads as the fire, because those
     phrases are checked on the way past. */
  if (DETECTOR.test(t) && !EMERGENCY.some((k) => t.includes(k))) return 2;

  if (EMERGENCY.some((k) => t.includes(k))) return 1;
  if (URGENT.some((k) => t.includes(k))) return 2;
  return 3;
}

/**
 * The lot or unit number inside a Rent Manager subject line.
 *
 * The subject reads "1140 Northside #51, 1140 Northside Rd, Lot #51" -- the
 * same number twice, written two ways, with the street address between them.
 * What is wanted is 51.
 *
 * Returned as digits rather than as written, because our own labels are
 * variously "#51", "Lot 51" and "51" depending on who typed them in, and
 * comparing the digits is the only comparison that holds across all three.
 */
export function lotDigits(hint: string | null | undefined): string | null {
  if (!hint) return null;
  // "#51" and "Lot 51" are both the lot; a bare "1140" at the start of the
  // string is the street number and is not.
  // No word boundary after the digits: "Unit 3B" is lot 3, and \b between a
  // digit and a letter does not exist, so requiring one dropped every
  // letter-suffixed unit on the floor.
  /* THE LAST ONE, NOT THE FIRST.
   *
   * A real subject line: "1140 Northside #46, 1140 Northside Rd, Lot #45".
   * Rent Manager's PROPERTY is named "1140 Northside #46" and the unit is
   * Lot #45 -- the two numbers genuinely differ in this account -- so
   * taking the first match reads the lot as 46 and files the request
   * against the wrong home, or against none.
   *
   * `readHint` has always taken the last for exactly this reason: the
   * trailing "Lot #45" is the one written to be read. These two
   * disagreed, and this one is what the unit lookup used. */
  const all = [...hint.matchAll(
    /(?:#|\blot\s*#?\s*|\bunit\s*#?\s*|\bapt\s*#?\s*)(\d{1,5})/gi)];
  return all.length ? all[all.length - 1]![1]! : null;
}

/** The property part of the same subject line: everything before the first
 *  lot marker, which is how Rent Manager writes it. */
export function propertyHint(hint: string | null | undefined): string | null {
  if (!hint) return null;
  const head = hint.split(",")[0].trim();
  const cut = head.replace(/\s*(?:#|\blot\b|\bunit\b|\bapt\b).*$/i, "").trim();
  return cut || null;
}

/* --------------------------------------------- what a job is raised from */

/** Just enough of a message to choose between them. */
export type ThreadLine = { id: string; direction: string; body?: string | null };

/**
 * Which message in a thread a work order should be summarised from.
 *
 * THEIR LAST ONE, WHERE THERE IS ONE. The last thing in a thread is as
 * often our own reply, and a job summarised from "I'll get someone out
 * Tuesday" tells the vendor nothing.
 *
 * BUT NOT ONLY WHEN THERE IS ONE, which is what this used to require. The
 * office fields a leak BY TELEPHONE, opens a thread with the plumber and
 * types the first message itself -- so there is no inbound anything, and
 * "Send to…" never appeared on the one screen the whole day is spent on.
 * "I like having something on the messages tab because that's where I will
 * be fielding calls and texts."
 *
 * On that thread our own message is not a worse summary; it is the only
 * description there is, and it is somebody writing down the fault in their
 * own words, which is what a vendor needs to read.
 *
 * Null only for a thread with nothing in it at all, which is a thread
 * nobody has started.
 */
export function jobAnchor(messages: ThreadLine[]): ThreadLine | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.direction === "inbound") return messages[i]!;
  }
  return messages.length ? messages[messages.length - 1]! : null;
}
