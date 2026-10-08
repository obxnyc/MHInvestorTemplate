/**
 * A chevroned park, drawn and looked at.
 *
 * 1140 Northside Rd has no named street inside it and its homes are not
 * square to the drive -- they are angled, all the same way, which is how
 * a long home fits a narrow strip with a car beside it. Neither of those
 * was possible to express before `naming` and `homeTurn`, and both are
 * the kind of thing that passes every test about counts and ordering
 * while being visibly wrong.
 *
 * So this asks what a picture answers: are all forty the same angle, do
 * any two overlap, and is a lot filed under the name it will be filed
 * under. Run it after touching the layout.
 *
 *     node lib/__fixtures__/northside-check.mjs
 *
 * It writes /tmp/northside.svg either way. Look at it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";
const here = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of ["footprint", "parkplan"]) {
  const src = readFileSync(`${here}/${f}.ts`, "utf8").replace(/^import type .*$/gm, "");
  const js = ts.transpileModule(src, { compilerOptions: { target: 99, module: 99 } }).outputText
    .replace(/from "\.\/(\w+)"/g, `from "${here}/$1.gen.mjs"`);
  writeFileSync(`${here}/${f}.gen.mjs`, js);
}
const { layOut, SINGLE_WIDE } = await import(`${here}/parkplan.gen.mjs`);

const run = (n, from) => Array.from({ length: n }, (_, i) => String(from + i));
const plan = {
  centre: [-76.2486, 36.3339], bearing: 8, homeTurn: 30,
  padSpacing: 14, pairGap: 34, streetGap: 60,
  size: SINGLE_WIDE, countFrom: "west",
  naming: "lot", address: "1140 Northside Rd",
  rows: [
    { street: "The drive", side: "N", numbers: run(20, 1) },
    { street: "The drive", side: "S", numbers: run(20, 21) },
  ],
};
const homes = layOut(plan);
console.log("lots:", homes.length, "| filed[0]:", homes[0].filed);

// Are they all parallel? That is the claim "every home is the same model".
const bearings = new Set(homes.map((h) => Math.round(h.bearing)));
console.log("distinct home bearings:", [...bearings], bearings.size === 1 ? "parallel ok" : "NOT PARALLEL");

// Draw it, because a number in order is not a picture.
const { footprint } = await import(`${here}/footprint.gen.mjs`);
const rings = homes.map((h) => footprint(h.lat, h.lng, h.bearing, plan.size));
const pts = rings.flat();
const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
const W = 700, H = 1000, pad = 30;
const sx = (x) => pad + ((x - x0) / (x1 - x0)) * (W - 2 * pad);
const sy = (y) => H - pad - ((y - y0) / (y1 - y0)) * (H - 2 * pad);
const poly = (r, f, st) =>
  `<polygon points="${r.map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(" ")}" fill="${f}" stroke="${st}" stroke-width="1.2"/>`;
writeFileSync("/tmp/northside.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  + `<rect width="${W}" height="${H}" fill="#f7f8fa"/>`
  + rings.map((r) => poly(r, "#D4E4F7", "#2a78d6")).join("")
  + homes.map((h) => `<text x="${sx(h.lng).toFixed(1)}" y="${sy(h.lat).toFixed(1)}" font-size="9" text-anchor="middle" fill="#334155">${h.label}</text>`).join("")
  + `</svg>`);
console.log("wrote /tmp/northside.svg");

// Overlapping homes is the fault a picture shows and a count never does.
function hit(a, b) {
  for (const r of [a, b]) {
    for (let i = 0; i < r.length - 1; i++) {
      const nx = r[i + 1][1] - r[i][1], ny = r[i][0] - r[i + 1][0];
      const pr = (q) => q.map((p) => p[0] * nx + p[1] * ny);
      const A = pr(a), B = pr(b);
      if (Math.max(...A) < Math.min(...B) - 1e-12 || Math.max(...B) < Math.min(...A) - 1e-12) return false;
    }
  }
  return true;
}
let over = 0;
for (let i = 0; i < rings.length; i++)
  for (let j = i + 1; j < rings.length; j++) if (hit(rings[i], rings[j])) over++;
const wrong = [];
if (homes.length !== 40) wrong.push(`expected 40 lots, got ${homes.length}`);
if (bearings.size !== 1) wrong.push(`homes are not parallel: ${[...bearings]}`);
if (homes[0].filed !== "1140 Northside Rd Lot 1")
  wrong.push(`filed as "${homes[0].filed}", not "1140 Northside Rd Lot 1"`);
if (over) wrong.push(`${over} pairs of homes overlap`);
// Square homes would mean the angle was dropped somewhere between the
// plan and the drawing, which looks fine in a list of coordinates.
if (Math.round(homes[0].bearing) === (8 + 90) % 360)
  wrong.push("homes came out square to the row -- homeTurn was ignored");
if (wrong.length) { for (const w of wrong) console.error(" \u2717 " + w); process.exit(1); }
console.log("nothing obviously wrong");
