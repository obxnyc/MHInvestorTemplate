/**
 * Which house a Tenant Web Access subject is talking about.
 *
 *     node lib/__fixtures__/placematch-check.mjs
 *
 * Three hundred and six maintenance requests are filed against nothing,
 * and the portfolio that would give them somewhere to go is about to be
 * imported. The comparison waiting for them was `===` on the whole
 * normalised string, between an address stored with its town --
 * "1002 Bartlett Ave, Elizabeth City, NC 27909" -- and a subject line
 * carrying the street alone. Those are never equal. Every single-family
 * house would have failed to match, every time, with the address in
 * plain sight on both sides.
 *
 * It looked like it worked because a PARK's name happens to be exactly
 * what the subject says. Houses were the case nobody had.
 *
 * THE FIXTURE IS BUILT TO TELL WRONG ANSWERS APART. Two houses on one
 * street, two houses sharing a number on different streets, and two
 * properties holding the identical address. With one house of each kind
 * a rule that ignores the number and a rule that uses it give the same
 * answer, and the check proves nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");
const raw = readFileSync(join(lib, "placematch.ts"), "utf8");
writeFileSync(join(here, "placematch.gen.mjs"), ts.transpileModule(
  raw.replace(/^import\b[\s\S]*?from\s*"[^"]*";/gm, ""),
  { compilerOptions: { target: 99, module: 99 } }).outputText);
const { matchPlace, addressKey, streetLine, streetName, houseNumber } =
  await import(join(here, "placematch.gen.mjs"));

const checks = [];
const t = (name, fn, why) => {
  let ok = false, blew = null;
  try { ok = fn() === true; } catch (e) { blew = e.message; }
  checks.push([name, ok, blew ? `threw: ${blew}` : why]);
};

/* The portfolio, shaped like the real one about to arrive: addresses
   carrying their town, because that is how the import writes them. */
const PLACES = [
  { id: "bartlett-1002", name: "1002 Bartlett Ave",
    address: "1002 Bartlett Ave, Elizabeth City, NC 27909" },
  // SAME STREET, different number. Without this, "did it use the number"
  // cannot be asked.
  { id: "bartlett-1004", name: "1004 Bartlett Ave",
    address: "1004 Bartlett Ave, Elizabeth City, NC 27909" },
  // SAME NUMBER, different street. Without this, "did it use the street"
  // cannot be asked either.
  { id: "lisas-1002", name: "1002 Lisas Way",
    address: "1002 Lisas Way, Elizabeth City, NC 27909" },
  { id: "lisas-114", name: "114 Lisas Way",
    address: "114 Lisas Way, Elizabeth City, NC 27909" },
  // A compass word, spelled short on one side and long on the other.
  { id: "main-n-210", name: "210 N Main St",
    address: "210 North Main Street, Hertford, NC 27944" },
  // A park, which is matched on its NAME -- the only case that worked
  // before, and so the one most easily broken by fixing the others.
  { id: "northside", name: "1140 Northside",
    address: "1140 Northside Rd, Elizabeth City, NC 27909" },
  // Two properties holding one address. Somebody has to fix that in the
  // data, and cannot if nothing says which two.
  // Two real, different streets that differ only by their type. The loose
  // rule cannot tell them apart and must say so rather than pick.
  { id: "park-ave-12", name: "12 Park Ave",
    address: "12 Park Ave, Hertford, NC 27944" },
  { id: "park-rd-12", name: "12 Park Rd",
    address: "12 Park Rd, Hertford, NC 27944" },
  /* A property with NO house number on it -- a named building rather
     than an address. This is the only shape that can ask whether the
     number-and-street rule really requires a number: everywhere else the
     stored side HAS a number, so comparing it against a missing one is
     already false and the guard is never reached. Without this row,
     deleting that guard changes nothing and the check passes on the
     fault. */
  { id: "riverside", name: "Riverside Rentals",
    address: "Riverside Dr, Edenton, NC 27932" },
  { id: "twin-a", name: "7 Duke St", address: "7 Duke St, Edenton, NC 27932" },
  { id: "twin-b", name: "Duke Street Rental",
    address: "7 Duke Street, Edenton, NC 27932" },
];

const got = (said) => matchPlace(said, PLACES);

