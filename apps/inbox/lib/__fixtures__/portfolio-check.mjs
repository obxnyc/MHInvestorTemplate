/**
 * What the portfolio import is about to write, and what it must not.
 *
 *     node lib/__fixtures__/portfolio-check.mjs
 *
 * The real preview, read before anything was committed: 166 properties,
 * 243 units, 56 owners. Two things in it would have gone in wrong and
 * stayed wrong, and both were visible in the preview's own warnings
 * with nothing acting on them.
 *
 * SIXTY-SEVEN PROPERTIES WITH NO UNITS. For a single home that is Rent
 * Manager's modelling rather than a fact about the world -- somebody
 * lives at 472 Okisko Rd. It matters because everything that can be
 * DONE to a place hangs off its unit: a maintenance request is filed
 * against one, and `unitOfSingleHome` looks for exactly one and gives
 * up on none. A house with no unit can never be matched to the request
 * its own tenant submitted, however perfectly the address reads. Same
 * shape as the park whose features were keyed on what the tiles
 * carried -- the screen looks complete and nothing works.
 *
 * FOUR RECORDS NAMED AFTER COMPANIES. "Larabee Homes", "Dutch Doors",
 * "Musgrove Holdings LLC" are how the book is organised, not places.
 * The import already flagged them and created them anyway.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");
const raw = readFileSync(join(lib, "rm-import.ts"), "utf8");
writeFileSync(join(here, "rm-import.gen.mjs"), ts.transpileModule(
  raw.replace(/^import\b[\s\S]*?from\s*"[^"]*";/gm, ""),
  { compilerOptions: { target: 99, module: 99 } }).outputText);
const { isBookkeepingRecord, houseUnitLabel } =
  await import(join(here, "rm-import.gen.mjs"));

const checks = [];
const t = (name, fn, why) => {
  let ok = false, blew = null;
  try { ok = fn() === true; } catch (e) { blew = e.message; }
  checks.push([name, ok, blew ? `threw: ${blew}` : why]);
};

/* The company names are the real ones off the preview. */
const COMPANIES = new Set([
  "larabee homes", "dutch doors", "musgrove holdings llc",
  "pines mobile home park",
]);

/* ------------------------------------------------ a company is not a house */

t("a company record with nothing under it is not imported as a building",
  () => isBookkeepingRecord("Larabee Homes", COMPANIES, 0) === true,
  "it arrives as a house with no units, no address and no owner, and "
  + "counts towards every total for ever");

t("the same name WITH a unit under it is kept",
  () => isBookkeepingRecord("Larabee Homes", COMPANIES, 1) === false,
  "THE CASE A ONE-SIDED FIXTURE CANNOT ASK: a real house named after "
  + "the company that owns it has a tenant in it, and dropping it on "
  + "its name alone loses a building");

t("a building that is not a company is kept, units or none",
  () => isBookkeepingRecord("472 Okisko Rd", COMPANIES, 0) === false
     && isBookkeepingRecord("472 Okisko Rd", COMPANIES, 1) === false,
  "the no-units half must not be the whole test either -- 67 real "
  + "properties have no units and every one of them is a place");

t("the name is matched regardless of case or stray spacing",
  () => isBookkeepingRecord("  MUSGROVE HOLDINGS LLC ", COMPANIES, 0) === true);

/* ------------------------------------------- a house is its own unit */

t("a single home with no unit becomes one, named for its street",
  () => houseUnitLabel("sfh", 0, "472 Okisko Rd, Elizabeth City, NC 27909",
                       "472 Okisko Rd") === "472 Okisko Rd",
  "without a unit the house cannot be matched to its own tenant's "
  + "maintenance request");

t("the town is not part of the unit's name",
  () => !/Elizabeth/.test(
    houseUnitLabel("sfh", 0, "1002 Bartlett Ave, Elizabeth City, NC 27909",
                   "1002 Bartlett Ave") ?? "Elizabeth"));

t("a mobile home standing on its own gets one too",
  () => houseUnitLabel("mh", 0, "12 Pine Row, Ahoskie, NC", "12 Pine Row")
          === "12 Pine Row");

t("a house that already has a unit is left alone",
  () => houseUnitLabel("sfh", 1, "1002 Bartlett Ave", "1002 Bartlett Ave")
          === null,
  "inventing a second one means the house no longer holds exactly one, "
  + "and `unitOfSingleHome` stops matching it at all");

/* The kinds that must NOT get one. A park with no units has not been set
   up yet; inventing a dwelling there is a lie about the world, and it
   would land in the money dashboard as something lettable. */
t("a park with no units is not given an imaginary home",
  () => houseUnitLabel("mhp", 0, "1140 Northside Rd, Elizabeth City", "The Retreat")
          === null,
  "49 Cross Creek lots arrive with no units; one invented dwelling per "
  + "park is not the answer to that, naming the group is");

