/**
 * Clocking a man in and out by where his phone is, for the people the owner
 * ticks "Clocks in automatically" on Crews & texts (072).
 *
 * "He is just very bad with phone." So his phone does it: the installed app
 * watches for him ARRIVING AT A JOB SITE on a work day, and clocks him in at
 * the time he got there; when he has been away from every job site for a
 * while, it clocks him out at the time he left.
 *
 * NOTHING IS SENT BEFORE HE IS ON THE CLOCK. Off the clock every fix is
 * compared here, on the phone, against the job sites' pins, and thrown away.
 * The only thing that ever leaves the phone is "he arrived at X at 7:12" --
 * the clock-in itself. Tracking belongs to the shift, not to the login.
 *
 * Pure. Fixes go in, one at a time, with what the phone remembers; a decision
 * comes out. The screen does the sending. Every rule has its own case in
 * auto-clock.test.mjs, built so that only that rule can answer it.
 */

import { metresBetween, type Fix } from "./fence";

export type Site = { id: string; name: string; lat: number | null; lng: number | null; radius: number };

/** What the screen knows about the day. `days` are 0=Sunday..6, in `tz`. */
export type Window = {
  tz: string;
  days: number[];
  /** "HH:MM" the window opens. Earlier than this, arriving is not work. */
  from: string;
  /** "HH:MM" it shuts -- the clock's own auto clock-out time. */
  until: string | null;
};

export type Memory = {
  /** The site he is standing at and since when -- the arrival in progress. */
  at: { id: string; since: number } | null;
  /** The last moment a fix put him inside ANY job site. */
  lastInside: number | null;
};

export const FRESH: Memory = { at: null, lastInside: null };

export type Clocked = {
  /** On the clock at all. */
  on: boolean;
  /** The open shift was started by this rule. Only those are closed by it:
   *  a shift his lead or the office started is not this phone's to end. */
  auto: boolean;
  startedAt: number | null;
};

export type Decision =
  | { act: "in"; siteId: string; siteName: string; at: number }
  | { act: "out"; at: number }
  | null;

/** A fix vaguer than this is no evidence of standing anywhere. */
export const VAGUE_M = 150;
/** Standing at a site this long is arriving, not driving past. */
export const ARRIVE_MS = 3 * 60_000;
/** Away from every site this long is gone for the day (or long enough that
 *  the gap is his to explain). A run to Lowe's is shorter. */
export const AWAY_MS = 45 * 60_000;
/** How far outside a site's radius still counts as at it. Pins are dropped
 *  on an address, and the work is wherever the home is on the lot. */
const SLACK_M = 40;
/** And how clearly outside it has to be to count as gone. */
const GONE_M = 150;

const pinned = (s: Site): s is Site & { lat: number; lng: number } =>
  s.lat !== null && s.lng !== null && Number.isFinite(s.lat) && Number.isFinite(s.lng);

/** The site the fix is clearly at, nearest first. */
function siteAt(fix: Fix, sites: Site[]): Site | null {
  const acc = fix.accuracy ?? Infinity;
  if (acc > VAGUE_M) return null;
  let best: { s: Site; m: number } | null = null;
  for (const s of sites) {
    if (!pinned(s)) continue;
    const m = metresBetween(fix, s);
    if (m <= s.radius + SLACK_M && (!best || m < best.m)) best = { s, m };
  }
  return best?.s ?? null;
}

/** Clearly away from every pinned site: even the closest reading of the fix
 *  is well outside each one. A vague fix is never "away" -- not knowing where
 *  he is is not evidence that he left. */
function awayFromAll(fix: Fix, sites: Site[]): boolean {
  const acc = fix.accuracy ?? Infinity;
  if (acc > VAGUE_M) return false;
  return sites.filter(pinned).every((s) => metresBetween(fix, s) - acc > s.radius + GONE_M);
}

/** The wall clock in `tz`. */
function local(when: number, tz: string): { dow: number; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(new Date(when)).map((p) => [p.type, p.value]));
  return {
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const mins = (hhmm: string | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** A work day, inside working hours. Arriving at a job on a Sunday evening
 *  to look at a roof is not a shift. */
export function inWindow(when: number, w: Window): boolean {
  const l = local(when, w.tz);
  if (!w.days.includes(l.dow)) return false;
  const from = mins(w.from) ?? 0;
  const until = mins(w.until) ?? 24 * 60;
  return l.minutes >= from && l.minutes < until;
}

/**
 * One fix in, a decision out, and the memory to keep for the next fix.
 * `now` is when the fix was taken.
 */
export function step(
  fix: Fix | null, now: number, sites: Site[], w: Window, clock: Clocked, mem: Memory,
): { decision: Decision; mem: Memory } {
  if (!fix) return { decision: null, mem };
  const here = siteAt(fix, sites);
  const lastInside = here ? now : mem.lastInside;

  if (!clock.on) {
    if (!here) return { decision: null, mem: { at: null, lastInside } };
    // The arrival restarts if he is now at a different site than before.
    const at = mem.at && mem.at.id === here.id ? mem.at : { id: here.id, since: now };
    const next = { at, lastInside };
    // Arrived: stood at one site long enough, and it began inside working
    // hours. Filed at the moment he got there, not the moment it was sure.
    if (now - at.since >= ARRIVE_MS && inWindow(at.since, w)) {
      return { decision: { act: "in", siteId: here.id, siteName: here.name, at: at.since },
               mem: { at: null, lastInside } };
    }
    return { decision: null, mem: next };
  }

  // On the clock. Only a shift this rule started is this rule's to end.
  if (!clock.auto) return { decision: null, mem: { at: null, lastInside } };
  if (here) return { decision: null, mem: { at: null, lastInside: now } };
  if (!awayFromAll(fix, sites)) return { decision: null, mem: { at: null, lastInside } };
  // Gone: clocked out at the last moment he was at a site, never earlier
  // than the shift itself began.
  const left = Math.max(lastInside ?? clock.startedAt ?? now, clock.startedAt ?? 0);
  if (now - left >= AWAY_MS) {
    return { decision: { act: "out", at: left }, mem: FRESH };
  }
  return { decision: null, mem: { at: null, lastInside } };
}
