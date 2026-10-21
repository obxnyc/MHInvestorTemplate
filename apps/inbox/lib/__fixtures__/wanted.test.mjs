/** What a caller said they wanted.  Run:  node lib/__fixtures__/wanted.test.mjs
 *
 *  The checks that matter here are not the ones that read a preference
 *  correctly -- they are the ones that REFUSE to. A number of children read as
 *  a number of bedrooms, or an assistance animal filed as a pet, puts a
 *  protected-class fact into a column this business segments on, and it does
 *  it silently and permanently. So each refusal is checked both ways: the
 *  field is empty, AND the screen is told why it is empty.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "wanted.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { readWanted, mergeWanted } = await import("data:text/javascript," + encodeURIComponent(js));

const TODAY = new Date(Date.UTC(2026, 9, 21));          // 21 October 2026
const PLACES = ["Fayetteville", "Raeford", "Elizabeth City", "Cross Creek", "Northside"];
const r = (text, o = {}) => readWanted(text, { places: PLACES, today: TODAY, ...o });
const why = (reading, field) =>
  (reading.declined.find((d) => d.field === field) ?? {}).because ?? "";

const checks = [];

/** A check may be a value or a thunk, and a thunk that throws is REPORTED
 *  rather than taken as the harness falling over.
 *
 *  Learnt twice now. A fault reintroduced into mergeWanted made a later
 *  assertion dereference a field that was no longer there, and the run died
 *  with a TypeError and a line number -- so the fault read as "the harness is
 *  broken" instead of naming the one check it had just defeated. The most
 *  important failure a harness can report is the one that stops it running.
 */
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

// ---- the five it is allowed to read ----
const plain = r("Hi, looking for a 3 bedroom under $900 in Raeford, we don't have pets, could move in June 1");
t("bedrooms", plain.wanted.bedroomsMin === 3);
t("ceiling", plain.wanted.priceCeiling === 900);
t("place", plain.wanted.area === "Raeford");
t("no pets is a stated no, not a blank", plain.wanted.hasPets === false);
t("move-in date", plain.wanted.moveInFrom === "2027-06-01");

t("it says which words it read the bedrooms out of",
  () => plain.read.bedroomsMin.from.toLowerCase() === "3 bedroom");
t("it says which words it read the ceiling out of",
  () => plain.read.priceCeiling.from.toLowerCase() === "under $900");

t("3/2 is three bedrooms", r("any 3/2 available").wanted.bedroomsMin === 3);
t("2 br", r("need a 2 br").wanted.bedroomsMin === 2);
t("a bare bedroom count with no slash still reads",
  r("4 bedrooms please").wanted.bedroomsMin === 4);

// ---- fair housing: the refusals ----
// This is the whole reason the file exists. Each of these must come back
// EMPTY, and each must say why, because a blank that looks like an oversight
// is a blank somebody helpfully fills in by hand.
const kids = r("me and my 3 kids need something by December");
t("a household size is not a bedroom count", kids.wanted.bedroomsMin === undefined);
t("and it says so", /not a number of bedrooms/.test(why(kids, "bedrooms_min")));
t("the rest of that message still reads", kids.wanted.moveInFrom === "2026-12-01");

const both = r("me and my 3 kids need a 3 bedroom");
t("a household sentence holds back the bedroom count even when it is also stated",
  both.wanted.bedroomsMin === undefined);

t("four of us is not four bedrooms",
  r("there are 4 of us looking").wanted.bedroomsMin === undefined);
t("two adults is not two bedrooms",
  r("2 adults, no pets").wanted.bedroomsMin === undefined);

const service = r("I have a service dog, looking for a 2 bedroom");
t("a service animal is not a pet", service.wanted.hasPets === undefined);
t("and it says why the field was left alone",
  /not a pet/.test(why(service, "has_pets")));
t("the bedrooms in that message still read", service.wanted.bedroomsMin === 2);
t("an emotional support animal is treated the same",
  r("my esa cat comes with me").wanted.hasPets === undefined);
// The two above pass even with the assistance rule removed, because the pet
// patterns happen not to match "service dog" or "esa cat" either. A guard
// standing behind a second guard is a guard nobody has tested -- so this one
// says it both ways at once, which is also how somebody really writes it.
const bothWays = r("I have a dog, she is a service dog");
t("a dog that is a service dog is not recorded as a pet",
  bothWays.wanted.hasPets === undefined);
t("and that is the assistance rule doing it, not a gap in the pet patterns",
  r("I have a dog").wanted.hasPets === true);

// ---- the money it must not read ----
t("a deposit is not a budget",
  r("what is the deposit? I can do $500 deposit").wanted.priceCeiling === undefined);
t("stated income is not a budget",
  r("I make $2,400 a month").wanted.priceCeiling === undefined);
t("an hourly wage is not a budget",
  r("I get $18 an hour").wanted.priceCeiling === undefined);
// $18 is below the hundred-dollar floor, so the line above is refused by the
// floor and never reaches the rate rule. A figure that clears the floor is
// what actually asks the question.
t("a weekly wage is not a budget either",
  r("we clear $600 a week between us").wanted.priceCeiling === undefined);
t("and a monthly figure that is not wages still reads",
  r("I can do $600 a month").wanted.priceCeiling === 600);
// "a week" and "an hour" are both in the not-a-budget words already, so the
// two lines above are refused by the sentence rule and the rate rule never
// gets asked. A yearly figure and a slashed rate are the cases only it
// catches -- and a yearly salary written into price_ceiling is the worst of
// the lot, because forty thousand passes every sanity bound there is.
t("a yearly salary is not a budget",
  r("$40,000 a year, looking for a 3 bed").wanted.priceCeiling === undefined);
