/** A lot filed under the parcel next door.
 *  Run: node lib/__fixtures__/strays.test.mjs
 *
 *  1140 Northside and 1148 Northside are two parks side by side, and one of
 *  1148's lots sits in 1140's group in Rent Manager. Once imported that is
 *  invisible -- the lot is simply in the wrong park and stays there -- so
 *  the detector has to be right about both halves: catching the stray, and
 *  staying quiet about a park addressed by its own internal streets. */
import { readFileSync } from "fs";
import ts from "typescript";
const src = readFileSync(new URL("../rm-import.ts", import.meta.url), "utf8");
const fn = src.slice(src.indexOf("function strays("), src.indexOf("\n}\n", src.indexOf("function strays(")) + 3);
const js = ts.transpileModule("export " + fn, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { strays } = await import("data:text/javascript," + encodeURIComponent(js));

const lot = (id, name) => ({ PropertyID: id, Name: name });
const checks = [];
const t = (n, got, want) => checks.push([n, JSON.stringify(got) === JSON.stringify(want), got, want]);

// The real case: The Retreat, 1140, with one 1148 lot in it.
const retreat = [
  ...Array.from({ length: 63 }, (_, i) => lot(i + 1, `1140 Northside Rd, Lot #${i + 1}`)),
  lot(999, "1148 Northside Rd, Lot #1A"),
];
const found = strays(retreat);
t("finds the one lot from next door", [...found.keys()], [999]);
t("and says why", found.get(999),
  "addressed 1148 but filed in a park whose other 63 lots are 1140");

// A park addressed by its own internal streets has no majority and no strays.
const pamalee = [
  lot(1, "12 Lady Cheryl Dr"), lot(2, "14 Lady Cheryl Dr"),
  lot(3, "3 Lady Viola Ln"), lot(4, "5 Lady Viola Ln"),
];
t("internal street names raise nothing", strays(pamalee).size, 0);

// A clean park raises nothing.
t("a tidy park raises nothing",
  strays(Array.from({ length: 20 }, (_, i) => lot(i, `1148 Northside Rd${i}`))).size, 0);

// Lots with no leading number at all.
t("unnumbered lots raise nothing",
  strays([lot(1, "Unit A"), lot(2, "Unit B")]).size, 0);

let bad = 0;
for (const [name, ok, got, want] of checks) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}
console.log(bad ? `\n${bad} failed` : `\n${checks.length} passed`);
process.exit(bad ? 1 : 0);
