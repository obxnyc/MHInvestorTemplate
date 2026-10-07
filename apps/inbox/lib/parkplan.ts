/**
 * A park described the way its owner describes it, and drawn from that.
 *
 * Six attempts at pulling this park out of the county's GIS produced, in
 * order: no layers, sixty layers of aerial tiles, zoning, watersheds, eighty
 * five homes belonging to four neighbourhoods, and twenty eight that cut the
 * park in half. The reason is simple and was never going to change: Cumberland
 * files mobile home pads under the park's own site address, so the pads are
 * not in the address layer at all. The county has three homes on Lady Viola.
 * There are twenty seven.
 *
 * So the park is described here instead, in the terms somebody standing in it
 * would use -- two streets, a row of homes either side of each, numbered from
 * one end -- and the geometry is worked out. Every home is the same model, so
 * every rectangle is the same rectangle, and a row evenly spaced along a line
 * is what a mobile home park is. That is the whole model.
 *
 * What stays adjustable is where the block sits and which way it points,
 * because those are the two things a drawing cannot know and an aerial
 * photograph answers in one drag.
 */

import { footprint, degreesPerMetre, SINGLE_WIDE } from "./footprint";

/** Which side of its street a row sits on. Only used to put the row on the
 *  correct side of the line; north and south are the names because that is
 *  how the rows read on the county map. */
export type Side = "N" | "S";

export type PlanRow = {
  street: string;
  side: Side;
  /** House numbers along the row, in order from the street's first end. */
  numbers: string[];
};

export type Plan = {
  /** Where the middle of the whole block sits. */
  centre: [number, number];
  /** The way the rows RUN, degrees clockwise from north. The homes stand
   *  square to this, which is a quarter turn on. */
  bearing: number;
  /** Metres between home centres along a row. */
  padSpacing: number;
  /** Metres between the two rows that face each other across one street. */
  pairGap: number;
  /** Metres between one street's centreline and the next. */
  streetGap: number;
  size: { width: number; length: number };
  rows: PlanRow[];
};

export type Placed = {
  id: string;
  label: string;
  street: string;
  side: Side;
  lat: number;
  lng: number;
  /** The way the home itself points, for `footprint`. */
  bearing: number;
};

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * The Retreat at Cross Creek, off Pamalee Drive in Fayetteville.
 *
 * Fifty one numbers, counted off the county map inside the park boundary.
 * Two of them -- 1800 and 1808 -- are the park's own site address and the
 * office rather than pads, which is why fifty one numbers are forty nine
 * homes. They are drawn because they are there.
 */
export const RETREAT: Plan = {
  centre: [-78.91932, 35.09249],
  bearing: 112,
  padSpacing: 10.5,
  pairGap: 31,
  streetGap: 57,
  size: SINGLE_WIDE,
  rows: [
    {
      street: "Lady Viola Dr", side: "N",
      numbers: evens(3100, 13),
    },
    {
      street: "Lady Viola Dr", side: "S",
      numbers: ["1800", "1808", ...odds(3101, 12)],
    },
    {
      street: "Lady Cheryl Dr", side: "N",
      numbers: evens(3100, 12),
    },
    {
      street: "Lady Cheryl Dr", side: "S",
      numbers: odds(3101, 12),
    },
  ],
};

function evens(first: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(first + i * 2));
}
function odds(first: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(first + i * 2));
}

/** The streets in the order the plan names them, each once. */
export function streetsOf(plan: Plan): string[] {
  const seen: string[] = [];
  for (const r of plan.rows) if (!seen.includes(r.street)) seen.push(r.street);
  return seen;
}

/** How many homes the plan draws. The honest count, derived, never typed. */
export function countOf(plan: Plan): number {
  return plan.rows.reduce((n, r) => n + r.numbers.length, 0);
}

/**
 * Every home, placed.
 *
 * Laid out in the park's own frame first -- metres along the rows, metres
 * across them -- and converted to degrees at the end. Doing it the other way
 * round means every spacing decision has to be thought about in degrees,
 * which nobody can picture and which is a different number for latitude than
 * for longitude.
 */
