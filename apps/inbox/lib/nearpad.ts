/**
 * The home nearest the pointer, not only the one exactly under it.
 *
 * A single-wide is about twelve pixels across at the zoom that shows a
 * whole park -- smaller than a fingertip, and about the size of a mouse
 * cursor's own point. Asking only what sits directly under the pointer
 * meant half the attempts to take hold of a home took hold of the map
 * instead and panned the park, which is what "not able to move these
 * easily" was looking at.
 *
 * So a miss widens into a square around the point and the nearest pad in
 * it is the one meant. Nearest measured on screen, in pixels, because
 * that is the distance the hand was judging -- metres on the ground are
 * a different ordering at a tilt, and nobody is aiming in metres.
 *
 * It lives here, away from the component, so it can be run against a
 * real MapLibre map in a real browser. The thing worth testing about it
 * is whether the query shapes are the ones MapLibre actually takes, and
 * no amount of reading the component says that.
 */

/** A ring, in whatever shape the feature's geometry arrived as. */
type Ringed = { coordinates?: number[][][] } | undefined;

/** Just the parts of the map this needs. */
export type Pointing = {
  getLayer(id: string): unknown;
  project(at: [number, number]): { x: number; y: number };
  queryRenderedFeatures(
    where: never,
    options: { layers: string[] },
  ): { properties?: Record<string, unknown> | null; geometry: unknown }[];
};

export type Pad = { properties?: Record<string, unknown> | null; geometry: unknown };

/** The middle of a closed ring, in the shape a queried feature gives it. */
function midOfFeature(f: Pad): [number, number] | null {
  const ring = (f.geometry as Ringed)?.coordinates?.[0];
  if (!ring || ring.length < 3) return null;
  const closed = ring.length > 3
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  return [
    pts.reduce((a, q) => a + q[0], 0) / pts.length,
    pts.reduce((a, q) => a + q[1], 0) / pts.length,
  ];
}

export function padAt(
  m: Pointing, point: { x: number; y: number }, reach = 20, layer = "home-fill",
): Pad | undefined {
  if (!m.getLayer(layer)) return undefined;
  // Always the array form, never the point itself.
  //
  // MapLibre decides whether its first argument is a place or an options
  // object with `instanceof Point || Array.isArray`, and a plain {x, y}
  // is neither -- so it is read as options, the query becomes the whole
  // viewport, and the answer is the topmost home on screen. Which is a
  // home, and looks like one, and is not the one under the hand. The
  // event's own `point` IS a real Point and would have been fine; a
  // position worked out in any other way would not.
  const q = (where: unknown) =>
    m.queryRenderedFeatures(where as never, { layers: [layer] });
  const hit = q([point.x, point.y])[0];
  if (hit) return hit;
  const near = q([
    [point.x - reach, point.y - reach],
    [point.x + reach, point.y + reach],
  ]);
  let best: Pad | undefined;
  let far = Infinity;
  for (const f of near) {
    const mid = midOfFeature(f);
    if (!mid) continue;
    const p = m.project(mid);
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d < far) { far = d; best = f; }
  }
  return best ?? near[0];
}
