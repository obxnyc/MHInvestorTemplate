/**
 * A day's hours entered by the office (072): for the man whose phone was
 * dead, left in the truck, or never had the app. "Make sure his hours are
 * tracked" means the office can always put them on the record -- with its
 * own name on them, and the owner told.
 *
 * Pure: what was typed in goes in, the two moments in UTC come out, or the
 * reason it cannot be entered. Times are typed as the wall clock in Eastern
 * time, because that is the clock on the job; daylight saving is Intl's
 * problem, not the office's.
 */

export type Entry = {
  day: string;        // YYYY-MM-DD
  from: string;       // HH:MM, wall clock in tz
  to: string;         // HH:MM
  breakMinutes: number;
};

export type Checked =
  | { ok: true; startedAt: string; endedAt: string; breakMinutes: number }
  | { ok: false; why: string };

/** The longest day that can be entered in one go. Longer is a typo. */
export const MAX_HOURS = 16;

/** The UTC instant at which the wall clock in `tz` reads `day` `hhmm`. */
export function wallToUtc(day: string, hhmm: string, tz: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  // Guess as if UTC, then correct by what the zone's clock reads at the
  // guess; twice, so a guess that lands across a daylight-saving change
  // settles on the far side of it.
  const want = Date.UTC(y, mo - 1, da, h, mi);
  if (new Date(want).getUTCDate() !== da) return null; // 31 November
  let at = want;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
    const reads = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    at += want - reads;
  }
  return new Date(at);
}

export function checkEntry(e: Entry, tz: string, now: Date): Checked {
  const s = wallToUtc(e.day, e.from, tz);
  const f = wallToUtc(e.day, e.to, tz);
  if (!s) return { ok: false, why: "Give the day and the time he started." };
  if (!f) return { ok: false, why: "Give the time he finished." };
  if (f <= s) return { ok: false, why: "He has to finish after he started. (Past midnight is two entries.)" };
  const hours = (f.getTime() - s.getTime()) / 3_600_000;
  if (hours > MAX_HOURS) return { ok: false, why: `That is more than ${MAX_HOURS} hours in one day.` };
  if (f.getTime() > now.getTime() + 60_000) return { ok: false, why: "Hours can't be entered for time that hasn't happened yet." };
  const b = Number.isFinite(e.breakMinutes) ? Math.round(e.breakMinutes) : 0;
  if (b < 0) return { ok: false, why: "A break can't be negative." };
  if (b >= hours * 60) return { ok: false, why: "The break is longer than the day." };
  return { ok: true, startedAt: s.toISOString(), endedAt: f.toISOString(), breakMinutes: b };
}

/** Two stretches of time that share any of it. */
export const overlaps = (a0: string, a1: string | null, b0: string, b1: string | null) =>
  Date.parse(a0) < (b1 ? Date.parse(b1) : Infinity) && Date.parse(b0) < (a1 ? Date.parse(a1) : Infinity);
