/**
 * Showing times somebody may pick.
 *
 * Pure: hours, rules, what is already booked and the clock go in, a list of
 * start times comes out. No I/O, so the arithmetic that decides whether two
 * people are sent to the same door at the same minute can be tested without a
 * database.
 *
 * Everything is worked in the wall-clock time of the place the homes are,
 * because "Saturday 10 to 2" means 10 to 2 in Elizabeth City whatever zone the
 * server is in -- and the server is in UTC. The one hard part is turning
 * "10:00 on the 8th, there" into an instant on a day the clocks change, and
 * that is done by asking Intl what the offset is rather than assuming one.
 */

export type Hours = { weekday: number; starts: string; ends: string };
export type Rules = {
  slotMinutes: number;
  noticeMinutes: number;
  horizonDays: number;
  /** How many showings can run in the same slot. One office, one person
   *  showing: one. */
  atOnce: number;
};
export type Busy = { start: string; end?: string | null };
export type Slot = { start: string; end: string; day: string };

export const DEFAULT_RULES: Rules = {
  slotMinutes: 30, noticeMinutes: 120, horizonDays: 14, atOnce: 1,
};

/** Minutes the zone is ahead of UTC at this instant (-240 for EDT). */
export function offsetMinutes(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"),
    get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The instant at which the wall clock in `zone` reads this date and time. */
export function wallToUtc(day: string, time: string, zone: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetMinutes(new Date(guess), zone);
  let t = guess - first * 60000;
  // Across a change the offset at the guess and at the answer differ; the
  // second reading is the one that belongs to the answer.
  const second = offsetMinutes(new Date(t), zone);
  if (second !== first) t = guess - second * 60000;
  return new Date(t);
}

/** The local calendar date and weekday of an instant, in `zone`. */
export function localDay(at: Date, zone: string): { day: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: names.indexOf(get("weekday")),
  };
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
const hhmm = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/**
 * Every start time still open.
 *
 * A slot is open when it is inside a window of showing hours, starts at least
 * `noticeMinutes` from now, is within `horizonDays`, and fewer than `atOnce`
 * booked showings overlap it. Overlap rather than equal start times, because
 * a showing booked before the slot length changed does not start on the new
 * grid and still has a person standing in a home.
 */
export function openSlots(
  hours: Hours[], rules: Rules, busy: Busy[], now: Date, zone: string,
): Slot[] {
  const slot = Math.max(5, rules.slotMinutes) * 60000;
  const earliest = now.getTime() + Math.max(0, rules.noticeMinutes) * 60000;
  const today = localDay(now, zone).day;
  const taken = busy.map((b) => {
    const s = Date.parse(b.start);
    const e = b.end ? Date.parse(b.end) : s + slot;
    return [s, e] as const;
  }).filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e));

  const out: Slot[] = [];
  for (let i = 0; i <= rules.horizonDays; i++) {
    const day = addDays(today, i);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const windows = hours.filter((h) => h.weekday === weekday)
      .sort((a, b) => minutes(a.starts) - minutes(b.starts));
    for (const w of windows) {
      const from = minutes(w.starts), to = minutes(w.ends);
      for (let m = from; m + rules.slotMinutes <= to; m += rules.slotMinutes) {
        const start = wallToUtc(day, hhmm(m), zone).getTime();
        const end = start + slot;
        if (start < earliest) continue;
        const clash = taken.filter(([s, e]) => s < end && e > start).length;
        if (clash >= Math.max(1, rules.atOnce)) continue;
        // Two overlapping windows would offer the same minute twice.
        if (out.some((o) => Date.parse(o.start) === start)) continue;
        out.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), day });
      }
    }
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Is this exact start time one of the open ones? Asked again at booking,
 *  because the list somebody picked from may be ten minutes old. */
export function stillOpen(start: string, open: Slot[]): Slot | null {
  const t = Date.parse(start);
  return open.find((s) => Date.parse(s.start) === t) ?? null;
}
