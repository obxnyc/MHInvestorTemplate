/**
 * Placing a park by tapping it on the aerial.
 *
 * For a park with no county parcel, no lot lines, no buildings in the
 * map and no street name inside it -- which is most parks -- there is
 * nothing to derive a layout from. The homes are plainly visible in the
 * photograph and nowhere else. So the tool that matters is the one that
 * turns a few taps on that photograph into the park, and it had never
 * been checked that it does.
 *
 * The test: take a park whose real position, angle and spacings are
 * known, pretend somebody tapped the homes the screen asks them to tap,
 * and see whether what comes back is the park they tapped.
 *
 *     node lib/__fixtures__/fit-check.mjs
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
const { layOut, fitTargets, fitFromTaps, SINGLE_WIDE } =
  await import(join(here, "parkplan.gen.mjs"));

const run = (n, from) => Array.from({ length: n }, (_, i) => String(from + i));

/** Northside as it really is: 59 lots, chevroned, off Northside Road. */
const truth = {
  centre: [-76.2900, 36.3702], bearing: 173, homeTurn: 34,
  padSpacing: 11.5, pairGap: 38, streetGap: 60,
  size: SINGLE_WIDE, countFrom: "west",
  naming: "lot", address: "1140 Northside Rd",
  rows: [
    { street: "The drive", side: "N", numbers: run(30, 1) },
    { street: "The drive", side: "S", numbers: run(29, 31) },
  ],
};

/** What somebody starts from: the right lots, everything else a guess. */
const guess = {
  ...truth, centre: [-76.30, 36.36], bearing: 8, homeTurn: 30,
  padSpacing: 14, pairGap: 34, streetGap: 60,
};

const real = layOut(truth);
const where = (id) => {
  const h = real.find((x) => x.id === id);
  if (!h) throw new Error(`no home ${id} to tap`);
  return [h.lng, h.lat];
};

const targets = fitTargets(guess);
console.log(`it asks for ${targets.length} taps:`);
for (const t of targets) console.log(`   ${t.label} — ${t.say}`);

const taps = targets.map((t) => where(t.id));
const got = fitFromTaps(guess, taps);

const wrong = [];
const near = (name, a, b, tol, unit = "") => {
  const off = Math.abs(a - b);
  if (off > tol) wrong.push(`${name}: ${a.toFixed(2)}${unit}, should be ${b.toFixed(2)}${unit}`);
  else console.log(` ok  ${name} within ${off.toFixed(2)}${unit}`);
};

// A park with one street gets three taps, not four: there is no second
// street to measure to. It must still work.
if (targets.length < 2) wrong.push("it asks for fewer than two taps, so it cannot work at all");

near("bearing", got.bearing, truth.bearing, 0.5, "°");
near("spacing along the row", got.padSpacing, truth.padSpacing, 0.3, " m");
near("gap across the drive", got.pairGap, truth.pairGap, 1.0, " m");

// The whole point: every home ends up where it really is.
const placed = layOut(got);
const metres = (a, b) => {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111320;
};
let worst = 0, worstAt = "";
for (const h of real) {
  const mine = placed.find((x) => x.id === h.id);
  if (!mine) { wrong.push(`lot ${h.label} went missing`); continue; }
  const off = metres([h.lng, h.lat], [mine.lng, mine.lat]);
  if (off > worst) { worst = off; worstAt = h.label; }
}
if (worst > 2) wrong.push(`lot ${worstAt} lands ${worst.toFixed(1)} m from where it is`);
else console.log(` ok  every one of ${real.length} lots within ${worst.toFixed(2)} m`);

// And the home that was tapped must be exactly under the finger.
near("the tapped home", metres(taps[0], where(targets[0].id)), 0, 0.01, " m");
const first = placed.find((x) => x.id === targets[0].id);
near("ends up under the tap", metres([first.lng, first.lat], taps[0]), 0, 0.5, " m");

if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