export function layOut(plan: Plan): Placed[] {
  const per = degreesPerMetre(plan.centre[1]);
  const b = rad(plan.bearing);
  const streets = streetsOf(plan);

  // The block is centred on its streets, so two streets sit half a gap
  // either side of the middle rather than the first one sitting on it.
  const mid = ((streets.length - 1) * plan.streetGap) / 2;

  const out: Placed[] = [];
  for (const row of plan.rows) {
    const s = streets.indexOf(row.street);
    const across = mid - s * plan.streetGap
      + (row.side === "N" ? plan.pairGap / 2 : -plan.pairGap / 2);

    const n = row.numbers.length;
    row.numbers.forEach((num, i) => {
      const along = (i - (n - 1) / 2) * plan.padSpacing;
      const [lng, lat] = toDegrees(plan.centre, along, across, b, per);
      out.push({
        id: `${row.street}|${num}`,
        label: num,
        street: row.street,
        side: row.side,
        lat, lng,
        // Square to the street: a home's long axis runs away from the road,
        // not along it.
        bearing: (plan.bearing + 90) % 360,
      });
    });
  }
  return out;
}

/** The centreline of each street, for writing its name along. */
export function streetLines(plan: Plan): { name: string; line: number[][] }[] {
  const per = degreesPerMetre(plan.centre[1]);
  const b = rad(plan.bearing);
  const streets = streetsOf(plan);
  const mid = ((streets.length - 1) * plan.streetGap) / 2;

  return streets.map((name, s) => {
    const across = mid - s * plan.streetGap;
    // As long as the longest row on it, so the name has room to sit.
    const longest = Math.max(
      ...plan.rows.filter((r) => r.street === name).map((r) => r.numbers.length),
      2,
    );
    const halfLen = ((longest - 1) * plan.padSpacing) / 2;
    return {
      name,
      line: [
        toDegrees(plan.centre, -halfLen, across, b, per),
        toDegrees(plan.centre, halfLen, across, b, per),
      ],
    };
  });
}

function toDegrees(
  centre: [number, number], along: number, across: number,
  b: number, per: { lat: number; lng: number },
): number[] {
  const sin = Math.sin(b), cos = Math.cos(b);
  // Bearing is clockwise from north, so "along" runs (sin, cos) in
  // (east, north) and "across" is that turned a quarter clockwise.
  const east = along * sin + across * cos;
  const north = along * cos - across * sin;
  return [centre[0] + east * per.lng, centre[1] + north * per.lat];
}

/**
 * The park boundary: everything the homes cover, plus a margin.
 *
 * The owner drew this by hand on the county map and asked for it on screen,
 * and a hull around the homes is the same line for no upkeep -- add a lot at
 * the end of a row and the boundary follows it, which a typed-in polygon
 * would not.
 */
export function boundaryOf(plan: Plan, margin = 14): number[][] {
  const per = degreesPerMetre(plan.centre[1]);
  const corners: number[][] = [];
  for (const h of layOut(plan)) {
    for (const c of footprint(h.lat, h.lng, h.bearing, plan.size)) corners.push(c);
  }
  const hull = convexHull(corners);
  if (hull.length < 3) return hull;

  const cx = hull.reduce((a, p) => a + p[0], 0) / hull.length;
  const cy = hull.reduce((a, p) => a + p[1], 0) / hull.length;

  // Pushed out from the middle by a fixed number of metres. Scaling the hull
  // by a ratio instead would widen a long park far more at the ends than the
  // sides, which reads as a mistake.
  return hull.map(([x, y]) => {
    const dx = (x - cx) / per.lng;
    const dy = (y - cy) / per.lat;
    const d = Math.hypot(dx, dy) || 1;
    return [x + (dx / d) * margin * per.lng, y + (dy / d) * margin * per.lat];
  });
}

/** Andrew's monotone chain. Closed ring, counter-clockwise. */
export function convexHull(points: number[][]): number[][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const build = (src: number[][]) => {
    const out: number[][] = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  const ring = [...build(p), ...build([...p].reverse())];
  ring.push(ring[0]);
  return ring;
}

/**
 * The plan moved, turned or respaced.
 *
 * Returned fresh rather than mutated, because the adjustment comes off a
 * slider being dragged and a shared object would have every frame fighting
 * the last one.
 */
export function nudge(plan: Plan, change: Partial<Plan>): Plan {
  return { ...plan, ...change };
}

/** Metres moved east and north, as a new centre. The drag gesture speaks in
 *  screen pixels, which the caller turns into a pair of coordinates. */
export function movedTo(plan: Plan, lng: number, lat: number): Plan {
  return { ...plan, centre: [lng, lat] };
}
