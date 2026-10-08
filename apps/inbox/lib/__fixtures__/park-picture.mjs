/**
 * Draw the park the layout actually produces, as an SVG, so it can be
 * looked at before anybody else has to look at it.
 *
 * Every round of this screen shipped on green tests and came back wrong,
 * because the tests asked whether the numbers were in order and never
 * asked what the thing looked like. A row folded back on itself passes
 * "fifty one lots, each with its own id" and is obviously broken to anyone
 * who sees it.
 *
 * Run: node lib/__fixtures__/park-picture.mjs [out.svg]
 */
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { tmpdir } from "os";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const tr = (f) => ts.transpileModule(
  readFileSync(join(here, "..", f), "utf8").replace(/^import type .*$/gm, ""),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

const gen = {
  f: join(here, "..", ".p.foot.mjs"), p: join(here, "..", ".p.plan.mjs"),
  o: join(here, "..", ".p.osm.mjs"), h: join(here, "..", ".p.harvest.mjs"),
  r: join(here, "..", ".p.rows.mjs"),
};
const fix = (src) => src
  .replace(/(["'])\.\/footprint\1/g, '"./.p.foot.mjs"')
  .replace(/(["'])\.\/parkplan\1/g, '"./.p.plan.mjs"')
  .replace(/(["'])\.\/osm\1/g, '"./.p.osm.mjs"')
  .replace(/(["'])\.\/harvest\1/g, '"./.p.harvest.mjs"');
writeFileSync(gen.f, tr("footprint.ts"));
writeFileSync(gen.p, fix(tr("parkplan.ts")));
writeFileSync(gen.o, fix(tr("osm.ts")));
writeFileSync(gen.h, fix(tr("harvest.ts")));
writeFileSync(gen.r, fix(tr("rows.ts")));
let layRows, clipTo, reachTo, roadsFrom, RETREAT, placeFromRoads, inRing, centroid;
try {
  ({ layRows, clipTo, reachTo } = await import(gen.r));
  ({ roadsFrom } = await import(gen.h));
  ({ RETREAT } = await import(gen.p));
  ({ placeFromRoads, inRing, centroid } = await import(gen.o));
} finally {
  for (const f of Object.values(gen)) unlinkSync(f);
}

// A park shaped like the real one: two streets at 112 degrees, each
// arriving as several tile pieces out of order, a loop at the east end,
// the same street names continuing well past the park at both ends, and a
// deed line that stops short of Pamalee Drive.
const LAT = 35.09249, LNG = -78.91932;
const dLat = 1 / 111_320;
const dLng = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
const TURN = (112 * Math.PI) / 180;
/** metres along the park, metres across it -> lng,lat */
const at = (along, across) => [
  LNG + (along * Math.sin(TURN) + across * Math.cos(TURN)) * dLng,
  LAT + (along * Math.cos(TURN) - across * Math.sin(TURN)) * dLat,
];

const pieces = (across, cuts) => {
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    out.push([at(cuts[i], across), at(cuts[i + 1], across)]);
  }
  return out;
};
// Out of order, one reversed, plus a detached run of the same name east.
const violaBits = [
  ...pieces(15.5, [-140, -40, 0, 70, 150, 210]),
  [at(520, 15.5), at(640, 15.5)],
];
const cherylBits = pieces(-41.5, [-140, -30, 55, 150, 210]);
const scramble = (a) => [a[2], [...a[0]].reverse(), a[4] ?? a[3], a[1], a[3], ...a.slice(5)];

const roads = roadsFrom([
  ...scramble(violaBits).map((line, i) => ({
    id: `v${i}`, properties: { name: "Lady Viola Drive" },
    geometry: { type: "LineString", coordinates: line },
  })),
  ...scramble(cherylBits).map((line, i) => ({
    id: `c${i}`, properties: { name: "Lady Cheryl Drive" },
    geometry: { type: "LineString", coordinates: line },
  })),
]);

// The deed line, with the notch at the entrance, stopping eight metres
// shy of Pamalee Drive.
const parcel = [
  at(-8, 42), at(165, 42), at(175, -20), at(165, -80), at(-8, -80),
  at(-8, -30), at(18, -30), at(18, 10), at(-8, 10), at(-8, 42),
];
const pamalee = [at(-16, 90), at(-16, -130)];
const fence = reachTo(parcel, pamalee);
const fitted = placeFromRoads(RETREAT, roads) ?? RETREAT;
const pads = layRows(fitted, roads, fence);

// --- what it looks like ---
const all = [...fence, ...pads.flatMap((p) => p.ring), ...roads.flatMap((r) => r.line)];
const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
const minX = Math.min(...xs), maxX = Math.max(...xs);
const minY = Math.min(...ys), maxY = Math.max(...ys);
const W = 1100, PAD = 30;
const k = (W - 2 * PAD) / (maxX - minX);
const H = Math.round((maxY - minY) * k * Math.cos((LAT * Math.PI) / 180) ** 0) + 2 * PAD;
const sx = (x) => PAD + (x - minX) * k;
const sy = (y) => H - PAD - (y - minY) * k;
const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(" ");

const outside = pads.filter((p) => !inRing(centroid(p.ring), fence));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#eef1f4"/>
<path d="${path(fence)} Z" fill="#dce7f5" stroke="#1F5BA6" stroke-width="2.5"/>
${roads.map((r) => `<path d="${path(clipTo(r.line, fence))}" fill="none" stroke="#fff" stroke-width="8"/>`).join("\n")}
${pads.map((p) => {
  const bad = !inRing(centroid(p.ring), fence);
  return `<path d="${path(p.ring)} Z" fill="${bad ? "#D1453B" : "#6B7F99"}" stroke="#17212E" stroke-width="0.8"/>`;
}).join("\n")}
${pads.map((p) => {
  const c = centroid(p.ring);
  return `<text x="${sx(c[0]).toFixed(1)}" y="${(sy(c[1]) + 3).toFixed(1)}" font-family="sans-serif" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">${p.label}</text>`;
}).join("\n")}
</svg>`;

const out = process.argv[2] ?? join(tmpdir(), "park-check.svg");
writeFileSync(out, svg);

// --- and the things a picture makes obvious, as checks ---
const rowOf = (street, side) => pads.filter((p) => p.street === street && p.side === side);
const problems = [];
if (pads.length !== 51) problems.push(`${pads.length} lots, not 51`);
if (outside.length) problems.push(`${outside.length} outside the fence: ${outside.map((p) => p.label).join(", ")}`);
for (const [street, side] of [
  ["Lady Viola Dr", "N"], ["Lady Viola Dr", "S"],
  ["Lady Cheryl Dr", "N"], ["Lady Cheryl Dr", "S"],
]) {
  const row = rowOf(street, side);
  const cs = row.map((p) => centroid(p.ring));
  const gaps = cs.slice(1).map((c, i) => Math.hypot(
    (c[0] - cs[i][0]) / dLng, (c[1] - cs[i][1]) / dLat));
  const spread = Math.max(...gaps) - Math.min(...gaps);
  if (spread > 1) problems.push(`${street} ${side} spacing varies by ${spread.toFixed(1)} m`);
  // A row that folds back on itself: the straight-line span should be
  // the sum of the gaps, near enough.
  const span = Math.hypot(
    (cs[cs.length - 1][0] - cs[0][0]) / dLng, (cs[cs.length - 1][1] - cs[0][1]) / dLat);
  const walked = gaps.reduce((a, b) => a + b, 0);
  if (walked > span * 1.25) problems.push(`${street} ${side} folds back on itself`);
  if (Math.min(...gaps) < 6) problems.push(`${street} ${side} has lots on top of each other`);
}
console.log(`wrote ${out}`);
console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "nothing obviously wrong");
process.exit(problems.length ? 1 : 0);
