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
import { alongAxis, inRing, nearestOn, placeOn, sameStreet,
         type Road, type Shape } from "./osm";
import type { Plan, PlanRow } from "./parkplan";

export type Pad = {
  id: string; label: string; street: string; side: "N" | "S"; ring: number[][];
};

/** Every lot in the park, in order, evenly along its own street. */
export function layRows(
  plan: Plan, roads: Road[], parcel: number[][] | null, shapes: Shape[] = [],
): Pad[] {
  const mine = plan.rows
    .map((r) => roads.find((x) => sameStreet(r.street, x.name)))
    .filter((r): r is Road => Boolean(r));

  // Each building belongs to the street it is NEAREST, not to every
  // street within forty-five metres. The two streets here are fifty-seven
  // apart, so a row on one of them was claiming the facing row on the
  // other: Lady Cheryl ended up with twice the buildings it has, gave up,
  // and spread its lots down the middle of the park.
  const owns = new Map<Road, Shape[]>();
  for (const sh of shapes) {
    if (parcel && !inRing(sh.centre, parcel)) continue;
    let best: Road | null = null;
    let how = Infinity;
    for (const road of mine) {
      const d = placeOn(road, sh.centre).metres;
      if (d < how) { how = d; best = road; }
    }
    if (!best || how > 45) continue;
    owns.set(best, [...(owns.get(best) ?? []), sh]);
  }

  type Ready = {
    row: PlanRow; line: number[][]; lo: number; hi: number; offset: number;
    heading: number; here: { s: Shape; at: number }[];
    pitch: number; span: number; slot: Map<number, Shape>; west: number;
  };

  const ready: Ready[] = [];
  for (const row of plan.rows) {
    const road = roads.find((r) => sameStreet(row.street, r.name));
    if (!road) continue;

    const on = (owns.get(road) ?? []).filter((sh) =>
      placeOn(road, sh.centre).north === (row.side === "N"));
    const offset = offsetFor(row, road, owns.get(road) ?? [], plan);

    // The leg of the loop this row's homes are on, not the whole loop:
    // Lady Viola and Lady Cheryl meet at the horseshoe, so walking "the
    // street" carries a row round the bend and back up the other side.
    const leg = legFor(road.line, on);
    // Positions are measured along the whole leg, which runs past the
    // park, so nothing clamps at an end and piles two lots on one spot.
    // The stretch the row can use -- clipped for THIS row, since a pad
    // sits fifteen metres off the road -- only says where it may start
    // and stop.
    const line = westToEast(densify(leg, 2));
    const usable = westToEast(clipFor(leg, parcel, row.side, offset));
    if (line.length < 2 || usable.length < 2) continue;
    const lo = alongOn(line, [usable[0][0], usable[0][1]]);
    const hi = alongOn(line, [usable[usable.length - 1][0], usable[usable.length - 1][1]]);

    // One heading for the whole row. Every home in this park is the same
    // model on the same pad and they stand in line; taking each pad's
    // angle from its own neighbours let them fan a few degrees apart and
    // catch each other's corners.
    const heading = bearingOf(
      [usable[0][0], usable[0][1]],
      [usable[usable.length - 1][0], usable[usable.length - 1][1]],
    );

    const here = on
      .map((sh) => ({ s: sh, at: alongOn(line, sh.centre) }))
      .sort((a, b) => a.at - b.at);

    // The pitch, from the gaps between neighbours with nothing missing
    // between them -- the small ones. A median over all the gaps is
    // dragged up by every double gap.
    const gaps: number[] = [];
    for (let i = 1; i < here.length; i++) gaps.push(here[i].at - here[i - 1].at);
    const rough = gaps.length
      ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
    const close = gaps.filter((g) => g < rough * 1.5).sort((a, b) => a - b);
    const pitch = close.length ? close[Math.floor(close.length / 2)] : rough;

    // Which lot each building is, counted one gap at a time. Dividing the
    // distance from the first building by the pitch compounds a small
    // error in the pitch into a whole lot across a row of thirteen.
    const slot = new Map<number, Shape>();
    let span = 0;
    if (here.length) {
      slot.set(0, here[0].s);
      for (let i = 1; i < here.length; i++) {
        span += Math.max(1, Math.round(gaps[i - 1] / pitch));
        slot.set(span, here[i].s);
      }
    }

    ready.push({
      row, line, lo, hi, offset, heading, here, pitch, span, slot,
      // Where this row's first home sits on one axis shared by the whole
      // park, so the four rows can be compared with each other.
      west: here.length
        ? alongAxis(plan.centre, plan.bearing, here[0].s.centre) : Infinity,
    });
  }

  // One heading for the whole park, not one per row.
  //
  // A step ladder: every home is a rung, all of them square to the same
  // line. The two streets are the legs of one loop and the map traces
  // them a degree or two apart, which is enough for the rows to read as
  // slightly fanned rather than as a park. Averaged as directions rather
  // than as numbers, because 179 degrees and 1 degree are two degrees
  // apart and their arithmetic mean is ninety.
  let sumX = 0, sumY = 0;
  for (const r of ready) {
    const a = (r.heading * Math.PI) / 90;
    sumX += Math.cos(a); sumY += Math.sin(a);
  }
  const parkHeading = ready.length
    ? ((Math.atan2(sumY, sumX) * 90) / Math.PI + 180) % 180
    : plan.bearing;
  for (const r of ready) r.heading = parkHeading;

  // Where the park begins. Every row starts at the same end of the site,
  // so a row whose first home is two pitches further in is a row missing
  // two lots at the entrance -- which is the only honest evidence there
  // is about where the empty pads are. The boundary is not: it runs on
  // past the last home to the kerb of Pamalee Drive, and reading that as
  // room for two more lots is what kept putting 3124 and 3122 at the
  // wrong end of Lady Viola.
  const edge = Math.min(...ready.map((r) => r.west).filter(Number.isFinite));

  const out: Pad[] = [];
  for (const r of ready) {
    const n = r.row.numbers.length;
    const mk = (label: string, at: number) => {
      const w = walk(r.line, at);
      return {
        id: `${r.row.street}|${label}`, label,
        street: r.row.street, side: r.row.side,
        ring: footprint(
          padAt(w.point, r.heading, r.row.side, r.offset)[1],
          padAt(w.point, r.heading, r.row.side, r.offset)[0],
          awayFrom(r.heading, r.row.side), plan.size,
        ),
      };
    };

    // Nothing from the map: spread them evenly over what there is.
    if (r.here.length < 2 || !(r.pitch > 3) || r.span >= n) {
      const room = r.hi - r.lo;
      out.push(...r.row.numbers.map((label, k) =>
        mk(label, r.lo + ((k + 0.5) / n) * (room > 0 ? room : n * plan.padSpacing))));
      continue;
    }

    // The grid, fitted to the homes the map has: the distance from the
    // first to the last over the lots between them.
    const step = r.span > 0
      ? (r.here[r.here.length - 1].at - r.here[0].at) / r.span : r.pitch;
    const spare = n - 1 - r.span;
    const before = Number.isFinite(edge)
      ? Math.max(0, Math.min(spare, Math.round((r.west - edge) / step)))
      : 0;

    // Every lot on the grid, at one angle, one pitch apart. Putting each
    // pad on its own building's middle instead let a pad traced a metre
    // out sit a metre out, and two of them overlap.
    //
    // Not nudged to fit the boundary. The park's own rows say where a row
    // starts -- they all begin at the same end of the site -- and the
    // boundary is a traced polygon that can be a few metres out. Shifting
    // a row east by a whole pitch to satisfy it indented that row against
    // its neighbours, which is wrong in a way anybody can see, to fix
    // something nobody can.
    const first = r.here[0].at - before * step;

    out.push(...r.row.numbers.map((label, k) => mk(label, first + k * step)));
  }
  return out;
}

