/**
 * A day's trail: where somebody went, in what order, and where they stopped.
 *
 * "I want trails of where they went during the day with arrows that show
 *  which directions they were going -- to see if they are dilly-dallying from
 *  place to place or taking unnecessary detours. If they are at Lowe's they
 *  are technically still working." The owner.
 *
 * So the trail is not judged here. It is drawn: the dots in order, the way
 * each leg went, and the STOPS -- the places somebody stayed long enough to
 * be doing something there -- with how long, and whether the stop was one of
 * our job sites. Whether twenty-five minutes at Lowe's was a supply run is
 * the owner's call, and the map is what lets him make it.
 *
 * Pure: points in, trail out. The positions are only as good as the phone,
 * so a point vaguer than POOR is drawn but never used to start or end a stop
 * -- a cold-start fix a kilometre wide would otherwise invent a detour.
 */

import { metresBetween } from "./fence";

export type Point = {
  lat: number; lng: number; at: string;
  accuracy: number | null;
  /** How the point came to be: the clock-in tap, a ping, the clock-out tap. */
  kind: "in" | "ping" | "out";
};

export type Leg = {
  from: Point; to: Point;
  metres: number;
  /** Compass bearing of travel, degrees from north. */
  bearing: number;
};

export type Stop = {
  lat: number; lng: number;
  from: string; to: string;
  minutes: number;
  points: number;
  /** The job site this stop was at, if any. */
  site: { id: string; name: string } | null;
};

export type Site = { id: string; name: string; lat: number; lng: number; radius: number };

/** Staying within this of where you arrived is "still there". */
export const STOP_RADIUS = 120;
/** And this long is a stop rather than a slow drive past. */
export const STOP_MINUTES = 8;
/** A fix vaguer than this is drawn but not trusted to start or end a stop. */
export const POOR = 250;

const ms = (iso: string) => Date.parse(iso);

export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r)
    - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

export function trail(points: Point[], sites: Site[] = []): {
  points: Point[]; legs: Leg[]; stops: Stop[]; metres: number;
} {
  const pts = [...points]
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(ms(p.at)))
    .sort((a, b) => ms(a.at) - ms(b.at));

  const legs: Leg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const m = metresBetween(pts[i - 1], pts[i]);
    // Standing still is not a leg: no arrow for a phone that did not move.
    if (m < 15) continue;
    legs.push({ from: pts[i - 1], to: pts[i], metres: m, bearing: bearing(pts[i - 1], pts[i]) });
  }

  // Stops: a run of trustworthy points all within STOP_RADIUS of where the
  // run began, lasting STOP_MINUTES or more.
  const good = pts.filter((p) => p.accuracy === null || p.accuracy <= POOR);
  const stops: Stop[] = [];
  let i = 0;
  while (i < good.length) {
    let j = i;
    while (j + 1 < good.length && metresBetween(good[i], good[j + 1]) <= STOP_RADIUS) j++;
    const minutes = (ms(good[j].at) - ms(good[i].at)) / 60_000;
    if (minutes >= STOP_MINUTES) {
      const run = good.slice(i, j + 1);
      const lat = run.reduce((a, p) => a + p.lat, 0) / run.length;
      const lng = run.reduce((a, p) => a + p.lng, 0) / run.length;
      const at = sites
        .map((s) => ({ s, d: metresBetween({ lat, lng }, s) }))
        .filter(({ s, d }) => d <= s.radius + STOP_RADIUS)
        .sort((a, b) => a.d - b.d)[0]?.s ?? null;
      stops.push({
        lat, lng, from: good[i].at, to: good[j].at,
        minutes: Math.round(minutes), points: run.length,
        site: at ? { id: at.id, name: at.name } : null,
      });
      i = j + 1;
    } else {
      i++;
    }
  }

  return { points: pts, legs, stops, metres: legs.reduce((a, l) => a + l.metres, 0) };
}
