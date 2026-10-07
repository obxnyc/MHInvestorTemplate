/** A park described in rows, and the geometry that comes out of it.
 *  Run: node lib/__fixtures__/parkplan.test.mjs */
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const transpile = (file) =>
  ts.transpileModule(
    readFileSync(join(here, "..", file), "utf8").replace(/^import type .*$/gm, ""),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;

// parkplan.ts imports ./footprint. TypeScript fills in the extension and
// Node does not, so both are written into lib/ -- a relative specifier
// resolves against the importing file's directory, and from __fixtures__/
// that directory has no footprint module in it.
const tmp = join(here, "..", ".parkplan.gen.mjs");
const tmpFoot = join(here, "..", ".parkplan.footprint.gen.mjs");
writeFileSync(tmpFoot, transpile("footprint.ts"));
writeFileSync(tmp, transpile("parkplan.ts")
  .replace(/(["'])\.\/footprint\1/g, '"./.parkplan.footprint.gen.mjs"'));
let RETREAT, layOut, boundaryOf, streetLines, streetsOf, countOf, convexHull;
let footprint, metresBetween;
try {
  ({ RETREAT, layOut, boundaryOf, streetLines, streetsOf, countOf, convexHull } =
    await import(tmp));
  ({ footprint, metresBetween } = await import(tmpFoot));
} finally {
  unlinkSync(tmp);
  unlinkSync(tmpFoot);
}

const checks = [];
const t = (n, ok) => checks.push([n, ok]);
const near = (a, b, e = 0.5) => Math.abs(a - b) < e;

// --- the park as described ---
{
  // The number the owner counted inside the boundary they drew on the county
  // map. If this drifts, the drawing has stopped being the park.
  t("fifty one lots", countOf(RETREAT) === 51);
  t("two streets", streetsOf(RETREAT).length === 2);
  const labels = layOut(RETREAT).map((h) => h.id);
  t("every lot has its own id", new Set(labels).size === labels.length);
  // Both streets number from 3100, so a bare number is ambiguous and the id
  // has to carry the street or two pads collapse into one.
  const bare = layOut(RETREAT).map((h) => h.label);
  t("and the bare numbers repeat, which is why they are not the id",
    new Set(bare).size < bare.length);
}

// --- the geometry ---
{
  const homes = layOut(RETREAT);
  const viola = homes.filter((h) => h.street === "Lady Viola Dr" && h.side === "N");
  const gaps = viola.slice(1).map((h, i) =>
    metresBetween([viola[i].lng, viola[i].lat], [h.lng, h.lat]));
  t("homes along a row are evenly spaced",
    gaps.every((g) => near(g, RETREAT.padSpacing, 0.05)));
  t("and spaced by the number asked for",
    near(gaps[0], RETREAT.padSpacing, 0.05));
}
{
  // The two rows facing one street, measured across it. Getting this wrong
  // is how a park ends up with its homes in the road.
  const homes = layOut(RETREAT);
  const n = homes.find((h) => h.street === "Lady Viola Dr" && h.side === "N" && h.label === "3112");
  const s = homes.find((h) => h.street === "Lady Viola Dr" && h.side === "S" && h.label === "3113");
  const across = metresBetween([n.lng, n.lat], [s.lng, s.lat]);
  t("the two rows on a street are pairGap apart across it",
    across > RETREAT.pairGap - 6 && across < RETREAT.pairGap + 6);
}
{
  const homes = layOut(RETREAT);
  const a = homes.find((h) => h.street === "Lady Viola Dr");
  const b = homes.find((h) => h.street === "Lady Cheryl Dr");
  t("the streets are apart, not on top of each other",
    metresBetween([a.lng, a.lat], [b.lng, b.lat]) > 20);
}
{
  // A home stands square to its street, not along it. A row of rectangles
  // lying lengthways down the road is the single most obvious way for this
  // drawing to be wrong.
  const h = layOut(RETREAT)[0];
  t("a home stands square to its street",
    near(((h.bearing - RETREAT.bearing) % 360 + 360) % 360, 90, 0.01));
}
{
  // Turning the whole block must not change the park, only its orientation.
  const turned = { ...RETREAT, bearing: (RETREAT.bearing + 37) % 360 };
  const before = layOut(RETREAT), after = layOut(turned);
  const span = (hs) => {
    let max = 0;
    for (const a of hs) for (const b of hs)
      max = Math.max(max, metresBetween([a.lng, a.lat], [b.lng, b.lat]));
    return max;
  };
  t("turning the block does not resize it", near(span(before), span(after), 1.5));
}

// --- the boundary ---
{
  const ring = boundaryOf(RETREAT);
  t("the boundary closes",
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]);
  t("it is a polygon, not a line", ring.length >= 4);

  // Every corner of every home inside the line, or the boundary is drawing
  // somewhere the park is not.
  const inside = (pt, poly) => {
    let hit = false;
    for (let i = 0, j = poly.length - 2; i < poly.length - 1; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1])
        && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const corners = layOut(RETREAT)
    .flatMap((h) => footprint(h.lat, h.lng, h.bearing, RETREAT.size));
  t("every home is inside the boundary", corners.every((c) => inside(c, ring)));
}
{
  const square = convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]);
  t("a hull drops the point in the middle", square.length === 5);
}

// --- the street labels ---
{
  const lines = streetLines(RETREAT);
  t("one label line per street", lines.length === 2);
  t("each runs the length of its street",
    lines.every((l) => metresBetween(l.line[0], l.line[1]) > 50));
}

const bad = checks.filter(([, ok]) => !ok);
for (const [n, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${n}`);
console.log(bad.length ? `\n${bad.length} failed` : `\nall ${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
