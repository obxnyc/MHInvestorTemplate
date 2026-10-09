/**
 * The description handed over for 1140 Northside Rd.
 *
 * Measured off the county's own georeferenced aerial rather than read
 * off a screenshot by eye, which is how the park came to be four
 * kilometres from where it stands. This checks the numbers are
 * self-consistent before anybody pastes them: that the lots are inside
 * the boundary, that the boundary is the size the tax card says, and
 * that the rows that were placed sit where the loop road is.
 *
 *     node lib/__fixtures__/northside-plan-check.mjs /tmp/northside.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of ["footprint", "parkplan"]) {
  const src = readFileSync(join(here, `${f}.ts`), "utf8").replace(/^import type .*$/gm, "");
  writeFileSync(join(here, `${f}.gen.mjs`),
    ts.transpileModule(src, { compilerOptions: { target: 99, module: 99 } }).outputText
      .replace(/from "\.\/(\w+)"/g, `from "${join(here, "$1.gen.mjs")}"`));
}
const { layOut, placed, SINGLE_WIDE } = await import(join(here, "parkplan.gen.mjs"));
const { footprint } = await import(join(here, "footprint.gen.mjs"));

const file = process.argv[2] ?? "/tmp/northside.json";
let plan;
try { plan = JSON.parse(readFileSync(file, "utf8")); }
catch { console.log(`skipped: no description at ${file}`); process.exit(0); }
plan.size = SINGLE_WIDE;

const wrong = [];
const ACRE = 4046.8564;
const area = (ring) => {
  const lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += (x1 * k * 111320) * (y2 * 111320) - (x2 * k * 111320) * (y1 * 111320);
  }
  return Math.abs(a) / 2 / ACRE;
};
const inRing = (p, ring) => {
  let on = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1])
        && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) on = !on;
  }
  return on;
};

const homes = layOut(plan);
console.log(`${homes.length} lots, ${plan.rows.length} rows, `
  + `${plan.rows.filter(placed).length} of them placed by their ends`);

if (homes.length !== 59) wrong.push(`${homes.length} lots, the owner says 59`);
else console.log(" ok  59 lots");

// The boundary. Taxed acres is 13.86; the cleared ground inside the
// tree line is necessarily less, and wildly less would mean the trace
// had wandered.
const acres = area(plan.fence);
if (acres < 9 || acres > 14.5) wrong.push(`the boundary is ${acres.toFixed(2)} acres, and the card says 13.86`);
else console.log(` ok  boundary ${acres.toFixed(2)} acres against 13.86 taxed`);

// Every placed home, and its whole footprint, inside that line.
let out = 0, worst = "";
for (const h of homes) {
  if (!plan.rows.find((r) => r.numbers.includes(h.label) && placed(r))) continue;
  for (const c of footprint(h.lat, h.lng, h.bearing, SINGLE_WIDE)) {
    if (!inRing(c, plan.fence)) { out += 1; worst = h.label; break; }
  }
}
if (out) wrong.push(`${out} placed homes stick out of the boundary, e.g. lot ${worst}`);
else console.log(" ok  every placed home is inside the boundary");

// The two loop rows face each other across the road: same length,
// parallel, and the right distance apart.
const ends = plan.rows.filter(placed);
if (ends.length === 2) {
  const len = (r) => {
    const k = Math.cos((r.from[1] * Math.PI) / 180);
    return Math.hypot((r.to[0] - r.from[0]) * k, r.to[1] - r.from[1]) * 111320;
  };
  const a = len(ends[0]), b = len(ends[1]);
  if (Math.abs(a - b) > 2) wrong.push(`the two loop rows differ in length: ${a.toFixed(0)} m and ${b.toFixed(0)} m`);
  else console.log(` ok  both loop rows ${a.toFixed(0)} m long`);
  const k = Math.cos((ends[0].from[1] * Math.PI) / 180);
  const gap = Math.hypot((ends[0].from[0] - ends[1].from[0]) * k,
                         ends[0].from[1] - ends[1].from[1]) * 111320;
  if (gap < 30 || gap > 60) wrong.push(`the loop rows are ${gap.toFixed(0)} m apart, which is not a road`);
  else console.log(` ok  loop rows ${gap.toFixed(0)} m apart`);
}

// No two homes on top of each other.
let clash = 0;
for (let i = 0; i < homes.length; i++) {
  for (let j = i + 1; j < homes.length; j++) {
    const k = Math.cos((homes[i].lat * Math.PI) / 180);
    const d = Math.hypot((homes[i].lng - homes[j].lng) * k, homes[i].lat - homes[j].lat) * 111320;
    if (d < 4) clash += 1;
  }
}
if (clash) wrong.push(`${clash} pairs of homes are within 4 m of each other`);
else console.log(" ok  no two homes on the same spot");

if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
