/**
 * The park laid out along its own streets.
 *
 * Two sources, each used for the one thing it is good at.
 *
 * The map is good at streets and at property lines. Lady Viola and Lady
 * Cheryl are traced accurately, bend and all, and the parcel is a surveyed
 * boundary. Those are taken as given.
 *
 * The map is bad at this park's homes. Some are missing, some are the
 * office or a carport, some are two pads traced as one shape, and the ones
 * that are there were traced by eye at different times. Every attempt to
 * build the park out of them produced a park that was irregular in exactly
 * the ways the real one is not: gaps in the wrong place, pads at odd
 * angles, rows that drifted off the end of the property.
 *
 * So the homes are not read from the map at all. The park is regular -- the
 * owner has said so from the first message, every home is the same model on
 * the same pad -- so each row is an even series of identical rectangles
 * along its street, inside the fence, in the order the house numbers run.
 * A plan, drawn to the real streets, rather than a tracing of someone
 * else's tracing.
 */

import {
  footprint, degreesPerMetre, bearingOf, metresBetween,
} from "./footprint";
import { inRing, placeOn, sameStreet, type Road, type Shape } from "./osm";
import type { Plan, PlanRow } from "./parkplan";

export type Pad = {
  id: string; label: string; street: string; side: "N" | "S"; ring: number[][];
};

/** Every lot in the park, in order, evenly along its own street. */
export function layRows(
  plan: Plan, roads: Road[], parcel: number[][] | null, shapes: Shape[] = [],
): Pad[] {
  const out: Pad[] = [];
  for (const row of plan.rows) {
    const road = roads.find((r) => sameStreet(row.street, r.name));
    if (!road) continue;
    const line = westToEast(clipTo(road.line, parcel));
    if (line.length < 2) continue;
    out.push(...layRow(plan, row, line, offsetFor(row, road, shapes, plan)));
  }
  return out;
}

function layRow(plan: Plan, row: PlanRow, line: number[][], offset: number): Pad[] {
  const n = row.numbers.length;
  const total = lengthOf(line);
  if (!(total > 0) || n < 1) return [];

  return row.numbers.map((label, k) => {
    // Each lot gets an equal share of the street and sits in the middle of
    // it, so the row is evenly spaced and neither end is jammed against
    // the fence.
    const at = ((k + 0.5) / n) * total;
    const { point, bearing } = walk(line, at);
    // The side of the street this row is on, as a direction. North is
    // whichever of the two perpendiculars points north.
    const left = (bearing + 270) % 360;
    const right = (bearing + 90) % 360;
    const northward = Math.cos((left * Math.PI) / 180) > 0 ? left : right;
    const away = row.side === "N" ? northward : (northward + 180) % 360;

    const per = degreesPerMetre(point[1]);
    const b = (away * Math.PI) / 180;
    const centre: [number, number] = [
      point[0] + Math.sin(b) * offset * per.lng,
      point[1] + Math.cos(b) * offset * per.lat,
    ];
    return {
      id: `${row.street}|${label}`, label, street: row.street, side: row.side,
      // A home stands square to its street: its length runs away from the
      // road, not along it.
      ring: footprint(centre[1], centre[0], away, plan.size),
    };
  });
}

/**
 * How far back from the street this row sits.
 *
 * Taken from the buildings the map does have, because that is a
 * measurement rather than a guess, and the map is reliable about where
 * things are even where it is unreliable about what they are. Falls back
 * to the plan's own figure where the map has nothing.
 */
export function offsetFor(
  row: PlanRow, road: Road, shapes: Shape[], plan: Plan,
): number {
  const want = row.side === "N";
  const across: number[] = [];
  for (const s of shapes) {
    const p = placeOn(road, s.centre);
    if (p.metres > 45 || p.north !== want) continue;
    across.push(p.metres);
  }
  if (across.length < 3) return plan.pairGap / 2;
  across.sort((a, b) => a - b);
  return across[Math.floor(across.length / 2)];
}

/** The part of a line inside the boundary: the longest unbroken run of it. */
export function clipTo(line: number[][], ring: number[][] | null): number[][] {
  if (!ring || ring.length < 4) return line;
  let best: number[][] = [];
  let run: number[][] = [];
  for (const p of line) {
    if (inRing([p[0], p[1]], ring)) {
      run.push(p);
      if (run.length > best.length) best = run;
    } else {
      run = [];
    }
  }
  // A street traced with only its ends inside, or none of it, is better
  // used whole than discarded.
  return best.length >= 2 ? best : line;
}

/** The same line, guaranteed to run west to east, which is the direction
 *  the house numbers count down in. */
export function westToEast(line: number[][]): number[] [] {
  if (line.length < 2) return line;
  return line[0][0] <= line[line.length - 1][0] ? line : [...line].reverse();
}

export function lengthOf(line: number[][]): number {
  let d = 0;
  for (let i = 0; i < line.length - 1; i++) {
    d += metresBetween(
      [line[i][0], line[i][1]], [line[i + 1][0], line[i + 1][1]],
    );
  }
  return d;
}

/**
 * A point so many metres along a line, and the way the line is going
 * there.
 *
 * Walking the polyline rather than interpolating between its ends, so a
 * street that bends -- Lady Cheryl does -- carries its row round the bend
 * with it instead of cutting the corner.
 */
export function walk(
  line: number[][], metres: number,
): { point: [number, number]; bearing: number } {
  let left = Math.max(0, metres);
  for (let i = 0; i < line.length - 1; i++) {
    const a: [number, number] = [line[i][0], line[i][1]];
    const b: [number, number] = [line[i + 1][0], line[i + 1][1]];
    const seg = metresBetween(a, b);
    if (seg <= 0) continue;
    if (left <= seg || i === line.length - 2) {
      const t = Math.min(1, left / seg);
      return {
        point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
        bearing: bearingOf(a, b),
      };
    }
    left -= seg;
  }
  const a: [number, number] = [line[0][0], line[0][1]];
  const b: [number, number] = [line[1][0], line[1][1]];
  return { point: a, bearing: bearingOf(a, b) };
}
