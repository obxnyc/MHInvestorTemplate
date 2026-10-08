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

/**
 * The part of a street inside the boundary.
 *
 * Keeping the vertices that fall inside is the obvious way to do this and
 * it is badly wrong, because a street is not a dense line: OpenStreetMap
 * traces a straight road as two points a few hundred metres apart. A road
 * that crosses the whole park can have no vertex inside it at all, or two
 * at one end, and the row then gets laid along a stub a few metres long --
 * which is fifty one pads in a heap in the corner of the park.
 *
 * So the line is walked at a couple of metres a step first. The kept run is
 * then within a step of the real crossing, which is closer than anyone can
 * see, and it cannot depend on where a volunteer happened to click.
 */
export function clipTo(line: number[][], ring: number[][] | null, step = 2): number[][] {
  if (!ring || ring.length < 4 || line.length < 2) return line;

  const dense = densify(line, step);
  let best: number[][] = [];
  let run: number[][] = [];
  for (const p of dense) {
    if (inRing([p[0], p[1]], ring)) {
      run.push(p);
      if (run.length > best.length) best = run;
    } else {
      run = [];
    }
  }
  // A street with only its ends inside, or none of it, is better used
  // whole than reduced to a stub.
  return lengthOf(best) >= 30 ? best : line;
}

/** The same line with a point every few metres, so that asking whether it
 *  is inside something is a question about the line and not about how
 *  somebody chose to trace it. */
export function densify(line: number[][], step = 2): number[][] {
  const out: number[][] = [line[0]];
  for (let i = 0; i < line.length - 1; i++) {
    const a: [number, number] = [line[i][0], line[i][1]];
    const b: [number, number] = [line[i + 1][0], line[i + 1][1]];
    const d = metresBetween(a, b);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  }
  return out;
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

/**
 * The boundary pushed out to the road it fronts.
 *
 * The park's parcel runs up to Pamalee Drive -- the owner's own deed line
 * is the road -- but the landuse polygon the map carries stops short of it,
 * because somebody traced the back of the verge rather than the right of
 * way. Left as traced, the property line floats in the air next to the road
 * it is supposed to meet.
 *
 * So any corner already close to the road is put on the road. Close is a
 * short distance on purpose: the notch near the entrance is a real step
 * back in the deed, and a generous reach would iron it flat and lose the
 * one feature of this boundary anybody would recognise.
 */
export function reachTo(
  ring: number[][], road: number[][] | null, within = 30,
): number[][] {
  if (!road || road.length < 2 || ring.length < 4) return ring;
  const dense = densify(road, 3);

  const out = ring.map((p) => {
    let best: number[] | null = null;
    let d = Infinity;
    for (const q of dense) {
      const m = metresBetween([p[0], p[1]], [q[0], q[1]]);
      if (m < d) { d = m; best = q; }
    }
    return best && d <= within ? [best[0], best[1]] : p;
  });
  // Closed ring in, closed ring out.
  out[out.length - 1] = out[0];
  return out;
}
