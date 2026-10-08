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
import { metresBetween } from "./footprint";

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
 * Pieces of one street, joined end to end.
 *
 * This sorted every point of every piece along the street's overall
 * direction, which works for one straight street and nothing else. A
 * street arrives as a line per tile, often several, and a name covers
 * everything that carries it -- the part inside the park, the part a
 * quarter mile east of it, and the loop at the end. Sorted into one list,
 * those become a single line that zig-zags across the site, and a row of
 * homes walked along it wanders off at angles that match nothing.
 *
 * Joined properly: start at a loose end, take the nearest piece each time,
 * turn it round if it is the wrong way about, and stop when the next
 * nearest is too far to be the same street. Of the chains that come out,
 * the longest is the street.
 */
export function stitch(pieces: number[][][], gap = 8): number[][] {
  const left = pieces.filter((p) => p.length >= 2).map((p) => [...p]);
  if (!left.length) return pieces.flat();

  const chains: number[][][] = [];
  while (left.length) {
    const chain = left.shift()!;
    // Grow at both ends until nothing is close enough to belong.
    for (let end = 0; end < 2; end++) {
      for (;;) {
        const tip = chain[chain.length - 1];
        let best = -1, flip = false, how = Infinity;
        left.forEach((piece, i) => {
          const a = metresBetween([tip[0], tip[1]], [piece[0][0], piece[0][1]]);
          const b = metresBetween(
            [tip[0], tip[1]], [piece[piece.length - 1][0], piece[piece.length - 1][1]],
          );
          if (Math.min(a, b) < how) { how = Math.min(a, b); best = i; flip = b < a; }
        });
        // Tight on purpose. Pieces of one street share their endpoints
        // exactly, so anything more than a few metres is a different
        // stretch of road -- and a loose threshold lets a piece that
        // belongs at the far end of the chain attach to this one, which
        // folds the street back on itself and sends the row of homes
        // across the park at an angle that matches nothing.
        if (best < 0 || how > gap) break;
        const next = left.splice(best, 1)[0];
        const add = flip ? [...next].reverse() : next;
        // The shared endpoint arrives twice.
        chain.push(...(how < 1e-9 ? add.slice(1) : add));
      }
      chain.reverse();
    }
    chains.push(chain);
  }

  // The longest run is the street; the rest is the same name somewhere
  // else, which is not this park's street however it is spelled.
  let best = chains[0];
  let far = -1;
  for (const c of chains) {
    const d = lengthOf(c);
    if (d > far) { far = d; best = c; }
  }
  return best;
}

function lengthOf(line: number[][]): number {
  let d = 0;
  for (let i = 0; i < line.length - 1; i++) {
    d += metresBetween([line[i][0], line[i][1]], [line[i + 1][0], line[i + 1][1]]);
  }
  return d;
}
