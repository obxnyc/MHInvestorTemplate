/** Reading the place out of a Tenant Web Access subject.
 *
 *  Both cases here are real, taken off the owner's own screen, and they look
 *  nothing alike:
 *
 *    114 Lisas Way, 114 Lisas Way
 *    1140 Northside #51, 1140 Northside Rd, Lot #51
 *
 *  A single house whose property and unit carry the same name, and a park
 *  with a lot number and a street address. Splitting on a comma and taking
 *  the first part gets one of them right and the other wrong, which is the
 *  shape of mistake that files a request against the wrong home.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const { readHint, placeKey } = await import("data:text/javascript," +
  encodeURIComponent(ts.transpileModule(
    readFileSync(join(here, "..", "alias.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText));

const said = [];
const t = (name, fn) => {
  try { said.push([name, Boolean(fn())]); }
  catch (e) { said.push([name, false, String(e.message ?? e).slice(0, 120)]); }
};

/* ------------------------------------------------------- the single house */

const house = readHint("114 Lisas Way, 114 Lisas Way");
t("a house named twice is one property", () => house.property === "114 Lisas Way");
t("and has no lot number, because it has no lots", () => house.lot === null);
t("its street address is read as one", () => house.address === "114 Lisas Way");

/* THE REPEAT IS THE POINT. Rent Manager names the property and the unit, and
   on a single house they are the same string. Two aliases for one house is
   two chances to file the next request in the wrong place. */
t("the repeat collapses, so one house needs one alias", () =>
  placeKey("114 Lisas Way, 114 Lisas Way") === placeKey("114 Lisas Way"));

/* ----------------------------------------------------------- the park lot */

const lot = readHint("1140 Northside #51, 1140 Northside Rd, Lot #51");
t("a park lot names the park without the lot marking stuck to it",
  () => lot.property === "1140 Northside");
t("the lot number comes out on its own", () => lot.lot === "51");
t("and the park's street address is kept apart from its name",
  () => lot.address === "1140 Northside Rd");

/* The pair that makes the one above mean something: the address must not be
   taken from the first part, which on a park is the park's name. */
t("the park's name is not mistaken for its address",
  () => lot.address !== "1140 Northside" && lot.address !== "1140 Northside #51");

/* --------------------------------------------- the ways people write a lot */

t("Lot 7 with no hash", () => readHint("Cross Creek, Lot 7").lot === "7");
t("#7 with no word", () => readHint("Cross Creek #7").lot === "7");
t("a lot with a letter on it", () => readHint("Cross Creek, Lot 12B").lot === "12B");
t("and a park with no lot at all says so", () =>
  readHint("Cross Creek Estates").lot === null);

/* ------------------------------------------------------------- the key */

t("case and punctuation do not make a different place", () =>
  placeKey("114 LISAS WAY,  114 Lisas Way.") === placeKey("114 lisas way"));
t("two different places are two different keys", () =>
  placeKey("114 Lisas Way") !== placeKey("115 Lisas Way"));
/* A near-repeat is NOT a repeat: "Lot 1, Lot 2" is two different lots and
   collapsing it would file the second against the first. */
t("a near-repeat is left alone", () =>
  placeKey("Lot 1, Lot 2") === "lot 1 lot 2");

t("nothing in, nothing out", () =>
  placeKey("") === "" && readHint(null).property === null);

for (const [name, ok, why] of said) {
  if (ok) console.log(` ok ${name}`);
  else console.error(` ✗ ${name}${why ? ` -- ${why}` : ""}`);
}
if (said.some(([, ok]) => !ok)) process.exit(1);
console.log("a subject line says which property and which lot");
