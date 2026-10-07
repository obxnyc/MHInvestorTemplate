/**
 * The homes as they actually sit, from OpenStreetMap.
 *
 * The base map underneath this park already draws every home in it, at the
 * right angle, with the two streets curving the way they curve. That is a
 * better depiction than anything computed from a description, and it was
 * sitting there the whole time -- baked into a raster tile where nothing
 * could be clicked, highlighted or counted.
 *
 * So the same data is fetched as geometry rather than as a picture. What the
 * park's own description still supplies is the numbering: OpenStreetMap
 * knows there is a building there and nothing at all about it being lot
 * 3107. Real shapes, our numbers.
 *
 * Nothing here talks to the network. The fetching is in the route; this is
 * the part that has to be right, so it is the part that can be tested.
 */

import { metresBetween } from "./footprint";
import type { Plan, PlanRow } from "./parkplan";

export type OsmElement = {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
};

export type Shape = { id: string; ring: number[][]; centre: [number, number] };
export type Road = { name: string; line: number[][] };

/** The Overpass query. Buildings and named roads in a box, with their
 *  geometry inline so no second round trip is needed to resolve nodes. */
export function overpassBody(box: { s: number; w: number; n: number; e: number }): string {
  const b = `${box.s},${box.w},${box.n},${box.e}`;
  return `[out:json][timeout:40];(way["building"](${b});way["highway"]["name"](${b}););out geom;`;
}

/** A box of the given half-size in metres around a point. Degrees of
 *  longitude are shorter than degrees of latitude everywhere but the
 *  equator, so the two edges are not the same number. */
export function boxAround(
  [lng, lat]: [number, number], metres: number,
): { s: number; w: number; n: number; e: number } {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { s: lat - dLat, w: lng - dLng, n: lat + dLat, e: lng + dLng };
}

/** Closed building outlines, as rings of [lng, lat]. */
export function buildingsOf(elements: OsmElement[]): Shape[] {
  const out: Shape[] = [];
  for (const el of elements) {
    if (!el.tags?.building || !el.geometry || el.geometry.length < 4) continue;
    const ring = el.geometry.map((p) => [p.lon, p.lat]);
    const first = ring[0], last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    out.push({ id: `osm${el.id ?? out.length}`, ring, centre: centroid(ring) });
  }
  return out;
}

/** Named roads, as lines. */
export function roadsOf(elements: OsmElement[]): Road[] {
  const out: Road[] = [];
  for (const el of elements) {
    const name = el.tags?.name;
    if (!name || !el.tags?.highway || !el.geometry || el.geometry.length < 2) continue;
    out.push({ name, line: el.geometry.map((p) => [p.lon, p.lat]) });
  }
  return out;
}

/**
 * The middle of a ring, by area.
 *
 * Measured from the ring's own first corner rather than from the equator
 * and the Greenwich meridian. A mobile home is five metres of longitude
 * wide at a longitude of seventy nine degrees, so the shoelace terms are
 * each about 2,765 and their sum is about a hundred-millionth -- eight
 * significant figures of the answer cancel away before it is ever used, and
 * the centroid comes out a few metres from the building, which is enough to
 * put a home on the wrong side of its own street.
 *
 * Shifting to a local origin first costs one subtraction per corner and
 * keeps every digit.
 *
 * The average of the corners is not a substitute: it leans towards whichever
 * side of the building somebody happened to map in more detail. It is only
 * the fallback for a ring with no area at all.
 */
export function centroid(ring: number[][]): [number, number] {
  const n = ring.length - 1;
  if (n < 1) return [ring[0]?.[0] ?? 0, ring[0]?.[1] ?? 0];
  const ox = ring[0][0], oy = ring[0][1];

  let a = 0, x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    const x1 = ring[i][0] - ox, y1 = ring[i][1] - oy;
    const x2 = ring[i + 1][0] - ox, y2 = ring[i + 1][1] - oy;
    const f = x1 * y2 - x2 * y1;
    a += f; x += (x1 + x2) * f; y += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-18) {
    return [
      ring.slice(0, n).reduce((s, p) => s + p[0], 0) / n,
      ring.slice(0, n).reduce((s, p) => s + p[1], 0) / n,
    ];
  }
  return [ox + x / (3 * a), oy + y / (3 * a)];
}

/** "Lady Viola Dr" and "Lady Viola Drive" are the same street. The park
 *  calls it one thing and the map calls it another, and matching on the
 *  whole string finds nothing at all. */
export function sameStreet(a: string, b: string): boolean {
  return bareName(a) === bareName(b);
}
const SUFFIX = /\b(drive|dr|street|st|road|rd|avenue|ave|av|court|ct|lane|ln|circle|cir|place|pl|way|trail|trl|boulevard|blvd)\b/g;
export function bareName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")
    .replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
}

/** The nearest point on a line to a point, and how far away it is. */
export function nearestOn(
  line: number[][], at: [number, number],
): { at: [number, number]; metres: number; t: number; seg: number } {
  let best = { at: line[0] as [number, number], metres: Infinity, t: 0, seg: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((at[0] - ax) * dx + (at[1] - ay) * dy) / len2)) : 0;
    const p: [number, number] = [ax + t * dx, ay + t * dy];
    const m = metresBetween(p, at);
    if (m < best.metres) best = { at: p, metres: m, t, seg: i };
  }
  return best;
}

/**
 * Which street a building is on, which side of it, and how far along.
 *
 * Side is decided by the sign of the cross product with the road's own
 * direction, with the direction flipped where necessary so that it always
 * runs roughly eastward. Without that, two halves of the same street mapped
 * in opposite directions put the same row of homes on both sides of it.
 */
