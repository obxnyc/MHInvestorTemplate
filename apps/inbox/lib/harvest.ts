/**
 * Taking the park out of the map, rather than drawing one over it.
 *
 * Every version of this screen until now put a picture on top of the map: a
 * block of identical rectangles at an angle I had guessed, over a
 * photograph of the actual homes, which never lined up and never could. The
 * homes were in the map the whole time -- the base map draws every one of
 * them, at the right angle, with both streets curving the way they curve --
 * but they arrived as a picture, where nothing can be coloured, numbered or
 * clicked.
 *
 * Vector tiles are the same map delivered as shapes instead. The buildings
 * come down as polygons with real coordinates and the streets as lines with
 * their names on them, so the park can be lifted straight out of what is
 * already on screen. Nothing is fetched, nothing is guessed, and nothing can
 * be out of alignment with the map, because it IS the map.
 *
 * This file is the part that has to be right, so it is the part with tests:
 * the turning of tile features into shapes and roads, and the throwing away
 * of the duplicates that tiling produces.
 */

import type { Shape, Road } from "./osm";
import { centroid } from "./osm";

/** What MapLibre hands back from a vector source. */
export type TileFeature = {
  id?: string | number;
  properties?: Record<string, unknown> | null;
  geometry?: {
    type: string;
    coordinates: unknown;
  };
};

/**
 * One feature per thing, not one per tile it touches.
 *
 * A building on a tile boundary comes back twice, once from each tile, each
 * copy clipped to its own tile. Counted as two it throws the numbering out
 * by one for every home after it; drawn as two it shows up as a home with a
 * crease down the middle. The whole copy wins over the clipped one, which
 * is what taking the longest ring does.
 */
export function dedupe(features: TileFeature[]): TileFeature[] {
  const best = new Map<string, { f: TileFeature; size: number }>();
  for (const f of features) {
    const key = keyOf(f);
    const size = countPoints(f);
    const had = best.get(key);
    if (!had || size > had.size) best.set(key, { f, size });
  }
  return [...best.values()].map((b) => b.f);
}

function keyOf(f: TileFeature): string {
  if (f.id !== undefined && f.id !== null) return `id:${f.id}`;
  // No id: fall back to the name and a coarse position, which is enough to
  // tell two buildings apart and not enough to tell two halves of one
  // building apart.
  const p = firstPoint(f);
  const name = String(f.properties?.name ?? "");
  return p ? `${name}@${p[0].toFixed(4)},${p[1].toFixed(4)}` : `n:${name}`;
}

function firstPoint(f: TileFeature): [number, number] | null {
  const rings = ringsIn(f);
  const first = rings[0]?.[0];
  return first ? [first[0], first[1]] : null;
}

function countPoints(f: TileFeature): number {
  return ringsIn(f).reduce((n, r) => n + r.length, 0);
}

/** Every ring or line in a feature, whatever its geometry type. */
export function ringsIn(f: TileFeature): number[][][] {
  const g = f.geometry;
  if (!g) return [];
  const c = g.coordinates as unknown;
  if (g.type === "Polygon") return [(c as number[][][])[0]].filter(Boolean);
  if (g.type === "MultiPolygon") return (c as number[][][][]).map((p) => p[0]).filter(Boolean);
  if (g.type === "LineString") return [c as number[][]];
  if (g.type === "MultiLineString") return c as number[][][];
  return [];
}

/** Buildings, as closed rings with a middle. */
export function shapesFrom(features: TileFeature[]): Shape[] {
  const out: Shape[] = [];
  for (const f of dedupe(features)) {
    for (const ring of ringsIn(f)) {
      if (ring.length < 4) continue;
      const closed = [...ring];
      const [fx, fy] = closed[0], [lx, ly] = closed[closed.length - 1];
      if (fx !== lx || fy !== ly) closed.push(closed[0]);
      out.push({
        id: `t${f.id ?? out.length}-${out.length}`,
        ring: closed,
        centre: centroid(closed),
      });
    }
  }
  return out;
}

/**
 * Named streets, as lines, with the pieces of one street joined up.
 *
 * A street arrives as a line per tile and often several per tile, so Lady
 * Viola comes back as nine short pieces. Left apart, the one nearest a home
 * decides which side of the street it is on, and a home at the join can be
 * measured against a stub pointing the wrong way. Joined end to end by
 * name, there is one street and one answer.
 */
export function roadsFrom(features: TileFeature[]): Road[] {
  const byName = new Map<string, number[][][]>();
  for (const f of dedupe(features)) {
    const name = f.properties?.name;
    if (typeof name !== "string" || !name.trim()) continue;
    for (const line of ringsIn(f)) {
      if (line.length < 2) continue;
      byName.set(name, [...(byName.get(name) ?? []), line]);
    }
  }
  return [...byName].map(([name, pieces]) => ({ name, line: stitch(pieces) }));
}

/**
 * Pieces of one street, put in order along it.
 *
 * Not a true join -- the pieces are not re-linked end to end -- but sorted
 * by where they sit along the street's own overall direction, which is all
 * that the distance and side-of-the-road maths needs and cannot be defeated
 * by a gap in the middle.
 */
export function stitch(pieces: number[][][]): number[][] {
  const all = pieces.flat();
  if (all.length < 2) return all;

  // The street's overall direction, from the two points furthest apart in
  // x, which for a street is good enough and costs one pass.
  let lo = all[0], hi = all[0];
  for (const p of all) {
    if (p[0] < lo[0]) lo = p;
    if (p[0] > hi[0]) hi = p;
  }
  const dx = hi[0] - lo[0], dy = hi[1] - lo[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;

  return [...all].sort((a, b) =>
    (a[0] * ux + a[1] * uy) - (b[0] * ux + b[1] * uy));
}
