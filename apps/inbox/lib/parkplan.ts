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

import { footprint, degreesPerMetre, bearingOf, metresBetween, SINGLE_WIDE } from "./footprint";

/** Which side of its street a row sits on. Only used to put the row on the
 *  correct side of the line; north and south are the names because that is
 *  how the rows read on the county map. */
export type Side = "N" | "S";

export type PlanRow = {
  street: string;
  side: Side;
  /** House numbers along the row, in order from the street's first end. */
  numbers: string[];
  /**
   * The two ends of this row, where it has been placed by hand.
   *
   * The grid below -- one bearing, one spacing, rows either side of a
   * street -- describes a park laid out by a developer on paper. Plenty
   * of parks are not that. Northside is three separate groups: a long
   * loop with a row down each side, a cluster in the middle at its own
   * angle, and a row across the front. One bearing and one spacing
   * cannot say that, and every attempt to make them produced a park
   * that was wrong in a way no slider could fix.
   *
   * So a row may carry its own ends instead: the middle of its first
   * home and the middle of its last. Everything else follows -- the
   * direction is the line between them, the spacing is its length over
   * the gaps, and the homes sit on it. Nothing is derived from the
   * park's bearing or its spacings at all.
   *
   * Both, or neither. One end on its own says nothing.
   */
  from?: [number, number];
  to?: [number, number];
};

/** A row that has been placed by its ends rather than by the grid. */
export function placed(row: PlanRow): boolean {
  return Array.isArray(row.from) && Array.isArray(row.to)
    && row.from.length === 2 && row.to.length === 2;
}

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
  /** Whether the rows sit on the other side of the streets.
   *
   *  Which way "across" points falls out of the bearing, so a park running
   *  east-south-east has its first street drawn south of its second one and
   *  a park running west-north-west has it north. That is right for one of
   *  them and upside down for the other, and upside down looks exactly like
   *  right until you read a street name. Rather than make every bearing
   *  carry the answer, the arrangement is flipped here and chosen by
   *  measuring against the real roads. */
  mirror?: boolean;
  /** Which end of the street the first number in each row sits at.
   *
   *  Addresses do not agree on this and no rule derives it: here the high
   *  numbers are at the Pamalee entrance in the west and they count down to
   *  3100 at the loop in the east, so every row reads backwards if you walk
   *  it the other way. Sorting west to east -- which is what "along the
   *  street" means once the bearing is folded eastward -- put 3100 at the
   *  entrance and 3124 at the loop, exactly reversed, on all four rows at
   *  once. */
  countFrom?: "west" | "east";
  /**
   * How a lot here is named.
   *
   * Two parks, two schemes, and the difference is not cosmetic -- it is
   * what the lot is filed under and what has to match when the map and
   * the database try to recognise each other.
   *
   *   "street"  a house number on a named street. Cross Creek's lots are
   *             "3124 Lady Viola Dr", and the street is a real road the
   *             map knows by name.
   *   "lot"     a number within a park that has one address. Northside's
   *             are "1140 Northside Rd Lot 1". The drive inside the park
   *             has no name at all, on a map or on an envelope, so there
   *             is no street for a row to hang on and the row's `street`
   *             is only a grouping.
   *
   * Defaults to "street", because that is what every park described
   * before this field existed was.
   */
  naming?: "street" | "lot";
  /** The park's own address, when the lots are numbered within it.
   *  "1140 Northside Rd" -- so a lot is filed as that plus "Lot 1". */
  address?: string;
  /**
   * How far the homes are turned from square to their row, in degrees.
   *
   * Cross Creek's homes sit square to the street -- the long axis runs
   * away from the road -- and nothing needed to say so. Northside's do
   * not: they are chevroned along a drive, every one at the same angle,
   * which is how a long home fits on a narrow strip with a car beside
   * it. Without this the park cannot be drawn at all, only approximated
   * by a grid that is wrong in a way a picture shows instantly.
   *
   * Positive turns them clockwise. Zero, and absent, mean square, so
   * every park described before this existed is unchanged.
   *
   * One number for the park rather than one per row, because the homes
   * stay parallel to each other whatever the angle -- rungs on a ladder.
   */
  homeTurn?: number;
  /**
   * The property line, as the county drew it.
   *
   * [lng, lat] corners of the parcel, taken from the county's own
   * parcel layer by the number on the tax card. When it is here it IS
   * the boundary -- not a box fitted round wherever the homes ended up,
   * and not somebody's tracing of a screenshot.
   *
   * Absent for a park whose county publishes nothing, where the
   * boundary falls back to the box as before.
   */
  fence?: number[][];
  /** The parcel number it came from, so it can be looked up again. */
  pin?: string;
  /**
   * A road the property line runs out to, by name.
   *
   * Cross Creek's deed line is the kerb of Pamalee Drive, so a box
   * drawn round its homes stops short of the boundary by the width of
   * a verge. That was written into the screen as /pamalee/i and ran on
   * every park in the system -- harmlessly, because no other park has a
   * road called that, and wrongly, because the park that does is not
   * special.
   *
   * Ignored once `fence` is set: the county's line needs no help.
   */
  frontage?: string;
  rows: PlanRow[];
};