export function placeOn(road: Road, at: [number, number]) {
  const near = nearestOn(road.line, at);
  const [ax, ay] = road.line[near.seg];
  const [bx, by] = road.line[near.seg + 1] ?? road.line[near.seg];
  // Eastward, or northward where the street runs due north.
  const flip = bx < ax || (bx === ax && by < ay);
  const dx = (flip ? ax - bx : bx - ax), dy = (flip ? ay - by : by - ay);
  const cross = dx * (at[1] - near.at[1]) - dy * (at[0] - near.at[0]);
  return {
    metres: near.metres,
    north: cross > 0,
    // How far along the whole street, eastward, for ordering a row.
    along: alongOf(road.line, near.seg, near.t, flip),
  };
}

function alongOf(line: number[][], seg: number, t: number, flip: boolean): number {
  let d = 0;
  for (let i = 0; i < seg; i++) {
    d += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
  }
  const segLen = Math.hypot(line[seg + 1]?.[0] - line[seg][0], line[seg + 1]?.[1] - line[seg][1]) || 0;
  const total = (() => {
    let s = 0;
    for (let i = 0; i < line.length - 1; i++) {
      s += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
    }
    return s;
  })();
  const forward = d + t * segLen;
  return flip ? total - forward : forward;
}

export type Matched = {
  id: string; label: string; street: string; side: "N" | "S"; ring: number[][];
};

/**
 * The park's numbering laid onto the map's buildings.
 *
 * Each building is put on the nearest of the park's own streets, sorted
 * along it, and handed the next number from that row. Where the map has
 * more buildings than the row has numbers the extras are left unnumbered
 * rather than renumbered, because a shed behind lot 3110 is not lot 3126
 * and labelling it as one is worse than leaving it grey.
 */
export function assign(
  plan: Plan, shapes: Shape[], roads: Road[], within = 45,
): { homes: Matched[]; spare: Shape[]; rows: { row: PlanRow; found: number }[] } {
  const mine = roads.filter((r) => plan.rows.some((row) => sameStreet(row.street, r.name)));

  type Sorted = { shape: Shape; street: string; north: boolean; along: number };
  const sorted: Sorted[] = [];
  const spare: Shape[] = [];

  for (const s of shapes) {
    let best: { road: Road; p: ReturnType<typeof placeOn> } | null = null;
    for (const road of mine) {
      const p = placeOn(road, s.centre);
      if (!best || p.metres < best.p.metres) best = { road, p };
    }
    if (!best || best.p.metres > within) { spare.push(s); continue; }
    sorted.push({
      shape: s,
      // Named from the plan, not the map, so one street is one spelling.
      street: plan.rows.find((r) => sameStreet(r.street, best!.road.name))!.street,
      north: best.p.north, along: best.p.along,
    });
  }

  const homes: Matched[] = [];
  const rows: { row: PlanRow; found: number }[] = [];
  for (const row of plan.rows) {
    const inRow = sorted
      .filter((x) => x.street === row.street && (x.north ? "N" : "S") === row.side)
      .sort((a, b) => a.along - b.along);
    rows.push({ row, found: inRow.length });
    inRow.forEach((x, i) => {
      const label = row.numbers[i];
      if (label === undefined) { spare.push(x.shape); return; }
      homes.push({
        id: `${row.street}|${label}`, label, street: row.street,
        side: row.side, ring: x.shape.ring,
      });
    });
  }
  return { homes, spare, rows };
}

/**
 * The park boundary from real buildings: the smallest rectangle that holds
 * them, at whatever angle that turns out to be.
 *
 * A hull of real corners is a ragged polygon with a notch at every gap in
 * the row, and a north-south bounding box around a park that sits at
 * seventy degrees is a quarter too big in both directions. The smallest
 * turned rectangle is neither -- it is the shape somebody would draw.
 *
 * Found by rotating calipers: the smallest such rectangle always has a side
 * flush with an edge of the hull, so trying every hull edge tries every
 * answer.
 */
export function orientedBox(points: number[][], margin = 9): number[][] {
  if (points.length < 3) return [];
  const lat0 = points.reduce((s, p) => s + p[1], 0) / points.length;
  const lng0 = points.reduce((s, p) => s + p[0], 0) / points.length;
  const kLat = 111_320;
  const kLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const toM = (p: number[]): [number, number] =>
    [(p[0] - lng0) * kLng, (p[1] - lat0) * kLat];
  const toDeg = (p: [number, number]): number[] =>
    [lng0 + p[0] / kLng, lat0 + p[1] / kLat];

  const hull = convexHull(points.map(toM));
  if (hull.length < 4) return [];

  let best: { area: number; corners: [number, number][] } | null = null;
  for (let i = 0; i < hull.length - 1; i++) {
    const dx = hull[i + 1][0] - hull[i][0];
    const dy = hull[i + 1][1] - hull[i][1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    minU -= margin; maxU += margin; minV -= margin; maxV += margin;
    const area = (maxU - minU) * (maxV - minV);
    if (best && area >= best.area) continue;
    const back = (u: number, v: number): [number, number] =>
      [u * ux - v * uy, u * uy + v * ux];
    best = {
      area,
      corners: [back(minU, minV), back(maxU, minV), back(maxU, maxV), back(minU, maxV)],
    };
  }
  if (!best) return [];
  const ring = best.corners.map(toDeg);
  ring.push(ring[0]);
  return ring;
}

/** Andrew's monotone chain, on metres. Closed ring. */
export function convexHull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (src: [number, number][]) => {
    const out: [number, number][] = [];
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