/* ------------------------------------------------- the bug this is for */

t("the town on the end does not stop a house matching",
  () => got("1002 Bartlett Ave").id === "bartlett-1002",
  "THE WHOLE BUG: the stored address carries ', Elizabeth City, NC 27909' "
  + "and the subject does not, so `===` could never be true");

t("a subject that names the place twice still matches",
  () => got("114 Lisas Way, 114 Lisas Way").id === "lisas-114",
  "Rent Manager titles a house's property and its unit the same, so the "
  + "subject says it twice -- this is the real shape of a house request");

/* ------------------------------------------- the same words, spelled differently */

t("Ave and Avenue are one street",
  () => got("1002 Bartlett Avenue").id === "bartlett-1002");

t("N and North are one street",
  () => got("210 N Main St").id === "main-n-210",
  "stored as 'North Main Street', asked as '210 N Main St'");

t("St and Street are one street",
  () => got("210 North Main St").id === "main-n-210");

/* ---------------------------------------------- the number and the street
 *
 * These are the two that a one-house fixture cannot ask. With only
 * 1002 Bartlett on file, a rule reading just the number and a rule
 * reading just the street both return it, and both look correct.
 */

t("the house number picks between two houses on one street",
  () => got("1004 Bartlett Ave").id === "bartlett-1004",
  "1002 and 1004 Bartlett are both on file; ignoring the number returns "
  + "whichever is first and is right half the time");

t("the street picks between two houses sharing a number",
  () => got("1002 Lisas Way").id === "lisas-1002",
  "1002 Bartlett and 1002 Lisas are both on file; ignoring the street "
  + "sends somebody to the wrong road");

t("a street with no number matches nothing",
  () => got("Bartlett Ave").found === false,
  "'Bartlett Ave' fits every house on Bartlett -- answering with one of "
  + "them is a work order at a stranger's door");

t("a number with no street matches nothing",
  () => got("1002").found === false);

/* A DIFFERENT STREET OF THE SAME NAME, where neither side has a number.
 *
 * "Riverside Dr" is on file as a named building with no house number.
 * Asked for "Riverside Road" -- a different street -- the strict key
 * says no, and the loose rule is the only one left. It compares house
 * numbers, and here BOTH are missing, so they agree; the street names
 * agree too once the types are dropped. Only the rule that insists on
 * an actual number refuses this.
 *
 * Everywhere else in this fixture the stored side has a number, so
 * comparing it against a missing one is already false and that rule is
 * never reached -- deleting it changed nothing and every check still
 * passed. A fault that is a no-op proves nothing. */
t("a street with no number does not match a different street of that name",
  () => got("Riverside Road").found === false,
  "both sides are missing a house number, so 'no number' agrees with "
  + "'no number' and Riverside Road is matched to Riverside Drive -- a "
  + "real street somewhere else in town");

t("but the building is still found when its own street is named",
  () => got("Riverside Dr").id === "riverside",
  "refusing the ambiguous case must not cost the exact one");

/* ------------------------------------------------------- the park still works */

t("a park is still matched by its name",
  () => got("1140 Northside").id === "northside",
  "the only case that worked before the fix, and the one most easily "
  + "broken by it");

t("a park's own street address matches it too",
  () => got("1140 Northside Rd").id === "northside");

/* ------------------------------------------------------- refusing to guess */

t("two properties holding one address is refused, not picked",
  () => got("7 Duke St").found === false,
  "'7 Duke St' and '7 Duke Street, Duke Street Rental' are the same "
  + "place entered twice; choosing either is a coin toss");

t("and it says which two, so somebody can fix the data",
  () => { const m = got("7 Duke St");
          return m.tied.length === 2
            && m.tied.includes("twin-a") && m.tied.includes("twin-b"); },
  "a refusal nobody can act on is the same as no answer");

t("a tie is not broken by falling through to a vaguer rule",
  () => got("7 Duke Street").found === false,
  "the looser number-and-street rule must not resolve what the exact "
  + "address rule could not -- that is the wrong way round");

t("an address we do not hold matches nothing",
  () => got("9 Nowhere Lane, Raleigh, NC").found === false);

t("nothing said is nothing matched",
  () => got("").found === false && got(null).found === false);

