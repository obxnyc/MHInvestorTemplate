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
  const mine = plan.rows
    .map((r) => roads.find((x) => sameStreet(r.street, x.name)))
    .filter((r): r is Road => Boolean(r));

  // Each building belongs to the street it is NEAREST, not to every
  // street within forty-five metres. The two streets here are fifty-seven
  // apart, so a row on one of them was claiming the facing row on the
  // other: Lady Cheryl ended up with twice the buildings it has, gave up,
  // and spread its lots evenly down the middle of the park.
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

  const out: Pad[] = [];
  for (const row of plan.rows) {
    const road = roads.find((r) => sameStreet(row.street, r.name));
    if (!road) continue;
    const offset = offsetFor(row, road, owns.get(road) ?? [], plan);

    // Two lines, for two different jobs. Positions are measured along the
    // whole street, which runs well past the park, so nothing clamps at
    // an end and piles two lots on one spot. The stretch the row can
    // actually use -- clipped for THIS row, because a pad sits fifteen
    // metres off the road and the boundary steps in at the entrance --
    // only says where the row has to start and stop.
    const full = westToEast(densify(road.line, 2));
    const usable = westToEast(clipFor(road.line, parcel, row.side, offset));
    if (full.length < 2 || usable.length < 2) continue;
    const lo = alongOn(full, [usable[0][0], usable[0][1]]);
    const hi = alongOn(full, [usable[usable.length - 1][0], usable[usable.length - 1][1]]);

    const on = (owns.get(road) ?? []).filter((sh) =>
      placeOn(road, sh.centre).north === (row.side === "N"));
    out.push(...layRow(plan, row, full, lo, hi, offset, on));
  }
  return out;
}

/**
 * One row: a lot on every building, and a lot on every gap between them.
 *
 * The map's buildings say where the homes are, and they are right -- what
 * they are not is complete, because a pad that was empty when the aerial
 * was flown has no building on it and is still a lot. So the row is a
 * regular grid at the buildings' own pitch, every building sits on the
 * slot it falls in, and the slots nothing lands on are the empty pads.
 *
 * Which end the spare slots go on is not a guess either. The grid has to
 * fit between the boundary and the boundary: on Lady Viola's even side the
 * first home is already up against Pamalee Drive, so the thirteenth lot
 * can only be at the far end by the loop -- which is the empty pad, and is
 * 3100.
 */
function layRow(
  plan: Plan, row: PlanRow, line: number[][],
  lo: number, hi: number, offset: number, on: Shape[],
): Pad[] {
  const n = row.numbers.length;
  const room = hi - lo;
  if (!(room > 0) || n < 1) return [];

  const mk = (label: string, centre: [number, number], heading: number): Pad => ({
    id: `${row.street}|${label}`, label, street: row.street, side: row.side,
    ring: footprint(centre[1], centre[0], awayFrom(heading, row.side), plan.size),
  });
  const place = (label: string, at: number, centre?: [number, number]) => {
    const w = walk(line, at);
    return mk(label, centre ?? padAt(w.point, w.bearing, row.side, offset), w.bearing);
  };

  const here = on
    .map((s) => ({ s, at: alongOn(line, s.centre) }))
    .sort((a, b) => a.at - b.at);

  const evenly = () =>
    row.numbers.map((label, k) => place(label, lo + ((k + 0.5) / n) * room));
  if (here.length < 2) return evenly();

  // The pitch, from the gaps between neighbours that have no lot missing
  // between them -- the small ones. Taking the median of all the gaps
  // lets a double-width gap drag the figure up.
  const gaps: number[] = [];
  for (let i = 1; i < here.length; i++) gaps.push(here[i].at - here[i - 1].at);
  const rough = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  const close = gaps.filter((g) => g < rough * 1.5).sort((a, b) => a - b);
  const pitch = close.length ? close[Math.floor(close.length / 2)] : rough;
  if (!(pitch > 3)) return evenly();

  // Which lot each building is, counted one gap at a time.
  //
  // This used to be the distance from the first building divided by the
  // pitch, rounded. Over a row of thirteen a five per cent error in the
  // pitch compounds into a whole lot, so the last few buildings claimed
  // the same slot and two homes ended up on one pad. Counting each gap on
  // its own cannot drift: the question is only ever "is the next home
  // next door, or is there one empty pad between them, or two".
  const slot = new Map<number, Shape>();
  let where = 0;
  slot.set(0, here[0].s);
  for (let i = 1; i < here.length; i++) {
    where += Math.max(1, Math.round(gaps[i - 1] / pitch));
    slot.set(where, here[i].s);
  }
  const span = where;
  if (span >= n) return evenly();

  // The pitch to place the empty pads at, now that the slots are known:
  // the distance from the first building to the last, over the number of
  // lots between them. The estimate used to count the gaps is robust but
  // approximate, and placing an empty pad with it left it half a pad out
  // from the home next door.
  const step = span > 0 ? (here[here.length - 1].at - here[0].at) / span : pitch;
  if (process.env.PARKDEBUG) {
    console.log(`${row.street} ${row.side}: lo=${lo.toFixed(0)} hi=${hi.toFixed(0)}`
      + ` found=${here.length} pitch=${pitch.toFixed(2)} span=${span} n=${n}`);
  }

  // How many spare lots go before the first building. The grid has to
  // start and finish inside the stretch this row can use, and where only
  // one placing fits, that is the answer -- which is how the thirteenth
  // lot on Lady Viola's even side ends up at the loop rather than jammed
  // against Pamalee Drive.
  const spare = n - 1 - span;
  let before = 0;
  let best = Infinity;
  for (let b = 0; b <= spare; b++) {
    const from = here[0].at - b * step;
    const to = here[0].at + (span + spare - b) * step;
    const out = Math.max(0, lo - from) + Math.max(0, to - hi);
    const score = out * 1000 + Math.abs((from - lo) - (hi - to));
    if (score < best) { best = score; before = b; }
  }

  return row.numbers.map((label, k) => {
    const had = slot.get(k - before);
    if (had) return place(label, alongOn(line, had.centre), had.centre);
    return place(label, here[0].at + (k - before) * step);
  });
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
