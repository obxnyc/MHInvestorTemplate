/**
 * A day on the clock.
 *
 * One button for the labourer -- on, then off -- and underneath it the three
 * things the office has to be able to say without arguing: how long somebody
 * worked, whether they took the break they are owed, and whether the day ran
 * past the cap.
 *
 * Four rules, and each exists because the obvious version is wrong in a way
 * that costs somebody money.
 *
 * A SHIFT STILL RUNNING IS NOT HOURS WORKED. "Six hours so far" and "six
 * hours worked" are different claims and only one of them can be signed off.
 * Everything here keeps them apart, because a day totalled while somebody is
 * still on site is a figure that changes after it has been agreed.
 *
 * A BREAK NOBODY RECORDED IS NOT A BREAK TAKEN. The tempting shortcut is to
 * dock half an hour off any long shift. That is deducting pay for something
 * there is no evidence of, which is the exact thing a wage claim is about.
 * Breaks come off only when they were taken, and a long shift with none
 * recorded is a prompt, never a deduction.
 *
 * A SHIFT NOBODY CLOSED IS ITS OWN STATE. A phone dies at two o'clock and the
 * shift runs forever. Closing it silently at eight hours invents an end time;
 * leaving it open adds sixteen hours to the day. It is neither: it is flagged,
 * with the last thing we heard, for somebody to settle.
 *
 * AND THE DAY IS THE DAY IT STARTED ON. A shift from ten at night to two in
 * the morning is one shift on the first day, not two hours on each.
 */

export type Break = { startedAt: string; endedAt: string | null };

export type Shift = {
  id: string;
  staffId: string;
  propertyId: string | null;
  startedAt: string;
  endedAt: string | null;
  breaks?: Break[];
  /** Set when the labourer has agreed the hours. */
  signedOffAt?: string | null;
};

export type Rules = {
  /** Hours past which the day needs looking at. */
  dailyCap: number;
  /** A shift longer than this with no break recorded gets a nudge. */
  breakAfter: number;
  /** How long a break has to be to count as the one they are owed. */
  breakMinutes: number;
  /** A shift still open this long after it started was not clocked out of. */
  abandonedAfter: number;
};

export const RULES: Rules = {
  dailyCap: 10,
  breakAfter: 6,
  breakMinutes: 30,
  abandonedAfter: 14,
};

const HOUR = 3_600_000;
const ms = (iso: string) => new Date(iso).getTime();

export type Worked = {
  /** Hours on completed shifts, breaks deducted. The only number that may be
   *  signed off. */
  hours: number;
  /** Hours accumulating on a shift that is still running. Kept apart on
   *  purpose -- it is not worked time until it stops. */
  running: number;
  /** Minutes of break actually recorded and finished. */
  breakMinutes: number;
  /** Shifts still open past the point anybody works. */
  abandoned: Shift[];
  /** True while any shift is open, abandoned or not. */
  onTheClock: boolean;
};

/** Hours on one shift, breaks deducted. Null while it is still running. */
export function shiftHours(s: Shift, rules: Rules = RULES): number | null {
  if (!s.endedAt) return null;
  const gross = ms(s.endedAt) - ms(s.startedAt);
  if (!(gross > 0)) return 0;
  return Math.max(0, (gross - takenMs(s)) / HOUR);
}

/** Break time actually recorded AND finished, in milliseconds. A break
 *  somebody started and never ended is not a measured break, and guessing its
 *  length would dock pay for a guess. */
function takenMs(s: Shift): number {
  return (s.breaks ?? []).reduce((a, b) => {
    if (!b.endedAt) return a;
    const d = ms(b.endedAt) - ms(b.startedAt);
    return a + (d > 0 ? d : 0);
  }, 0);
}

export function breakMinutesOf(s: Shift): number {
  return Math.round(takenMs(s) / 60_000);
}

/**
 * What a set of shifts adds up to.
 *
 * `now` is a parameter and never the clock, because a total that reads the
 * time cannot be checked.
 */
