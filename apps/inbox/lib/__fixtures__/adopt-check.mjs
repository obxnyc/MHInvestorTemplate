/**
 * A park recognising itself by its lot labels.
 *
 * Cross Creek was laid out before a park could have a plan of its own:
 * its arrangement lived in the code. Giving every park its own plan
 * turned that park into a park with no plan -- fifty one lots on file,
 * an hour of somebody's dragging saved against them, and a blank map,
 * because the thing that drew it had been taken away and nothing had
 * been put in its place. That is the regression this guards.
 *
 * The danger on the other side is the one that cost three rounds
 * already: a park claiming to be a park it is not. So the test is both
 * ways round.
 *
 *     node lib/__fixtures__/adopt-check.mjs
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
const { RETREAT, builtInFor, layOut, filedAs } = await import(join(here, "parkplan.gen.mjs"));

const wrong = [];
const is = (name, got, want) => {
  const ok = got === want;
  if (!ok) wrong.push(`${name}: got ${got}, wanted ${want}`);
  else console.log(` ok  ${name}`);
};

const real = layOut(RETREAT).map((h) => h.filed);
console.log(`the built-in park has ${real.length} lots, e.g. ${real[0]}`);

// --- it must recognise itself ---
is("its own labels are recognised", builtInFor(real) === RETREAT, true);
is("in any order", builtInFor([...real].reverse()) === RETREAT, true);
is("shouting is still its name",
   builtInFor(real.map((l) => l.toUpperCase())) === RETREAT, true);
is("and doubled spaces",
   builtInFor(real.map((l) => l.replace(" ", "  "))) === RETREAT, true);
// A park half entered is still that park.
is("with only two thirds on file yet",
   builtInFor(real.slice(0, Math.ceil(real.length * 0.67))) === RETREAT, true);

// --- and nothing else ---
is("Northside's lots are not it",
   builtInFor(Array.from({ length: 59 }, (_, i) => `1140 Northside Rd Lot ${i + 1}`)), null);
is("bare numbers are not it",
   builtInFor(real.map((l) => l.split(" ")[0])), null);
is("an empty park is not it", builtInFor([]), null);
is("one lot is not an identification", builtInFor([real[0]]), null);
is("four of its lots is not either", builtInFor(real.slice(0, 4)), null);
// The trap: somebody's park that happens to share a few numbers.
is("a handful of matches among many strangers",
   builtInFor([...real.slice(0, 6),
               ...Array.from({ length: 60 }, (_, i) => `${i} Some Other Rd`)]), null);
// And a park that is mostly this one but tiny -- half of Cross Creek's
// lots have to be present, or a five-lot park of coincidences wins.
is("five of its labels alone is not it", builtInFor(real.slice(0, 5)), null);

// --- the labels it matches are the ones actually stored ---
// If these ever drift apart the recognition silently stops working and
// the map goes blank again, which is exactly how this happened.
is("it matches the name a lot is filed under",
   real[0], filedAs(RETREAT, RETREAT.rows[0].numbers[0], RETREAT.rows[0].street));

if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
