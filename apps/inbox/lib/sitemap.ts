/**
 * Turning a click on a map into a place on the earth, and back.
 *
 * A pin is only worth anything if it outlives the picture it was dropped on.
 * 1140 is being built: today's satellite imagery shows dirt where lot 34 is
 * going, next spring's will show the home. If a position is "62% across that
 * photograph" then replacing the photograph moves every lot. If it is a
 * latitude and longitude, nothing moves, a tech can be given directions to
 * it, and the backdrop becomes a detail.
 *
 * So over a real aerial, positions are coordinates. The arithmetic below is
 * the standard Web Mercator projection that every tile and static map service
 * uses -- the same maths whether the picture came from Google, the county, or
 * a state orthoimagery service -- which is what stops this being tied to one
 * supplier.
 *
 * Over an uploaded plan there is no such thing as a coordinate, and pretending
 * otherwise would be inventing precision. Those positions are fractions of
 * that image and are stored as such.
 */

/** Pixels per tile, and the tile size every one of these services uses. */
const TILE = 256;

/** Where a point sits in Mercator's square, 0..1 from the top left. */
export function project(lat: number, lng: number): { x: number; y: number } {
  const x = (lng + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  // Clamped: the projection goes to infinity at the poles, and a NaN here
  // would put a lot in the corner of the map rather than failing loudly.
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return { x, y: Math.min(1, Math.max(0, y)) };
}

export function unproject(x: number, y: number): { lat: number; lng: number } {
  const lng = x * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

export type Frame = {
  /** What the picture is centred on. */
  lat: number; lng: number;
  zoom: number;
  /** Its size on screen, in CSS pixels. */
  width: number; height: number;
  /** 1 for a plain image, 2 for a retina one. The static map services return
   *  an image twice the requested size at scale 2, which does NOT change the
   *  geography -- getting this wrong halves or doubles every offset. */
  scale?: number;
};

/** Where on the picture a coordinate falls, in CSS pixels from its top left. */
export function toPixels(f: Frame, lat: number, lng: number) {
  const world = TILE * Math.pow(2, f.zoom);
  const p = project(lat, lng);
  const c = project(f.lat, f.lng);
  return {
    x: f.width / 2 + (p.x - c.x) * world,
    y: f.height / 2 + (p.y - c.y) * world,
  };
}

/** And back: what a click at those pixels is pointing at. */
export function toLatLng(f: Frame, px: number, py: number) {
  const world = TILE * Math.pow(2, f.zoom);
  const c = project(f.lat, f.lng);
  return unproject(
    c.x + (px - f.width / 2) / world,
    c.y + (py - f.height / 2) / world,
  );
}

/**
 * A zoom at which everything fits.
 *
 * A park a quarter of a mile long and a single house want very different
 * pictures, and guessing one zoom for both gives you either a street or a
 * continent. Worked out from the spread of whatever is already placed, and
 * falling back to something sensible for a property with nothing on it yet.
 */
export function zoomFor(
  points: { lat: number; lng: number }[],
  width: number, height: number,
  fallback = 18,
): number {
  if (points.length < 2) return fallback;

  const xs = points.map((p) => project(p.lat, p.lng).x);
  const ys = points.map((p) => project(p.lat, p.lng).y);
  // A tenth of the span as breathing room, so nothing sits on the edge.
  const spanX = (Math.max(...xs) - Math.min(...xs)) * 1.2 || 1e-9;
  const spanY = (Math.max(...ys) - Math.min(...ys)) * 1.2 || 1e-9;

  const z = Math.min(
    Math.log2(width / (TILE * spanX)),
    Math.log2(height / (TILE * spanY)),
  );
  // 21 is as close as these services go; below 3 is a hemisphere.
  return Math.max(3, Math.min(21, Math.floor(z)));
}

/** The middle of what is placed, so the picture is centred on the property
 *  rather than on whichever lot happened to be first. */
export function centreOf(points: { lat: number; lng: number }[]) {
  if (!points.length) return null;
  const xs = points.map((p) => project(p.lat, p.lng).x);
  const ys = points.map((p) => project(p.lat, p.lng).y);
  return unproject(
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  );
}
