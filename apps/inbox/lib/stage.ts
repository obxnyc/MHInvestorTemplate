/**
 * Where we are with a person who is looking.
 *
 * An inquiry had two states, open or ended, so a lead nobody has opened and a
 * lead whose application is on somebody's desk were the same row on the same
 * board. This is the open progression, and `outcome` is still the ending --
 * there is no 'leased' stage on purpose, because a lease recorded in two
 * columns is two columns that will disagree.
 *
 * THE STAGE IS RECORDED, NEVER INFERRED. It would be easy to work it out --
 * an outbound message means replied, a booking means a tour -- and that is
 * the mistake this codebase has now made four times in three places:
 * `described` keyed on rows, `has` keyed on a line, `real` keyed on what the
 * tiles carried, a fence keyed on one number being under another. A screen
 * that reports a state by testing whether anything is there at all answers a
 * narrower question than the one being asked, and answers it confidently.
 *
 * So one move is automatic and it is the one that is a fact we hold rather
 * than a guess: sending a reply sets 'replied', because the reply is a row we
 * just wrote. Everything past that is somebody saying so, because this
 * application cannot know whether a showing happened.
 *
 * AND NULL IS ITS OWN ANSWER. Every inquiry taken before migration 049 has no
 * stage, and 'new' is not an empty value -- it is the claim that nobody has
 * answered this person. Calling an answered lead 'new' puts it at the top of
 * this afternoon's calls, so an unset stage says it is unset.
 */

export const STAGES = [
  "new", "replied", "tour_booked", "toured", "applied", "approved",
] as const;

export type Stage = (typeof STAGES)[number];

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

/** What each one is called on screen, and whose move it is next.
 *
 *  `waitDays` is how long that stage is allowed to sit before it is somebody's
 *  job again. They differ by an order of magnitude on purpose: an unanswered
 *  lead is the expensive one and goes stale in a day, where a showing booked
 *  for next week is not late because it is five days away. */
export const STAGE_INFO: Record<Stage, {
  label: string; meaning: string; next: string; waitDays: number;
}> = {
  new:         { label: "Not answered yet", waitDays: 1,
                 meaning: "They have written and nobody has replied.",
                 next: "Reply to them." },
  replied:     { label: "Replied, waiting on them", waitDays: 3,
                 meaning: "We have answered and it is their move.",
                 next: "Chase if they have gone quiet." },
  tour_booked: { label: "Showing booked", waitDays: 7,
                 meaning: "A showing is arranged.",
                 next: "Confirm the day before, then mark it shown." },
  toured:      { label: "Has seen it", waitDays: 2,
                 meaning: "They have been to the lot.",
                 next: "Ask whether they want it, and send the application." },
  applied:     { label: "Application in", waitDays: 3,
                 meaning: "An application is in and is being screened.",
                 next: "Screen it and give them an answer." },
  approved:    { label: "Approved", waitDays: 3,
                 meaning: "Screened and approved, no lease signed yet.",
                 next: "Get the lease signed, then close the inquiry as leased." },
};

/** The sentence on the card. A stage that was never set says so, in those
 *  words -- it is not reported as "Not answered yet", which is a claim about
 *  work somebody may well have done. */
export function stageSays(stage: Stage | null | undefined): string {
  if (!stage || !isStage(stage)) {
    return "No stage recorded. This one was taken before the board kept track,"
      + " so nobody has said where it got to.";
  }
  return STAGE_INFO[stage].meaning;
}

export function stageLabel(stage: Stage | null | undefined): string {
  return stage && isStage(stage) ? STAGE_INFO[stage].label : "Stage not set";
}

/** Whole days between two instants, floored. Never negative: a stage_at in
 *  the future is a clock disagreement, not a lead that has been waiting for
 *  minus two days. */
export function daysSince(at: string | Date | null | undefined, now: Date): number | null {
  if (!at) return null;
  const t = at instanceof Date ? at.getTime() : Date.parse(at);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

export type Waiting =
  | { late: true; days: number; why: string }
  | { late: false; days: number | null }
  | { late: false; days: null; unknown: true; why: string };

/**
 * Whether this one has sat too long, and why.
 *
 * Two things are refused rather than guessed. A lead with no stage cannot be
 * late, because being late is measured from a move and no move was recorded
 * -- it is reported as needing a stage instead, which is the actual next
 * action. And a stage with no `stage_at` is the same gap: the column arrived
 * after the rows did.
 */
export function waiting(
  row: { stage?: Stage | null; stageAt?: string | null },
  now: Date,
): Waiting {
  if (!row.stage || !isStage(row.stage)) {
    return { late: false, days: null, unknown: true,
             why: "Nobody has said where this one got to." };
  }
  const days = daysSince(row.stageAt, now);
  if (days === null) {
    return { late: false, days: null, unknown: true,
             why: `Marked ${STAGE_INFO[row.stage].label.toLowerCase()}, but not when.` };
  }
  const allowed = STAGE_INFO[row.stage].waitDays;
  if (days > allowed) {
    return { late: true, days,
             why: `${STAGE_INFO[row.stage].label} for ${days} day${days === 1 ? "" : "s"}.`
               + ` ${STAGE_INFO[row.stage].next}` };
  }
  return { late: false, days };
}

/** The order the board sorts in: the ones somebody has to do something about
 *  first, then the ones with no stage, then by how long they have sat.
 *
 *  Not by date received. A lead from this morning that nobody has answered
 *  outranks one from last week that is waiting on a signature, and sorting by
 *  arrival puts them the other way round. */
export function chaseOrder<T extends { stage?: Stage | null; stageAt?: string | null }>(
  rows: T[], now: Date,
): T[] {
  const rank = (r: T) => {
    const w = waiting(r, now);
    if (w.late) return 0;
    if ("unknown" in w) return 1;
    return 2;
  };
  return [...rows].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return (daysSince(b.stageAt, now) ?? -1) - (daysSince(a.stageAt, now) ?? -1);
  });
}