/** How far along a line the nearest point to something is, in metres. */
export function alongOn(line: number[][], to: [number, number]): number {
  let run = 0, best = 0, how = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a: [number, number] = [line[i][0], line[i][1]];
    const b: [number, number] = [line[i + 1][0], line[i + 1][1]];
    const seg = metresBetween(a, b);
    if (seg > 0) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1,
        ((to[0] - a[0]) * dx + (to[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      const p: [number, number] = [a[0] + t * dx, a[1] + t * dy];
      const d = metresBetween(p, to);
      if (d < how) { how = d; best = run + t * seg; }
    }
    run += seg;
  }
  return best;
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

/**
 * The stretch of street whose homes are inside the boundary.
 *
 * Trimming the street itself is not the same question. A pad sits a good
 * fifteen metres back from the road, so where the boundary steps in -- the
 * notch by the Pamalee entrance -- the road runs on happily while the row
 * beside it would be standing in next door's yard.
 */
export function clipFor(
  line: number[][], ring: number[][] | null, side: "N" | "S", offset: number,
  step = 2,
): number[][] {
  if (!ring || ring.length < 4 || line.length < 2) return line;
  const dense = densify(line, step);

  let best: number[][] = [];
  let run: number[][] = [];
  for (let i = 0; i < dense.length; i++) {
    const a: [number, number] = [dense[i][0], dense[i][1]];
    const b: [number, number] = i + 1 < dense.length
      ? [dense[i + 1][0], dense[i + 1][1]]
      : [dense[i - 1][0], dense[i - 1][1]];
    const heading = i + 1 < dense.length ? bearingOf(a, b) : bearingOf(b, a);
    const where = padAt(a, heading, side, offset);
    if (inRing(where, ring)) {
      run.push(dense[i]);
      if (run.length > best.length) best = run;
    } else {
      run = [];
    }
  }
  return lengthOf(best) >= 30 ? best : clipTo(line, ring, step);
}

/** Where a home on this side of the street, at this setback, would sit. */
export function padAt(
  on: [number, number], heading: number, side: "N" | "S", offset: number,
): [number, number] {
  const away = awayFrom(heading, side);
  const per = degreesPerMetre(on[1]);
  const b = (away * Math.PI) / 180;
  return [
    on[0] + Math.sin(b) * offset * per.lng,
    on[1] + Math.cos(b) * offset * per.lat,
  ];
}

/** Which way is "off the street, on this side". North is whichever of the
 *  two perpendiculars points north. */
export function awayFrom(heading: number, side: "N" | "S"): number {
  const left = (heading + 270) % 360;
  const right = (heading + 90) % 360;
  const northward = Math.cos((left * Math.PI) / 180) > 0 ? left : right;
  return side === "N" ? northward : (northward + 180) % 360;
}

/**
 * One street broken at its corners.
 *
 * Lady Viola and Lady Cheryl are the two legs of a single loop: they meet
 * at the horseshoe by the east boundary and come back. Whatever the map
 * calls each half, the geometry joins, so walking "the street" to lay a
 * row carries on round the bend and back up the other side -- and the row
 * either doubles back on itself or measures its last few homes against the
 * wrong leg.
 *
 * A home sits on a straight run of road. So the line is cut wherever it
 * turns more than a corner's worth, and a row takes the piece its own
 * homes are on.
 */
export function legs(line: number[][], maxTurn = 40): number[][][] {
  if (line.length < 3) return [line];

  // Cut where the road has turned away from the way this run started,
  // not where one joint is sharp. A horseshoe turns a hundred and eighty
  // degrees over a dozen gentle segments and no single one of them is a
  // corner, so looking at joints finds nothing and the row carries on
  // round the bend.
  const out: number[][][] = [];
  let run: number[][] = [line[0]];
  let heading: number | null = null;

  for (let i = 1; i < line.length; i++) {
    const a: [number, number] = [line[i - 1][0], line[i - 1][1]];
    const b: [number, number] = [line[i][0], line[i][1]];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const dir = bearingOf(a, b);
    if (heading === null) heading = dir;
    // How far this segment has turned from the way the run started.
    // Nought when it carries straight on, a hundred and eighty when it
    // comes back the other way.
    const off = Math.abs(((dir - heading + 540) % 360) - 180);
    if (off > maxTurn && run.length >= 2) {
      out.push(run);
      run = [line[i - 1]];
      heading = dir;
    }
    run.push(line[i]);
  }
  out.push(run);
  return out.filter((r) => r.length >= 2);
}

/** Of a street's straight runs, the one this row's homes are on. The
 *  longest, where the row has no homes to go by. */
export function legFor(line: number[][], on: Shape[]): number[][] {
  const pieces = legs(line);
  if (pieces.length === 1) return pieces[0];
  let best = pieces[0];
  let score = -1;
  for (const piece of pieces) {
    const near = on.filter((sh) => nearestOn(piece, sh.centre).metres <= 45).length;
    const mark = near * 1e6 + lengthOf(piece);
    if (mark > score) { score = mark; best = piece; }
  }
  return best;
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