/* --------------------------------------------------------- the pieces */

t("the town is taken off by position, not by recognising town names",
  () => streetLine("1002 Bartlett Ave, Elizabeth City, NC 27909")
          === "1002 Bartlett Ave",
  "there is no list of town names, and inventing one is how a street "
  + "called Lane stops being a street");

t("a flat number is not part of the street address",
  () => addressKey("1002 Bartlett Ave Apt B") === addressKey("1002 Bartlett Ave"),
  "which flat it is belongs to the lot, not to the street");

/* THE STREET TYPE, and a correction to an earlier version of this check.
 *
 * It first asked this of `streetName`, which drops the type on purpose:
 * that function is the LOOSE half, used only alongside the house number,
 * so that "1002 Bartlett" can find "1002 Bartlett Ave". Asserting it
 * there was asking the wrong function and would have been answered by
 * weakening the thing it is for.
 *
 * The question that matters is what happens to two real streets that
 * differ only by type. The strict key must keep them apart, and the
 * loose rule -- which cannot tell them apart -- must refuse rather than
 * pick one.
 */
t("the strict key keeps Park Avenue and Park Road apart",
  () => addressKey("12 Park Ave") !== addressKey("12 Park Rd"));

t("asked for the one without a type, it refuses rather than choosing",
  () => got("12 Park").found === false,
  "12 Park Ave and 12 Park Rd are both on file and 'Park' alone cannot "
  + "tell them apart -- a guess here sends somebody to the wrong street");

t("but each of them is found when it is named in full",
  () => got("12 Park Ave").id === "park-ave-12"
     && got("12 Park Rd").id === "park-rd-12",
  "refusing the ambiguous case must not cost the unambiguous ones");

t("the house number is not read as part of the street's name",
  () => streetName("1002 Bartlett Ave") === "bartlett");

/* ------------------------------- two found only by running it for real
 *
 * Both of these came out of pointing this at the 118 properties that
 * actually imported, with the subject lines Rent Manager actually
 * sends. Neither case existed in anything written above, which is the
 * lesson: a fixture is a guess about the world until the world has
 * been through it.
 */

t("a lot number written with a hash is not left on the street",
  () => addressKey("1140 Northside #51") === addressKey("1140 Northside"),
  "THE `#` NEVER FIRED. It sat inside the same \\b(?:...) group as the "
  + "words apt/unit/lot, and \\b before # needs a word character right "
  + "before it -- which 'Northside #51' has not got, there is a space. "
  + "So the park at 1140 Northside Rd did not match its own lot");

t("the same lot written the other ways is stripped too",
  () => addressKey("1140 Northside Lot 51") === addressKey("1140 Northside")
     && addressKey("1140 Northside Unit 51") === addressKey("1140 Northside")
     && addressKey("1140 Northside Apt 51") === addressKey("1140 Northside"),
  "the hash needed its own alternative outside the word boundary, and "
  + "the words must still work after moving it");

/* A STORED ADDRESS WITH NO COMMA BEFORE THE TOWN.
 *
 * The park addresses were typed by hand into the group boxes as
 * "1140 Northside Rd Elizabeth City, NC 27909" -- no comma after Rd.
 * Cut at the first comma, the street reads "1140 Northside Rd
 * Elizabeth City", which matches nothing.
 *
 * It is recorded here rather than worked around. Loosening the match to
 * cope would mean accepting a street that merely STARTS with the right
 * words, and that is the safety property this whole file exists for.
 * The fix was the three addresses. This is the check that says so if
 * anybody types one that way again. */
t("an address missing its comma before the town will not match, and that is known",
  () => matchPlace("1140 Northside Rd", [
          { id: "nocomma", name: "The Retreat",
            address: "1140 Northside Rd Elizabeth City, NC 27909" },
        ]).found === false,
  "documented, not fixed: the answer is a comma in the data, because "
  + "the looser rule that would catch it also matches the wrong street");

t("and with the comma it matches",
  () => matchPlace("1140 Northside Rd", [
          { id: "ok", name: "The Retreat",
            address: "1140 Northside Rd, Elizabeth City, NC 27909" },
        ]).id === "ok");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : `\nnothing obviously wrong (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