/**
 * What a lot is filed under.
 *
 * One function, because this string is built in eight places -- seeding
 * the lots, saving a dragged position, matching a unit to a pad, the
 * sync, the tally -- and eight copies of a rule is seven chances for one
 * of them to drift and quietly stop matching. That has already cost an
 * hour here once, when a drag saved against "3124" and the lot was on
 * file as "3124 Lady Viola Dr".
 */
export function filedAs(plan: Plan, label: string, street: string): string {
  if (plan.naming === "lot") {
    const at = (plan.address ?? "").trim();
    return at ? `${at} Lot ${label}` : `Lot ${label}`;
  }
  return `${label} ${street}`.trim();
}

export type Placed = {
  id: string;
  label: string;
  /** What this lot is filed under. Built by `filedAs`, in one place. */
  filed: string;
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
  // Each row is written the way the county map reads it: west to east,
  // starting at the Pamalee Dr entrance. The high numbers are there and
  // they count down to 3100 and 3101 at the loop in the east, which is the
  // opposite of what "along the street" gives you on its own -- and getting
  // it the wrong way round reverses all four rows at once, which looks
  // plausible until somebody reads a house number.
  countFrom: "west",
  // The deed line is the kerb of Pamalee Drive, so a box drawn round
  // the homes stops a verge short of it.
  frontage: "Pamalee Dr",
  padSpacing: 10.5,
  pairGap: 31,
  streetGap: 57,
  size: SINGLE_WIDE,
  rows: [
    { street: "Lady Viola Dr", side: "N", numbers: down(3124, 13) },
    // 1808 is at the entrance on Lady Viola's odd side, and 1800 is the
    // first home round on Lady Cheryl's even side -- the park's own site
    // address. They are numbered off the road rather than off the row,
    // which is why neither of them looks like its neighbours.
    { street: "Lady Viola Dr", side: "S", numbers: ["1808", ...down(3123, 12)] },
    { street: "Lady Cheryl Dr", side: "N", numbers: ["1800", ...down(3122, 12)] },
    { street: "Lady Cheryl Dr", side: "S", numbers: down(3123, 12) },
  ],
};

/** A run of house numbers counting down in twos, which is how a row reads
 *  walking east from the entrance. */
