/**
 * When the map is allowed to move itself.
 *
 * A park arriving on screen should be framed. A park being worked on
 * should not: placing homes, moving them, drawing the line and fitting
 * the block all mean somebody has chosen a zoom and a corner to work
 * in, and the map taking it back between one tap and the next is the
 * screen arguing with the hand.
 *
 * This is the whole decision, out here where it can be tested, because
 * the bug it fixes was a single word in a cache key: the number of
 * homes. Every home put down by hand changed it, so the map re-framed
 * fifty-nine times -- a four-hundred-millisecond zoom out between every
 * pair of taps -- and nothing about that is visible in a type, a test
 * of where the homes are, or a picture of the park.
 */
export type Where = {
  /** The park has a boundary of its own, rather than a box round the homes. */
  boundary: boolean;
  /** How many homes are drawn. */
  homes: number;
  centre: [number, number];
};

export function frameKey(at: Where): string {
  // Whether there are homes, not how many. What the framing is for is
  // the park arriving at all, and that happens once.
  const where = at.centre.map((n) => n.toFixed(5)).join(",");
  return `${at.boundary ? "real" : "drawn"}:${at.homes ? "some" : "none"}:${where}`;
}

export function reframe(
  was: string, at: Where, working: boolean,
): { key: string; now: boolean } {
  const key = frameKey(at);
  // Noted as framed either way, so that putting the tools down does not
  // then yank the view to a shape that arrived while they were in use.
  if (key === was) return { key, now: false };
  return { key, now: !working };
}
