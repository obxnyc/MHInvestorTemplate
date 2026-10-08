/**
 * Rows placed by their two ends.
 *
 * The grid -- one bearing, one spacing, rows either side of a street --
 * describes a park a developer drew on paper. Northside is not that.
 * It is three groups: a long loop with a row down each side, a cluster
 * in the middle at its own angle, and a row across the front. No
 * bearing and no spacing can say that, which is why every attempt to
 * place it produced something wrong in a way no slider could fix.
 *
 * A row may now carry the middle of its first home and the middle of
 * its last, and everything else follows from those two points. This
 * checks that it does, and that a park can mix the two kinds.
 *
 *     node lib/__fixtures__/rows-by-hand-check.mjs
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

const run = (n, from) => Array.from({ length: n }, (_, i) => String(from + i));
const wrong = [];
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) wrong.push(`${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  else console.log(` ok  ${name}`);
};
const metres = (a, b) => {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111320;
};

// Northside as the drone photograph shows it: the loop at the top with
// a row down each side, the cluster in the middle on its own angle, and
// the front row where lot 1 starts.
const A = [-76.28655, 36.37265], B = [-76.28648, 36.37020];   // loop, west side
const C = [-76.28618, 36.37262], D = [-76.28612, 36.37018];   // loop, east side
const E = [-76.28600, 36.36975], F = [-76.28540, 36.36958];   // the middle cluster
const G = [-76.28575, 36.36905], H = [-76.28572, 36.36862];   // the front row

const plan = {
  centre: [-76.28638, 36.37140], bearing: 178, homeTurn: 34,
  padSpacing: 9.6, pairGap: 45, streetGap: 60,
  size: SINGLE_WIDE, naming: "lot", address: "1140 Northside Rd",
  rows: [
    { street: "Front",  side: "N", numbers: run(8, 1),   from: G, to: H },
    { street: "Middle", side: "N", numbers: run(9, 9),   from: E, to: F },
    { street: "Loop",   side: "N", numbers: run(21, 18), from: A, to: B },
    { street: "Loop",   side: "S", numbers: run(21, 39), from: C, to: D },
  ],
};

is("every row counts as placed", plan.rows.map(placed), [true, true, true, true]);

const homes = layOut(plan);
is("all 59 lots", homes.length, 59);
is("filed under the park's address", homes[0].filed, "1140 Northside Rd Lot 1");

// The ends are homes, not the gaps outside them.
const first = homes.find((h) => h.id === "Front|1");
const last = homes.find((h) => h.id === "Front|8");
if (metres([first.lng, first.lat], G) > 0.05) wrong.push("lot 1 is not on the first end");
else console.log(" ok  lot 1 sits exactly on the first end");
if (metres([last.lng, last.lat], H) > 0.05) wrong.push("lot 8 is not on the last end");
else console.log(" ok  lot 8 sits exactly on the last end");

// Each group keeps its own direction. The middle cluster runs east,
// the others run south; one bearing could never have said both.
const headOf = (id) => homes.find((h) => h.id === id).bearing;
const spread = new Set(plan.rows.map((r) => Math.round(headOf(`${r.street}|${r.numbers[0]}`))));
if (spread.size < 2) wrong.push("every row came out at the same angle, so the grid is still in charge");
else console.log(` ok  rows keep their own angles: ${[...spread].sort((a, b) => a - b).join("°, ")}°`);

// Spacing within a row is the row's own length over its gaps.
const along = (a, b, n) => metres(a, b) / (n - 1);
const got = metres([homes.find((h) => h.id === "Loop|18").lng, homes.find((h) => h.id === "Loop|18").lat],
                   [homes.find((h) => h.id === "Loop|19").lng, homes.find((h) => h.id === "Loop|19").lat]);
const want = along(A, B, 21);
if (Math.abs(got - want) > 0.05) wrong.push(`loop spacing ${got.toFixed(2)} m, should be ${want.toFixed(2)} m`);
else console.log(` ok  spacing is the row's own length over its gaps (${got.toFixed(2)} m)`);

// A park may mix the two kinds: changing the grid must not move a row
// that was placed by hand.
const moved = layOut({ ...plan, bearing: 12, padSpacing: 30, pairGap: 80 });
let worst = 0;
for (const h of homes) {
  const m = moved.find((x) => x.id === h.id);
  worst = Math.max(worst, metres([h.lng, h.lat], [m.lng, m.lat]));
}
if (worst > 0.01) wrong.push(`changing the grid moved a hand-placed row by ${worst.toFixed(2)} m`);
else console.log(" ok  changing the grid leaves hand-placed rows alone");

// And the angle of the homes is still the park's, because they are all
// the same model however the rows are arranged.
const turned = layOut({ ...plan, homeTurn: 0 });
const diff = Math.abs(turned.find((h) => h.id === "Front|1").bearing - headOf("Front|1"));
if (Math.abs(diff - 34) > 0.01) wrong.push(`homeTurn did not reach a hand-placed row (${diff})`);
else console.log(" ok  the angle of the homes still applies");

// One home in a row is a row, not a crash.
const lone = layOut({ ...plan, rows: [{ street: "X", side: "N", numbers: ["7"], from: G, to: H }] });
is("a row of one sits on its first end", lone.length, 1);
if (metres([lone[0].lng, lone[0].lat], G) > 0.05) wrong.push("the lone home is not on its end");
else console.log(" ok  and exactly on it");

// Half a pair of ends is not a placement.
is("one end alone is not placed", placed({ street: "X", side: "N", numbers: ["1"], from: G }), false);

if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