function down(first: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(first - i * 2));
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
    // A row placed by its ends owes nothing to the grid: not its
    // direction, not its spacing, not which side of a street it is on.
    if (placed(row)) {
      const [x1, y1] = row.from!;
      const [x2, y2] = row.to!;
      const n = row.numbers.length;
      const head = bearingOf([x1, y1], [x2, y2]);
      row.numbers.forEach((num, i) => {
        // The ends ARE homes, so n homes have n-1 gaps between them. A
        // single home sits on its own first end.
        const t = n > 1 ? i / (n - 1) : 0;
        out.push({
          id: `${row.street}|${num}`,
          label: num,
          filed: filedAs(plan, num, row.street),
          street: row.street,
          side: row.side,
          lng: x1 + (x2 - x1) * t,
          lat: y1 + (y2 - y1) * t,
          bearing: (head + 90 + (plan.homeTurn ?? 0) + 360) % 360,
        });
      });
      continue;
    }

    const s = streets.indexOf(row.street);
    const across = mid - s * plan.streetGap
      + (row.side === "N" ? plan.pairGap / 2 : -plan.pairGap / 2);

    const n = row.numbers.length;
    row.numbers.forEach((num, i) => {
      const step = plan.countFrom === "east" ? (n - 1) / 2 - i : i - (n - 1) / 2;
      const along = step * plan.padSpacing;
      const [lng, lat] = toDegrees(plan.centre, along, across, b, per, plan.mirror);
      out.push({
        id: `${row.street}|${num}`,
        label: num,
        filed: filedAs(plan, num, row.street),
        street: row.street,
        side: row.side,
        lat, lng,
        // Square to the street unless the park says otherwise: a home's
        // long axis runs away from the road, not along it.
        bearing: (plan.bearing + 90 + (plan.homeTurn ?? 0) + 360) % 360,
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
        toDegrees(plan.centre, -halfLen, across, b, per, plan.mirror),
        toDegrees(plan.centre, halfLen, across, b, per, plan.mirror),
      ],
    };
  });
}

function toDegrees(
  centre: [number, number], along: number, across: number,
  b: number, per: { lat: number; lng: number }, mirror = false,
): number[] {
  const sin = Math.sin(b), cos = Math.cos(b);
  if (mirror) across = -across;
  // Bearing is clockwise from north, so "along" runs (sin, cos) in
  // (east, north) and "across" is that turned a quarter clockwise.
  const east = along * sin + across * cos;
  const north = along * cos - across * sin;
  return [centre[0] + east * per.lng, centre[1] + north * per.lat];
}

/**
 * The park boundary: a rectangle around the homes, in the park's own frame.
 *
 * This was a convex hull with its corners pushed outward, and it came out a
 * rounded blob -- because the four rows are different lengths, every corner
 * of the hull was a different home sticking out at a different angle, and a
 * uniform outward push turned the lot into a pebble. A park block is a
 * rectangle. Measured along the rows and across them rather than in north
 * and east, it stays a rectangle at any bearing, which a bounding box in
 * degrees would not: turn that one by thirty degrees and it grows a quarter
 * again in both directions.
 */
export function boundaryOf(plan: Plan, margin = 9): number[][] {
  const per = degreesPerMetre(plan.centre[1]);
  const b = rad(plan.bearing);

  let minA = Infinity, maxA = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const h of layOut(plan)) {
    for (const c of footprint(h.lat, h.lng, h.bearing, plan.size)) {
      const { along, across } = localOf(plan, plan.centre, [c[0], c[1]]);
      if (along < minA) minA = along;
      if (along > maxA) maxA = along;
      if (across < minC) minC = across;
      if (across > maxC) maxC = across;
    }
  }
  if (!Number.isFinite(minA)) return [];

  const box: [number, number][] = [
    [minA - margin, minC - margin],
    [maxA + margin, minC - margin],
    [maxA + margin, maxC + margin],
    [minA - margin, maxC + margin],
  ];
  const ring = box.map(([along, across]) =>
    toDegrees(plan.centre, along, across, b, per, plan.mirror));
  ring.push(ring[0]);
  return ring;
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

