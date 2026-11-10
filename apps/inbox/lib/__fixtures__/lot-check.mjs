/**
 * Finding the lot a Tenant Web Access request is about.
 *
 *     node lib/__fixtures__/lot-check.mjs
 *
 * The subject line below is real, off the email that brought Tiffany
 * Jernigan's request, and the labels are the real ones out of the
 * database. It arrived naming her, her number and her lot, and filed
 * against nothing.
 *
 * TWO FAULTS STACKED, and either alone was enough.
 *
 * `lotDigits` took the FIRST lot marker. Rent Manager's property is
 * named "1140 Northside #46" and the unit is Lot #45 -- the numbers
 * genuinely differ -- so the lot read as 46.
 *
 * And the unit lookup compared EVERY DIGIT of the label against it:
 * "1140 Northside Rd, Lot #45" became "114045", tested against "45".
 * No lot in any park could ever match. 310 requests, every one of
 * them, with the address in the subject line that delivered it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");
const strip = (f) => readFileSync(join(lib, f), "utf8")
  .replace(/^import\b[\s\S]*?from\s*"[^"]*";/gm, "");
const tsc = (s) => ts.transpileModule(s,
  { compilerOptions: { target: 99, module: 99 } }).outputText;

writeFileSync(join(here, "placematch.gen.mjs"), tsc(strip("placematch.ts")));
writeFileSync(join(here, "alias.gen.mjs"), tsc(strip("alias.ts")));
/* Only the two readers out of `jobs.ts`, cut at their own boundaries.
   A first attempt truncated the file at `urgencyFromText` -- which sits
   ABOVE `lotDigits`, so it took away the very function under test and
   every check threw instead of failing. A harness that dies reads as a
   harness that is broken. */
const jobs = strip("jobs.ts");
const cut = (name) => {
  const i = jobs.indexOf(`export function ${name}(`);
  if (i < 0) throw new Error(`jobs.ts no longer exports ${name}`);
  const rest = jobs.slice(i);
  const end = rest.indexOf("\n}\n");
  return end < 0 ? rest : rest.slice(0, end + 3);
};
writeFileSync(join(here, "jobs.gen.mjs"),
  tsc([cut("lotDigits"), cut("propertyHint")].join("\n\n")));

const { unitKey, addressKey } = await import(join(here, "placematch.gen.mjs"));
const { readHint } = await import(join(here, "alias.gen.mjs"));
const { lotDigits } = await import(join(here, "jobs.gen.mjs"));

const checks = [];
const t = (name, fn, why) => {
  let ok = false, blew = null;
  try { ok = fn() === true; } catch (e) { blew = e.message; }
  checks.push([name, ok, blew ? `threw: ${blew}` : why]);
};

/* The real labels, out of the database. Three shapes, all live. */
const LOTS = [
  // The Retreat: the whole address, with the lot on the end.
  "1140 Northside Rd", "1140 Northside Rd, Lot #02",
  "1140 Northside Rd, Lot #04", "1140 Northside Rd, Lot #45",
  "1140 Northside Rd, Lot #46",
  /* TWO STREETS, ONE LOT NUMBER, both real in this park. Without this
     row, dropping the street from the key changes no answer -- every
     numbered lot in the fixture was on one street, so "lot 45" named
     exactly one thing and the fault was a no-op. */
  "1142 Northside Rd, Lot #04", "1142 Northside Rd, Lot #45",
  // Cross Creek: the lot IS the address, no number to find.
  "3100 Lady Viola Dr", "3104 Lady Viola Dr", "3100 Lady Cheryl Dr",
  // Pines: likewise.
  "102 Evergreen St", "103 Evergreen St",
];

/** What the lookup does: both sides into one shape, then compare. */
const find = (subject) => {
  const said = readHint(subject);
  const want = unitKey(said.address ?? said.property ?? subject, said.lot);
  if (!want) return [];
  return LOTS.filter((l) => unitKey(l, lotDigits(l)) === want);
};

/* --------------------------------------------- Tiffany Jernigan's request */

