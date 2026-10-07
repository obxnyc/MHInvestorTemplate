/**
 * A home as a shape on the ground, not a pin.
 *
 * A pin says roughly where; an outline says which pad, which is the question
 * asked at the gate. And because every home in the park is the same model,
 * every outline is the same rectangle -- so the drawing can be exact without
 * anybody surveying anything.
 *
 * Everything here works in degrees, because that is what a map consumes, and
 * converts through metres, because that is what a home is measured in. The
 * conversion is latitude-dependent: a degree of longitude is 111 km at the
 * equator and 91 km at Fayetteville, and using one number for both is how a
 * rectangle comes out as a parallelogram.
 */

/** A single-wide, in metres. 16 by 60 feet is the common model and the one
 *  Pamalee is being rebuilt with; both are overridable per park, because a
 *  double-wide park is the same maths with a different width. */
export const SINGLE_WIDE = { width: 4.88, length: 18.29 };

const EARTH = 6_378_137;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** How many degrees a metre is, here. */
export function degreesPerMetre(lat: number) {
  return {
    lat: 1 / ((Math.PI / 180) * EARTH),
    lng: 1 / ((Math.PI / 180) * EARTH * Math.cos(rad(lat))),
  };
}

/**
 * The four corners of a home, as a closed ring.
 *
 * `bearing` is the way the home faces, in degrees clockwise from north --
 * the same convention a compass uses, so "the homes face the road running
 * north-east" is 45 and not something nobody can picture.
 *
 * Returned in GeoJSON order: [lng, lat], first point repeated last. Getting
 * that pair the wrong way round puts the park in the Indian Ocean, which is
 * at least an obvious failure.
 */
export function footprint(
  lat: number, lng: number, bearing: number,
  size = SINGLE_WIDE,
): number[][] {
  const per = degreesPerMetre(lat);
  const b = rad(bearing);
  const cos = Math.cos(b), sin = Math.sin(b);

  // Half-extents along the home's own axes: x across its width, y along its
  // length.
  const hw = size.width / 2;
  const hl = size.length / 2;

  const corners: [number, number][] = [
    [-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl],
  ];

  const ring = corners.map(([x, y]) => {
    // Rotate into map axes. North is +y, east is +x, and the rotation is
    // clockwise, which flips the usual sign on the sine terms.
    const east = x * cos + y * sin;
    const north = -x * sin + y * cos;
    return [lng + east * per.lng, lat + north * per.lat];
  });
  ring.push(ring[0]);
  return ring;
}

/**
 * Which way a home faces, given the homes either side of it.
 *
 * A row of pads runs along a street, so the line through its neighbours IS
 * the street, and a home stands square to it. Working it out from the data
 * beats asking somebody for a number in degrees that they would have to go
 * and measure.
 */
export function bearingOf(from: [number, number], to: [number, number]): number {
  const [lng1, lat1] = from;
  const [lng2, lat2] = to;
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2))
    - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Metres between two points. Used to find a home's nearest neighbours, so
 *  the row it belongs to is worked out rather than declared. */
export function metresBetween(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(h));
}

/**
 * The way each home faces, from the shape of the row it sits in.
 *
 * Each home takes the bearing of the line through its two nearest
 * neighbours, turned ninety degrees so it stands across the street rather
 * than along it. A home on the end of a row has one neighbour and uses that;
 * a home on its own keeps whatever default it was given, because guessing
 * from nothing is how one pad ends up at a jaunty angle for no reason.
 */
export function bearingsForRow(
  homes: { lat: number; lng: number }[], fallback = 0,
): number[] {
  return homes.map((h, i) => {
    const others = homes
      .map((o, j) => ({ o, j, d: j === i ? Infinity : metresBetween([h.lng, h.lat], [o.lng, o.lat]) }))
      .filter((x) => Number.isFinite(x.d))
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);

    if (!others.length) return fallback;
    // Two neighbours: the line between THEM is the street, and it passes
    // either side of this home. One neighbour: the line to it will do.
    const line = others.length === 2
      ? bearingOf([others[0].o.lng, others[0].o.lat], [others[1].o.lng, others[1].o.lat])
      : bearingOf([h.lng, h.lat], [others[0].o.lng, others[0].o.lat]);

    return half(line + 90);
  });
}

/**
 * An angle folded into half a turn, 0 up to but not including 180.
 *
 * A rectangle facing north and the same rectangle facing south are the same
 * rectangle, so half a turn is the whole range of meaningful answers. Which
 * of two equidistant neighbours happened to sort first was otherwise
 * deciding between 0 and 180 -- identical on screen, far apart as numbers,
 * and enough to make two homes in one row look like they disagreed.
 *
 * Rounded, and the top of the range snapped to the bottom, because a bearing
 * that comes out of trigonometry as 89.99999 folds to 179.99999 and lands at
 * the opposite end of a range it is supposed to be at the start of.
 */
export function half(angle: number): number {
  const a = ((angle % 180) + 180) % 180;
  const r = Math.round(a * 10) / 10;
  return r >= 179.9 || r < 0.1 ? 0 : r;
}