t("a slashed weekly rate is not a budget",
  r("$650/wk coming in").wanted.priceCeiling === undefined);
t("but the bedrooms in that message still read",
  r("$40,000 a year, looking for a 3 bed").wanted.bedroomsMin === 3);
t("a budget stated in the same message as a deposit question still reads",
  r("Is there a deposit? My budget is $850.").wanted.priceCeiling === 850);
t("$900/mo is a ceiling", r("up to $900/mo").wanted.priceCeiling === 900);
t("a bare figure on its own is taken as the budget",
  r("looking for a 3 bed, $875").wanted.priceCeiling === 875);

// ---- pets ----
t("I have a dog", r("I have a dog").wanted.hasPets === true);
t("my two cats", r("my two cats are coming").wanted.hasPets === true);
t("asking whether pets are allowed states nothing",
  r("is it pet friendly?").wanted.hasPets === undefined);
t("no pets beats a later mention of a dog",
  r("no pets, my sister has a dog though").wanted.hasPets === false);

// ---- dates ----
t("asap is today", r("need it asap").wanted.moveInFrom === "2026-10-21");
t("a month already gone is next year's", r("moving in March").wanted.moveInFrom === "2027-03-01");
t("a month still to come is this year's", r("moving in December").wanted.moveInFrom === "2026-12-01");
t("11/15 is this year", r("moving 11/15").wanted.moveInFrom === "2026-11-15");
t("1/5 is next year", r("moving 1/5").wanted.moveInFrom === "2027-01-05");
t("next month", r("next month if possible").wanted.moveInFrom === "2026-11-01");
t("end of the month", r("end of the month").wanted.moveInFrom === "2026-10-31");
t("a slash pair that is really a date is not read as bed/bath",
  r("moving 11/15").wanted.bedroomsMin === undefined);
// 11/15 is also refused by the bathroom bound, so it never asks the real
// question. 3/1 is a believable bed/bath pair AND a believable date, and the
// only thing telling them apart is the word in front of it.
t("moving 3/1 is the first of March, not three bedrooms",
  r("moving 3/1").wanted.bedroomsMin === undefined);
t("and it is read as the date", r("moving 3/1").wanted.moveInFrom === "2027-03-01");
t("3/2 with no move-in word in front is still bed and bath",
  r("any 3/2 you have").wanted.bedroomsMin === 3);
// And the bathroom bound is what is left when there is no word in front at
// all. It has to be asked with a left-hand number small enough to be a
// bedroom count, or the bedroom bound answers first and the bathroom bound
// could be deleted without anything noticing: 11/15 fails on the eleven.
t("a bare 4/15 is the fifteenth of April, not fifteen bathrooms",
  r("4/15 works for me").wanted.bedroomsMin === undefined);
t("and it is read as the date", r("4/15 works for me").wanted.moveInFrom === "2027-04-15");

// ---- the place ----
t("a place off the list reads", r("anything in Fayetteville").wanted.area === "Fayetteville");
t("a place not on the list is not invented",
  r("anything in Durham").wanted.area === undefined);
t("two places named is a sentence, not a preference",
  r("I'm in Fayetteville now, want to get to Raeford").wanted.area === undefined);

// ---- nothing said ----
const empty = r("hi");
t("an empty reading states nothing", Object.keys(empty.wanted).length === 0);
t("and declines nothing either", empty.declined.length === 0);
t("no text at all does not throw", readWanted("").wanted !== undefined);
t("null text does not throw", readWanted(null).wanted !== undefined);

// ---- the merge: a second call must not empty the record ----
// The bug this exists for: somebody rings back to change the date and the
// three bedrooms they asked for on Monday quietly become null.
const first = r("3 bedroom under $900 in Raeford");
const kept = mergeWanted({ ...first.wanted, read: first.read }, r("actually make it December"));
t("a later message that says nothing about bedrooms keeps the bedrooms",
  kept.wanted.bedroomsMin === 3);
t("and keeps the ceiling", kept.wanted.priceCeiling === 900);
t("and keeps the place", kept.wanted.area === "Raeford");
t("and takes the new date", kept.wanted.moveInFrom === "2026-12-01");
t("the provenance follows the value it belongs to",
  () => kept.read.bedroomsMin.from.toLowerCase() === "3 bedroom"
  && /december/i.test(kept.read.moveInFrom.from));

const raised = mergeWanted({ ...first.wanted, read: first.read }, r("I could go up to $1,050"));
t("a new ceiling replaces the old one", raised.wanted.priceCeiling === 1050);

// A stated FALSE is a value and must survive the merge. `if (v)` would drop
// it, which would turn "we don't have pets" back into "nobody asked".
const noPets = mergeWanted({ bedroomsMin: 2 }, r("no pets"));
t("a stated no survives the merge", noPets.wanted.hasPets === false);

t("merging onto nothing is just the new reading",
  mergeWanted({}, first).wanted.bedroomsMin === 3);
t("the merged record carries no stray read key",
  mergeWanted({ ...first.wanted, read: first.read }, r("hi")).wanted.read === undefined);

// A check that throws is reported like any other failure, and says so.
t("a throwing check is named, not fatal", () => { throw new Error("on purpose"); });
if (checks.pop()[0] !== "a throwing check is named, not fatal") {
  console.log("FAIL  the harness does not catch a throwing check");
  process.exit(1);
}

let failed = 0;
for (const [n, ok, note] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${n}${note ? ` (${note})` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