/**
 * Everything that is not the park.
 *
 * A polygon the size of the world with the park cut out of it. Painted pale
 * grey over the top of whatever base map is showing, it does to an aerial
 * photograph what a marina chart does to the water around the slips: the
 * trees, the neighbour's yard and the scrapyard over the fence go behind
 * glass, and the only thing in front of it is the park.
 *
 * Done as a hole rather than by hiding things because there is nothing to
 * hide -- the base map is one picture, and the only way to take the trees
 * out of a photograph is to cover them.
 */
export function maskOf(plan: Plan, margin = 14): number[][][] {
  const world = [
    [-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85],
  ];
  // The hole must wind the opposite way to the outer ring or it is not a
  // hole, it is a second filled shape sitting on top of the park. Which way
  // the boundary happens to come out depends on its bearing, so it is
  // measured rather than assumed -- reversing unconditionally is right half
  // the time and silently wrong the other half.
  const ring = boundaryOf(plan, margin);
  const hole = Math.sign(signedArea(ring)) === Math.sign(signedArea(world))
    ? [...ring].reverse() : ring;
  return [world, hole];
}

/** Twice the signed area of a closed ring. Positive one way round,
 *  negative the other; only the sign is ever wanted. */
export function signedArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a;
}

/** A point tapped on the aerial. */
export type Tap = [number, number];

/**
 * The four pads to tap, in the order they are asked for.
 *
 * Four sliders and a drag asks somebody to find a bearing by eye, which is
 * not a thing anybody can do -- and the answer only looks right when all
 * four are right at once, so there is no way to tell which one is wrong.
 * Tapping a pad you can see in the photograph is a thing anybody can do, and
 * four of them pin the whole block exactly:
 *
 *   two along one row  -> which way the rows run, and how far apart the
 *                         homes are, because the row's length divided by the
 *                         gaps in it is the spacing
 *   one across the road -> how wide that street is
 *   one on the next street -> how far it is to the next street
 *
 * No arithmetic for anybody, and every tap is a number on a roof.
 */
export function fitTargets(plan: Plan): { id: string; label: string; street: string; say: string }[] {
  const row = plan.rows[0];
  if (!row || row.numbers.length < 2) return [];
  const facing = plan.rows.find((r) => r.street === row.street && r.side !== row.side);
  const next = plan.rows.find((r) => r.street !== row.street);

  const at = (r: PlanRow, i: number, say: string) => ({
    id: `${r.street}|${r.numbers[i]}`,
    label: r.numbers[i], street: r.street, say,
  });

  // Said so they can be followed looking at a photograph, where there
  // are no labels and no street names -- only roofs. "The first home on
  // this row" is not a thing anybody can see; "the end of the row
  // nearest the entrance" is.
  const end = plan.countFrom === "east" ? "east" : "west";
  const far = end === "east" ? "west" : "east";
  const out = [
    at(row, 0, `the home at the ${end} end of one row`),
    at(row, row.numbers.length - 1, `the home at the ${far} end of that same row`),
  ];
  if (facing) out.push(at(facing, 0, "any home on the other side of the road"));
  if (next) out.push(at(next, 0, "any home on the next road along"));
  return out;
}

/**
 * The block placed from those taps.
 *
 * Applied as far as the taps go, so the park moves into place while it is
 * being pinned rather than after the fourth one -- two taps already give the
 * angle and the spacing, which is most of what was wrong.
 */
