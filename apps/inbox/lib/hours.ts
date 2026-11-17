/**
 * Is the office open?
 *
 * Asked in the office's own time zone, not the server's. Vercel runs in UTC,
 * so 6 p.m. in Elizabeth City is 22:00 or 23:00 there depending on the time of
 * year, and a check written against the server clock would close the office
 * an hour early for half of every year. Intl knows about daylight saving.
 */

export type Hours = {
  tz: string;
  open_at: string;     // "08:00" or "08:00:00"
  close_at: string;    // "18:00"
  open_days: number[]; // ISO weekdays, Monday = 1
};

const DAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Weekday and minute-of-day where the office is. */
export function localClock(at: Date, tz: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    day: DAY[get("weekday")] ?? 0,
    minute: parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10),
  };
}

/** Open from `open_at` up to but not including `close_at`. A call at 5:59 is
 *  answered; a call at 6:00 hears the after-hours greeting. */
export function isOpen(h: Hours, at: Date = new Date()): boolean {
  const { day, minute } = localClock(at, h.tz);
  if (!h.open_days.includes(day)) return false;
  return minute >= minutes(h.open_at) && minute < minutes(h.close_at);
}