const REAL = "1140 Northside #46, 1140 Northside Rd, Lot #45";

t("the lot is read off the END of the subject, not the property's name",
  () => lotDigits(REAL) === "45",
  "'1140 Northside #46' is what Rent Manager calls the PROPERTY and "
  + "'Lot #45' is the unit; taking the first match reads 46 and files "
  + "the request against the wrong home");

t("her request finds exactly one lot",
  () => { const got = find(REAL);
          return got.length === 1 && got[0] === "1140 Northside Rd, Lot #45"; },
  "THE ONE THAT MATTERS: it arrived with her name, her number and her "
  + "lot, and filed against nothing");

t("and not the lot whose number is in the property's name",
  () => find(REAL)[0] !== "1140 Northside Rd, Lot #46",
  "46 and 45 are both real lots in this park, which is exactly why "
  + "reading the wrong one is not a harmless mistake");

/* ------------------------------------------------ the three label shapes */

t("a lot written as an address plus a number",
  () => { const got = find("1140 Northside #04, 1140 Northside Rd, Lot #04");
          return got.length === 1 && got[0] === "1140 Northside Rd, Lot #04"; });

t("the street decides between two parks' lot 04",
  () => find("1142 Northside #04, 1142 Northside Rd, Lot #04")[0]
          === "1142 Northside Rd, Lot #04",
  "1140 and 1142 Northside both have a Lot #04 and a Lot #45; on the "
  + "number alone they are the same lot, and they are different homes");

t("and between two parks' lot 45 -- hers",
  () => find(REAL)[0] === "1140 Northside Rd, Lot #45"
     && find(REAL).length === 1,
  "with the street dropped, Tiffany's request matches two lots and is "
  + "refused -- which is the old behaviour wearing a new coat");

t("a leading zero is not a different lot",
  () => find("1140 Northside, 1140 Northside Rd, Lot 4")[0]
          === "1140 Northside Rd, Lot #04",
  "'Lot #04' and 'Lot 4' are one lot; compared as text they are two");

t("a park whose lots are labelled by street address",
  () => { const got = find("3104 Lady Viola Dr, 3104 Lady Viola Dr");
          return got.length === 1 && got[0] === "3104 Lady Viola Dr"; },
  "Cross Creek has no lot numbers at all -- the address is the lot, "
  + "and a rule that needs a '#' finds nothing here");

t("the same street, a different number, is a different lot",
  () => find("3100 Lady Viola Dr, 3100 Lady Viola Dr")[0] === "3100 Lady Viola Dr");

t("two streets in one park do not collide on the house number",
  () => find("3100 Lady Cheryl Dr, 3100 Lady Cheryl Dr")[0]
          === "3100 Lady Cheryl Dr",
  "3100 Lady Viola and 3100 Lady Cheryl are both lot 3100 by digits "
  + "alone, and they are different homes");

t("the third shape, Pines",
  () => find("103 Evergreen St, 103 Evergreen St")[0] === "103 Evergreen St");

/* ------------------------------------------------------ refusing to guess */

t("a lot we do not hold matches nothing",
  () => find("1140 Northside #99, 1140 Northside Rd, Lot #99").length === 0,
  "filing against the wrong lot is worse than filing against none");

t("the park's own address, with no lot, is not one of its lots",
  () => { const got = find("1140 Northside Rd, 1140 Northside Rd");
          return got.length === 1 && got[0] === "1140 Northside Rd"; });

/* ----------------------------------------------------------- the key itself */

t("Ave and Avenue are the same lot's street",
  () => unitKey("12 Park Ave", "3") === unitKey("12 Park Avenue", "3"));

t("the lot number is part of the key, not decoration",
  () => unitKey("1140 Northside Rd", "45") !== unitKey("1140 Northside Rd", "46"));

t("no street is no key, rather than a key matching everything",
  () => unitKey("", "45") === "" && unitKey(null, null) === "",
  "an empty key that compared equal would file every request against "
  + "whichever lot was first in the list");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : `\nnothing obviously wrong (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
