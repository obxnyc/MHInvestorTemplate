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
let layRows, clipTo, reachTo, roadsFrom, RETREAT, placeFromRoads, inRing, centroid, footprint;
try {
  ({ layRows, clipTo, reachTo } = await import(gen.r));
  ({ roadsFrom } = await import(gen.h));
  ({ RETREAT } = await import(gen.p));
  ({ placeFromRoads, inRing, centroid } = await import(gen.o));
  ({ footprint } = await import(gen.f));
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

// In this frame a positive "across" is southward, because the park runs
// east-south-east. Lady Cheryl is the southern street, so it is the
// larger across; each street's even row is its northern one.
const VIOLA = 0, CHERYL = 57, SETBACK = 15.5;

const pieces = (across, cuts) => {
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    out.push([at(cuts[i], across), at(cuts[i + 1], across)]);
  }
  return out;
};

// The horseshoe. Lady Viola and Lady Cheryl are the two legs of one loop:
// they meet at the bend by the east boundary and come back. Whatever the
// map calls each half, the geometry joins -- so a row walked along "the
// street" carries on round the bend and back up the other side, which is
// the thing the owner pointed at.
const bend = (from, to, mid) => {
  const out = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const ang = Math.PI * t;
    out.push(at(mid + Math.sin(ang) * 18, (from + to) / 2 - Math.cos(ang) * (to - from) / 2));
  }
  return out;
};
const loop = bend(VIOLA, CHERYL, 150);

const violaBits = [
  ...pieces(VIOLA, [-140, -40, 0, 70, 150]),
  // The same name continuing a quarter mile east, nothing to do with us.
  [at(520, VIOLA), at(640, VIOLA)],
  // ...and the bend, which the map hangs on one of the two names.
  loop,
];
const cherylBits = pieces(CHERYL, [-140, -30, 55, 150]);
const scramble = (a) => {
  const out = [...a];
  // Out of order, and one of them traced backwards.
  out.reverse();
  out[1] = [...out[1]].reverse();
  return out;
};

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
// The step by the entrance, where the county card shows it: the deed
// line comes in off Pamalee Drive between Lady Viola and Lady Cheryl.
//
// This was moved twice to stop the check complaining, which is the wrong
// way round -- a fixture is the claim about the world, and bending it to
// make a test pass only hides whatever the test found. It is back where
// the card puts it, and the check below is the thing that changed.
// The step by the entrance, where the county card shows it: the deed
// line comes in off Pamalee Drive in the gap BETWEEN Lady Viola's odd row
// and Lady Cheryl's even row. It does not cut a row, on the card or here
// -- every lot in this park is inside the line.
const parcel = [
  at(-8, -42), at(165, -42), at(175, 20), at(165, 95), at(-8, 95),
  at(-8, 32), at(16, 32), at(16, 26), at(-8, 26), at(-8, -42),
];
const pamalee = [at(-16, -95), at(-16, 130)];
const fence = reachTo(parcel, pamalee);
const fitted = placeFromRoads(RETREAT, roads) ?? RETREAT;

// The buildings the map has. Every row but one is short on purpose: a pad
// that was empty when the aerial was flown has no building on it and is
// still a lot, and that is the case this has to get right.
//
//   Lady Viola even   13 lots, 12 buildings, the empty one at the loop
//   Lady Viola odd    13 lots, 11 buildings, two empty at the entrance
//   Lady Cheryl even  13 lots, 11 buildings, two empty at the entrance
//   Lady Cheryl odd   12 lots, 12 buildings
const PITCH = 10.5;
const built = [];
const put = (across, from, count, skip = []) => {
  for (let i = 0; i < count; i++) {
    if (skip.includes(i)) continue;
    const c = at(from + i * PITCH, across);
    built.push({
      id: `b${built.length}`, centre: c,
      ring: footprint(c[1], c[0], 22, { width: 4.6, length: 17 }),
    });
  }
};
put(VIOLA - SETBACK, 6, 13, [12]);
put(VIOLA + SETBACK, 6, 13, [0, 1]);
put(CHERYL - SETBACK, 6, 13, [0, 1]);
put(CHERYL + SETBACK, 6, 12);

const pads = layRows(fitted, roads, fence, built);

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

