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
let RETREAT, layOut, boundaryOf, maskOf, streetLines, streetsOf, countOf, convexHull;
let fitTargets, fitFromTaps, localOf;
let footprint, metresBetween;
try {
  ({ RETREAT, layOut, boundaryOf, maskOf, streetLines, streetsOf, countOf, convexHull,
     fitTargets, fitFromTaps, localOf } = await import(tmp));
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
{
  // A park block is a rectangle. The hull version came out a rounded blob
  // because every corner of it was a different row sticking out at a
  // different angle, which is what "the shape is off" was looking at.
  const ring = boundaryOf(RETREAT);
  t("the boundary has four corners", ring.length === 5);
  const side = (i) => metresBetween(ring[i], ring[i + 1]);
  t("opposite sides are equal", near(side(0), side(2), 0.1) && near(side(1), side(3), 0.1));
  // And it stays a rectangle of the same size when the park is turned,
  // which a bounding box measured in north and east would not.
  const turned = boundaryOf({ ...RETREAT, bearing: (RETREAT.bearing + 41) % 360 });
  t("turning the park does not inflate its boundary",
    near(metresBetween(turned[0], turned[1]), side(0), 0.5)
    && near(metresBetween(turned[1], turned[2]), side(1), 0.5));
}

// --- pinned by tapping pads on the photograph ---
{
  const want = fitTargets(RETREAT);
  t("four pads to tap", want.length === 4);
  t("the first two are the ends of one row",
    want[0].street === want[1].street && want[0].label !== want[1].label);
  t("they are real pads on the drawing",
    want.every((w) => layOut(RETREAT).some((h) => h.id === w.id)));
}
{
  // Take a park we know, read off where four of its pads actually are,
  // feed those back as taps, and the answer has to be the park we started
  // with. If this drifts, fitting makes the map worse every time it is used.
  const truth = {
    ...RETREAT, bearing: 97, padSpacing: 12.4, pairGap: 34, streetGap: 61,
    centre: [-78.9188, 35.0931],
  };
  const where = (id) => {
    const h = layOut(truth).find((x) => x.id === id);
    return [h.lng, h.lat];
  };
  const taps = fitTargets(RETREAT).map((w) => where(w.id));
  const got = fitFromTaps(RETREAT, taps);

  t("tapping recovers the bearing", near(got.bearing, truth.bearing, 0.2));
  t("and the spacing along a row", near(got.padSpacing, truth.padSpacing, 0.1));
  t("and the width of the street", near(got.pairGap, truth.pairGap, 0.3));
  t("and the distance to the next street", near(got.streetGap, truth.streetGap, 0.3));

  // Every home within a few centimetres of where it should be.
  const after = layOut(got), before = layOut(truth);
  const worst = Math.max(...after.map((h, i) =>
    metresBetween([h.lng, h.lat], [before[i].lng, before[i].lat])));
  t("and every home lands where it belongs", worst < 0.5);
}
{
  // Two taps are enough to be worth applying -- the angle and the spacing
  // are most of what is wrong -- so the park must move before the fourth.
  const truth = { ...RETREAT, bearing: 80, padSpacing: 9 };
  const where = (id) => {
    const h = layOut(truth).find((x) => x.id === id);
    return [h.lng, h.lat];
  };
  const two = fitTargets(RETREAT).slice(0, 2).map((w) => where(w.id));
  const got = fitFromTaps(RETREAT, two);
  t("two taps already set the angle", near(got.bearing, 80, 0.2));
  t("and the spacing", near(got.padSpacing, 9, 0.05));
  t("and leave the cross-street gaps alone", got.pairGap === RETREAT.pairGap);
}
{
  t("one tap changes nothing", fitFromTaps(RETREAT, [[-78.9, 35.09]]) === RETREAT);
}
{
  // The park's own frame, and its inverse. Everything in fitting rests on
  // these two agreeing.
  const h = layOut(RETREAT)[0];
  const l = localOf(RETREAT, RETREAT.centre, [h.lng, h.lat]);
  t("a home sits at sane local coordinates",
    Math.abs(l.along) < 200 && Math.abs(l.across) < 200);
}

// --- everything that is not the park ---
{
  const mask = maskOf(RETREAT);
  t("the mask is an outer ring and one hole", mask.length === 2);
  t("the outer ring covers the world",
    mask[0].some(([x]) => x <= -180) && mask[0].some(([x]) => x >= 180));
  // A hole has to wind against its outer ring. Wound the same way it is not
  // a hole, it is a second filled shape sitting on top of the park -- which
  // looks like the veil simply failed to cut out.
  const area = (ring) => {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return a / 2;
  };
  t("and the hole winds the other way",
    Math.sign(area(mask[0])) !== Math.sign(area(mask[1])));
  t("the hole is the park boundary",
    mask[1].length === boundaryOf(RETREAT).length);
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