export function worked(shifts: Shift[], now: Date, rules: Rules = RULES): Worked {
  let hours = 0, running = 0, mins = 0;
  const abandoned: Shift[] = [];
  let onTheClock = false;

  for (const s of shifts) {
    mins += breakMinutesOf(s);
    if (s.endedAt) { hours += shiftHours(s, rules) ?? 0; continue; }

    onTheClock = true;
    const open = (now.getTime() - ms(s.startedAt)) / HOUR;
    // Past the point anybody works, this is a shift somebody forgot rather
    // than a shift still happening. It contributes no hours either way --
    // inventing an end time and adding sixteen hours are both wrong.
    if (open >= rules.abandonedAfter) abandoned.push(s);
    else running += Math.max(0, open - takenMs(s) / HOUR);
  }

  return {
    hours: Math.round(hours * 100) / 100,
    running: Math.round(running * 100) / 100,
    breakMinutes: mins,
    abandoned,
    onTheClock,
  };
}

export type Nudge = {
  key: "break" | "cap" | "sign-off" | "left-open";
  says: string;
  /** True when this is about pay or hours rather than a reminder. */
  urgent?: boolean;
};

/**
 * What to say to somebody about their day.
 *
 * Every one of these goes out as a push, so the bar is that it would be worth
 * a phone buzzing in somebody's pocket. A reminder nobody needs is how people
 * learn to ignore the ones they do.
 */
export function nudges(w: Worked, shifts: Shift[], now: Date, rules: Rules = RULES): Nudge[] {
  const out: Nudge[] = [];

  if (w.abandoned.length) {
    out.push({
      key: "left-open",
      urgent: true,
      says: w.abandoned.length === 1
        ? "A shift was never clocked out of. Say when you finished and it will be put right."
        : `${w.abandoned.length} shifts were never clocked out of.`
          + " Say when you finished each one.",
    });
  }

  // The break nudge is about the shift they are ON, not the day's total: a
  // man six hours into one stretch needs lunch, and the same six hours split
  // across the morning and afternoon does not mean he missed it.
  const longest = shifts.find((s) => {
    const span = ((s.endedAt ? ms(s.endedAt) : now.getTime()) - ms(s.startedAt)) / HOUR;
    return span >= rules.breakAfter && breakMinutesOf(s) < rules.breakMinutes;
  });
  if (longest) {
    out.push({
      key: "break",
      says: `Over ${rules.breakAfter} hours without a break on the clock.`
        + " Take your lunch and tap Break so it is on the record.",
    });
  }

  // The cap counts what is running as well, because the point of telling
  // somebody is to tell them BEFORE they go past it rather than after.
  if (w.hours + w.running >= rules.dailyCap) {
    out.push({
      key: "cap",
      urgent: true,
      says: `That is ${Math.round((w.hours + w.running) * 10) / 10} hours today,`
        + ` over the ${rules.dailyCap} hour day. Clock out, or tell your foreman why not.`,
    });
  }

  // Nothing to sign off while somebody is still on the clock, and nothing to
  // sign off twice.
  const toSign = shifts.filter((s) => s.endedAt && !s.signedOffAt);
  if (!w.onTheClock && toSign.length) {
    out.push({
      key: "sign-off",
      says: `${w.hours} hours today. Have a look and sign it off.`,
    });
  }

  return out;
}

/** The day a shift belongs to, in the local calendar: the day it STARTED.
 *  A shift from ten at night to two in the morning is one shift on the first
 *  day, not two hours on each. */
export function dayOf(s: Shift, offsetMinutes = 0): string {
  const t = new Date(ms(s.startedAt) - offsetMinutes * 60_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`
    + `-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** Hours against each property, for putting labour cost where it was spent.
 *  A shift with no property on it is counted separately and NOT spread across
 *  the others -- labour filed against the wrong house is worse than labour
 *  filed against none, and the untagged total is the prompt to go and say. */
export function byProperty(shifts: Shift[], rules: Rules = RULES): {
  tagged: Record<string, number>; untagged: number;
} {
  const tagged: Record<string, number> = {};
  let untagged = 0;
  for (const s of shifts) {
    const h = shiftHours(s, rules);
    if (h === null) continue;
    if (s.propertyId) tagged[s.propertyId] = (tagged[s.propertyId] ?? 0) + h;
    else untagged += h;
  }
  for (const k of Object.keys(tagged)) tagged[k] = Math.round(tagged[k] * 100) / 100;
  return { tagged, untagged: Math.round(untagged * 100) / 100 };
}
