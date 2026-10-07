/**
 * A park drawn as a plan.
 *
 * Every home in a park is the same home. That is the fact the whole drawing
 * rests on: a lot is an identical rectangle at a position and an angle, so
 * nobody has to trace outlines off a county map, and a park laid out in two
 * minutes looks like the place people actually stand in.
 *
 * Positions are fractions of the canvas, 0 to 1, which is what 024 already
 * stores for a unit on an image-backed map. Fractions rather than pixels
 * because the same plan is read on a phone in a driveway and on a monitor in
 * the office, and a pixel is a different distance on each.
 */

export type Lot = {
  /** "3107" -- what is painted on the pad and said on the phone. */
  label: string;
  x: number;
  y: number;
  /** Degrees clockwise from horizontal. Homes sit at an angle to the street
   *  nearly everywhere, and a grid of squares does not read as a park. */
  rot: number;
};

export type Row = {
  /** How many pads. */
  count: number;
  /** The number on the first pad, and what to add for each one after it.
   *  Step 2 is the normal case -- odds down one side, evens down the other. */
  startAt: number;
  step: number;
  /** Where the row begins and ends, as fractions. The homes are spread
   *  evenly between them, so moving one end moves the whole row. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  rot: number;
};

/** The size of a home on the plan, as fractions of the canvas. One size for
 *  every lot, deliberately: they are the same home, and a drawing that varies
 *  them implies a difference that is not there. */
export const HOME = { w: 0.030, h: 0.070 };

/**
 * One row of pads, evenly spaced from one end to the other.
 *
 * The spacing divides by count-1 rather than count, so the first home sits on
 * `from` and the last on `to`. Dividing by count leaves a gap at the end that
 * nobody can see the cause of and everybody tries to fix by dragging.
 */
export function layRow(row: Row): Lot[] {
  const n = Math.max(0, Math.floor(row.count));
  if (n === 0) return [];
  if (n === 1) {
    return [{ label: String(row.startAt), x: row.from.x, y: row.from.y, rot: row.rot }];
  }
  const dx = (row.to.x - row.from.x) / (n - 1);
  const dy = (row.to.y - row.from.y) / (n - 1);
  return Array.from({ length: n }, (_, i) => ({
    label: String(row.startAt + i * row.step),
    x: round(row.from.x + dx * i),
    y: round(row.from.y + dy * i),
    rot: row.rot,
  }));
}

/** Five decimal places, which is what the database column holds. Rounding
 *  here rather than letting Postgres do it means what the screen shows and
 *  what is stored are the same number, instead of differing in the last place
 *  and making a saved plan look like it moved. */
const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** Clamped to the canvas. Dragging a home off the edge and losing it is a way
 *  to spend an afternoon wondering where lot 3112 went. */
export function clamp(v: number): number {
  return Math.min(1, Math.max(0, round(v)));
}

/**
 * The angle a row of homes should sit at, from the street it faces.
 *
 * Taken from the direction of the row itself rather than typed in: homes face
 * the road, the road is the line the row follows, and asking somebody for a
 * number in degrees is asking them to measure something they can see.
 */
export function angleOf(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const deg = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
  // Homes stand across the street, not along it.
  return Math.round(deg + 90);
}

/** The next label in a row, for adding one pad to the end of a street.
 *  Keeps whatever step the row was using rather than assuming 2, because a
 *  park numbered 1..30 is as common as one numbered in odds. */
export function nextLabel(labels: string[]): string {
  const nums = labels.map((l) => parseInt(l.replace(/\D+/g, ""), 10))
    .filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return "1";
  const last = nums[nums.length - 1];
  const step = nums.length > 1 ? Math.max(1, nums[1] - nums[0]) : 1;
  return String(last + step);
}