/** How far outside the boundary a point is, in metres. Nought inside. */
const howFarOut = (pt) => {
  if (inRing(pt, fence)) return 0;
  let near = Infinity;
  for (let i = 0; i < fence.length - 1; i++) {
    const a = fence[i], b = fence[i + 1];
    const dx = (b[0] - a[0]) / dLng, dy = (b[1] - a[1]) / dLat;
    const px = (pt[0] - a[0]) / dLng, py = (pt[1] - a[1]) / dLat;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
    near = Math.min(near, Math.hypot(px - t * dx, py - t * dy));
  }
  return near;
};
// A lot a metre or two past a traced line is tracing error; a lot twenty
// metres out is a bug. Only the second is worth moving a row for, and
// moving rows to satisfy the first is what indented 1808.
const outside = pads.filter((p) => howFarOut(centroid(p.ring)) > 8);
// A step ladder: every home in the park is a rung, all square to one
// line. Not just every home in its own row.
const everyAngle = [];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#eef1f4"/>
<path d="${path(fence)} Z" fill="#dce7f5" stroke="#1F5BA6" stroke-width="2.5"/>
${roads.map((r) => `<path d="${path(clipTo(r.line, fence))}" fill="none" stroke="#fff" stroke-width="8"/>`).join("\n")}
${built.map((b) => `<path d="${path(b.ring)} Z" fill="none" stroke="#b08968" stroke-width="1.6"/>`).join("\n")}
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
// Rows begin level with each other at the entrance. A row indented
// against its neighbours is the thing you see before anything else.
const starts = [["Lady Viola Dr", "N"], ["Lady Viola Dr", "S"],
                ["Lady Cheryl Dr", "N"], ["Lady Cheryl Dr", "S"]]
  .map(([st, sd]) => {
    const r = pads.filter((p) => p.street === st && p.side === sd);
    if (!r.length) return null;
    const c = centroid(r[0].ring);
    const e = (c[0] - LNG) / dLng, n = (c[1] - LAT) / dLat;
    return e * Math.sin(TURN) + n * Math.cos(TURN);
  }).filter((x) => x !== null);
if (starts.length === 4 && Math.max(...starts) - Math.min(...starts) > 6) {
  problems.push(`the rows do not start level (${(Math.max(...starts) - Math.min(...starts)).toFixed(1)} m apart)`);
}
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
  if (spread > 1.5) problems.push(`${street} ${side} spacing varies by ${spread.toFixed(1)} m`);
  // A row that folds back on itself: the straight-line span should be
  // the sum of the gaps, near enough.
  const span = Math.hypot(
    (cs[cs.length - 1][0] - cs[0][0]) / dLng, (cs[cs.length - 1][1] - cs[0][1]) / dLat);
  const walked = gaps.reduce((a, b) => a + b, 0);
  if (walked > span * 1.25) problems.push(`${street} ${side} folds back on itself`);
  // A pad is 4.88 m across, so anything under that overlaps its
  // neighbour. Checked against the real width rather than a round number.
  if (Math.min(...gaps) < 4.9) problems.push(`${street} ${side} has lots overlapping`);
  // Every home in a row stands in line with the rest. A pad that takes
  // its angle from its own neighbours fans a few degrees off and catches
  // the corner of the next one.
  // Folded into half a turn: a rectangle pointing north and the same
  // rectangle pointing south are the same rectangle, and 179 against 1
  // is two degrees apart, not a hundred and seventy-eight.
  const angleOf = (p) => {
    const a = p.ring[0], b = p.ring[1];
    const deg = (Math.atan2((b[0] - a[0]) / dLng, (b[1] - a[1]) / dLat) * 180) / Math.PI;
    return ((deg % 180) + 180) % 180;
  };
  const angles = row.map(angleOf);
  const off = Math.max(...angles) - Math.min(...angles);
  if (off > 1) problems.push(`${street} ${side} homes are not parallel (${off.toFixed(1)}°)`);
  everyAngle.push(...angles);
}
// A pad on every building the map has, which is the thing the owner
// keeps pointing at: an outline with nothing on it is a lot that failed.
for (const b of built) {
  const near = pads.some((p) =>
    Math.hypot((centroid(p.ring)[0] - b.centre[0]) / dLng,
               (centroid(p.ring)[1] - b.centre[1]) / dLat) < 3);
  if (!near) { problems.push(`a building with no lot on it`); break; }
}
// And the empty lots where the aerial shows nothing, not somewhere else.
const viola = rowOf("Lady Viola Dr", "N");
const lastViola = centroid(viola[viola.length - 1].ring);
const anyBuildingThere = built.some((b) =>
  Math.hypot((lastViola[0] - b.centre[0]) / dLng,
             (lastViola[1] - b.centre[1]) / dLat) < 3);
if (viola[viola.length - 1].label !== "3100") problems.push("Lady Viola even does not end at 3100");
if (anyBuildingThere) problems.push("3100 is not the empty pad at the loop");
if (viola.length !== 13) problems.push(`Lady Viola even has ${viola.length} lots, not 13`);

if (process.env.DEBUG) {
  for (const [street, side] of [["Lady Viola Dr", "N"], ["Lady Viola Dr", "S"],
                                ["Lady Cheryl Dr", "N"], ["Lady Cheryl Dr", "S"]]) {
    const row = rowOf(street, side);
    const cs = row.map((p) => centroid(p.ring));
    const gaps = cs.slice(1).map((c, i) => Math.hypot(
      (c[0] - cs[i][0]) / dLng, (c[1] - cs[i][1]) / dLat));
    console.log(`${street} ${side}: ${row.length} lots, gaps ${gaps.map((g) => g.toFixed(1)).join(" ")}`);
  }
}
if (everyAngle.length) {
  const spread = Math.max(...everyAngle) - Math.min(...everyAngle);
  if (spread > 1) problems.push(`the park's homes are not all parallel (${spread.toFixed(1)}°)`);
}
console.log(`wrote ${out}`);
console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "nothing obviously wrong");
process.exit(problems.length ? 1 : 0);
