/**
 * Clocking in at a job: which one to suggest, and when to ask "are you sure?"
 *
 * "I clocked in at a job I am not actually at and it didn't prompt me. It
 *  should smart locate me and suggest a job site, and if I still want to
 *  override it I can -- but I don't want employees laying in bed saying they
 *  are on site." The owner, on his first clock-in.
 *
 * So the order is: where are you, then which job, then the clock. Never the
 * other way round, which is what it was -- clocked in first, asked the job
 * after, and nothing ever compared the two.
 *
 * Two rules that are not geometry, both from CLAUDE.md:
 *   - A clock-in is NEVER refused. A man who really is working and whose
 *     phone will not say where he is must still get his hours on record.
 *     What changes is that it goes in flagged, and the flag reaches his lead.
 *   - "Far" is its own test, not the fence's "outside". The fence answers
 *     "cannot tell" for any fix vaguer than 500m, which would wave through a
 *     phone that is plainly five miles away. Far means: even the most
 *     generous reading of the fix puts you outside the site.
 */

import { metresBetween, type Fix } from "./fence";

export type Place = {
  id: string; name: string; address: string | null;
  lat: number | null; lng: number | null;
  /** Metres from the pin that still counts as at the job. */
  radius: number;
};

export type Near = { place: Place; metres: number };

/** How far past a site's own radius a fix can be and still be suggested as
 *  "you look like you're here". Suggesting is cheap; it is a button the man
 *  can decline. Deciding "far" is the expensive one, and that is `check`. */
const SUGGEST_SLACK = 150;
/** Nothing further than this is offered as "nearby" -- a list of every job
 *  in the state, nearest first, is not a suggestion. */
const NEARBY_MAX = 80_000;

const pinned = (p: Place): p is Place & { lat: number; lng: number } =>
  p.lat !== null && p.lng !== null && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** The jobs near a fix, nearest first, and the one it looks like you are at. */
export function suggest(fix: Fix | null, places: Place[]): { here: Near | null; nearby: Near[] } {
  if (!fix) return { here: null, nearby: [] };
  const near = places.filter(pinned)
    .map((place) => ({ place, metres: metresBetween(fix, place) }))
    .filter((n) => n.metres <= NEARBY_MAX)
    .sort((a, b) => a.metres - b.metres);
  const acc = fix.accuracy ?? 0;
  const top = near[0] ?? null;
  // The nearest, if it is close enough to be the obvious answer. Only ever
  // the nearest: two sites both "close" is still answered by the closer one.
  const here = top && top.metres - Math.min(acc, 300) <= top.place.radius + SUGGEST_SLACK ? top : null;
  return { here, nearby: near.slice(0, 5) };
}

export type Check =
  | { kind: "ok"; metres: number }
  | { kind: "far"; metres: number }
  /** The job has no pin, so nothing can be compared. Said, not hidden. */
  | { kind: "nopin" }
  /** The phone gave no position at all. */
  | { kind: "nofix" };

/** Whether to ask "are you sure?" before clocking in at `place`. */
export function check(fix: Fix | null, place: Place): Check {
  if (!fix) return { kind: "nofix" };
  if (!pinned(place)) return { kind: "nopin" };
  const metres = metresBetween(fix, place);
  // The most generous reading: the phone is as far TOWARDS the site as its
  // own error bar allows. A fix with no accuracy is taken at its word here --
  // being generous to a man is the right side to err on for a question.
  const best = metres - (fix.accuracy ?? 0);
  return best > place.radius ? { kind: "far", metres } : { kind: "ok", metres };
}

/** "0.3 mi", "4.2 mi", "250 ft" -- how far, the way anybody here says it. */
export function howFar(metres: number): string {
  const feet = metres * 3.28084;
  if (feet < 1000) return `${Math.max(50, Math.round(feet / 50) * 50)} ft`;
  const miles = metres / 1609.344;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}