export function fitFromTaps(plan: Plan, taps: Tap[]): Plan {
  const targets = fitTargets(plan);
  if (taps.length < 2 || targets.length < 2) return plan;

  const [a, b] = taps;
  const row = plan.rows[0];
  const gaps = row.numbers.length - 1;
  const span = metresBetween(a, b);

  // The rows run the way "along" increases, which is from the last number
  // to the first when a street counts down -- tap the first home and the
  // last home of a row that starts at its east end and the line between
  // them points the other way.
  let next: Plan = {
    ...plan,
    bearing: plan.countFrom === "east" ? bearingOf(b, a) : bearingOf(a, b),
    // A row tapped end to end has one fewer gap in it than it has homes.
    // Dividing by the count instead quietly shrinks the park by one pad,
    // which reads as "nearly right" and never resolves.
    padSpacing: gaps > 0 && span > 0 ? span / gaps : plan.padSpacing,
  };

  // The two cross-measurements are perpendicular distances from the first
  // tap, which is why they are taken after the bearing is known and not
  // before: across what, otherwise.
  if (taps[2]) {
    const across = Math.abs(localOf(next, a, taps[2]).across);
    if (across > 1) next = { ...next, pairGap: across };
  }
  if (taps[3]) {
    const across = Math.abs(localOf(next, a, taps[3]).across);
    if (across > 1) next = { ...next, streetGap: across };
  }

  // Last, because every change above moves the reference home, and the one
  // thing that must end up exactly where it was tapped is the home that was
  // tapped.
  return centreOn(next, targets[0].id, a);
}

/** The plan shifted so one named home sits exactly on a point. */
export function centreOn(plan: Plan, id: string, at: Tap): Plan {
  const home = layOut(plan).find((h) => h.id === id);
  if (!home) return plan;
  return {
    ...plan,
    centre: [plan.centre[0] + (at[0] - home.lng), plan.centre[1] + (at[1] - home.lat)],
  };
}

/** The reverse of localOf: a point so many metres along the rows and across
 *  them, as a coordinate. */
export function fromLocal(plan: Plan, along: number, across: number): Tap {
  const per = degreesPerMetre(plan.centre[1]);
  const p = toDegrees(plan.centre, along, across, rad(plan.bearing), per, plan.mirror);
  return [p[0], p[1]];
}

/** A point in the park's own frame: metres along the rows, metres across
 *  them. The exact inverse of the placement maths above. */
export function localOf(
  plan: Plan, origin: Tap, point: Tap,
): { along: number; across: number } {
  const per = degreesPerMetre(origin[1]);
  const b = rad(plan.bearing);
  const east = (point[0] - origin[0]) / per.lng;
  const north = (point[1] - origin[1]) / per.lat;
  const across = east * Math.cos(b) - north * Math.sin(b);
  return {
    along: east * Math.sin(b) + north * Math.cos(b),
    across: plan.mirror ? -across : across,
  };
}


/**
 * The park a set of lot labels belongs to, where that is one this code
 * already describes.
 *
 * The Retreat at Cross Creek was laid out before a park could have a
 * plan of its own: its arrangement lived in this file and nowhere
 * else. Giving every park its own plan then made that park a park with
 * no plan -- fifty one lots on file, an hour of somebody's dragging
 * saved against them, and a blank map, because the thing that drew it
 * had been taken away and nothing had been put in its place.
 *
 * So a park with no plan is asked whether it is this one, by its lot
 * labels, which are the only durable thing about it. If it is, it
 * adopts the built-in description and from then on owns it. No other
 * park can match: Northside's lots are filed as "1140 Northside Rd Lot
 * 1" and Cross Creek's as "3124 Lady Viola Dr".
 *
 * Returns null for anything else, which is the whole point -- a park
 * that is not this one draws nothing until somebody says what it is.
 */
export function builtInFor(labels: string[]): Plan | null {
  const mine = new Set(layOut(RETREAT).map((h) => tidy(h.filed)));
  const seen = labels.map(tidy).filter(Boolean);
  if (seen.length < 5) return null;
  const hits = seen.filter((l) => mine.has(l)).length;
  // Most of what is on file has to be this park's, and most of this
  // park has to be on file. One matching label is a coincidence; fifty
  // is an identification.
  return hits >= seen.length * 0.6 && hits >= mine.size * 0.5 ? RETREAT : null;
}

/** Labels compared the way they are compared everywhere else: case and
 *  spacing are not part of the name. */
function tidy(s: string): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