t("a block of flats with no units is not given one either",
  () => houseUnitLabel("multi", 0, "1142 Northside Rd", "1142 Northside Rd")
          === null
     && houseUnitLabel("duplex", 0, "601 W Church St", "601 W Church St")
          === null
     && houseUnitLabel("triplex", 0, "207 E Gallery Row", "207 E Gallery Row")
          === null,
  "which flat somebody lives in is not something to invent");

t("a house with no address at all still gets a usable name",
  () => houseUnitLabel("sfh", 0, null, "0000 Halstead Ext")
          === "0000 Halstead Ext",
  "17 properties have no address; a unit labelled with the empty string "
  + "is one nobody can find again");

/* --------------------------------------------------------- source rules */

/* The branch that writes the invented unit, cut out before matching.
 *
 * Anchored on the branch itself -- `if (houseLabel)` -- and not on the
 * line that computes the label, which moved above the preview row the
 * moment the preview had to agree with it, and took both of these
 * guards down with it. A guard that fails on a move is the same noise
 * as one that passes on a fault.
 *
 * Cut at the end of the branch, too: an anchor that runs on past its
 * own block matches whatever comes next, which has cost a round twice
 * in this codebase. */
const block = (() => {
  const i = raw.indexOf("if (houseLabel) {");
  if (i < 0) return "";
  const rest = raw.slice(i);
  // To the close of the branch: the first line at that indentation.
  const end = rest.indexOf("\n    }\n");
  return end < 0 ? rest : rest.slice(0, end);
})();

t("the branch that creates it can still be found",
  () => block.length > 0 && /\.from\("units"\)/.test(block),
  "every rule below reads this block, so an anchor that misses makes "
  + "all of them pass without checking anything");

t("the invented unit is never marked vacant",
  () => block.length > 0 && /is_vacant:\s*false/.test(block),
  "vacancy comes from Rent Manager's own list, and a phantom vacancy "
  + "goes straight into the money dashboard as a letting opportunity "
  + "that does not exist");

t("it is only created when the property truly has none, asked of the database",
  () => /\.from\("units"\)[\s\S]{0,200}count: "exact"[\s\S]{0,200}\.eq\("property_id"/
          .test(block)
     && block.indexOf("count: \"exact\"") < block.indexOf('.from("units").insert'),
  "an invented unit carries no rm_unit_id, so the next run recognises "
  + "nothing and gives the house a second one, then a third -- and the "
  + "import is pressed more than once by design");

/* ---------------------------------- a park that is already here
 *
 * The import made four parks into eight in one press. It asked "is
 * this group linked to a park?" and, finding no link, created one --
 * never asking whether that park was already in the database under
 * the same name. The duplicate carried the Rent Manager lots and the
 * original carried sixty homes placed by hand, so the one that looked
 * freshly correct was the one with no map on it.
 *
 * Nothing failed. Both records look like parks. Source rules, because
 * the lookup is a database read.
 */
const parks = (() => {
  const i = raw.indexOf("let parkId = g.propertyId;");
  if (i < 0) return "";
  const rest = raw.slice(i);
  const end = rest.indexOf("const vacant = vacantSet");
  return end < 0 ? rest.slice(0, 4000) : rest.slice(0, end);
})();

t("the park block can still be found",
  () => parks.length > 0 && /nextCode\("MHP"/.test(parks),
  "every rule below reads this block");

t("an unlinked group looks for the park before making one",
  () => /\.eq\("kind", "mhp"\)[\s\S]{0,120}\.eq\("name", name\)/.test(parks),
  "asking only whether the group is LINKED is the narrower question, "
  + "and it answers it by minting a second park");

/* THE ADOPTION BRANCH ALONE.
 *
 * Asked of the whole park block, this passed with the write deleted --
 * because there is a SECOND `rm_groups` update further down, the one
 * that runs after a park is created, and the pattern found that
 * instead. The anchor ran past the branch it was about, which is the
 * third time that exact mistake has been made in this codebase.
 *
 * Cut to the branch, then match inside it. */
const adopt = (() => {
  const i = parks.indexOf("if (already?.length === 1)");
  if (i < 0) return "";
  const rest = parks.slice(i);
  const end = rest.indexOf("} else if");
  return end < 0 ? rest : rest.slice(0, end);
})();

t("the branch that adopts an existing park can be found",
  () => adopt.length > 0 && /parkId = /.test(adopt),
  "without this the rule below passes by matching the wrong block");

t("adopting it writes the link, so it is only looked up once",
  () => /from\("rm_groups"\)[\s\S]{0,160}property_id: parkId/.test(adopt),
  "unwritten, every later import repeats the lookup -- and the moment "
  + "the name is edited it stops matching and mints a duplicate again");

t("two parks of one name is refused, not guessed between",
  () => /length\s*\?\?\s*0\)\s*>\s*1|length\s*>\s*1/.test(parks)
     && /continue;/.test(parks),
  "the same refusal matchPlace makes about two houses at one address");

t("the match is on the name, not on the hand-typed gate address",
  () => !/\.eq\("address"/.test(parks),
  "Cross Creek's gate address was wrong on the first attempt; matching "
  + "on a field somebody mistypes makes a typo mint a second park");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : `\nnothing obviously wrong (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
