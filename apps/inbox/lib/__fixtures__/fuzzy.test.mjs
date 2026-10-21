/** Finding a thing you cannot spell.  Run: node lib/__fixtures__/fuzzy.test.mjs
 *
 *  The checks that matter are the ORDERINGS. Any matcher finds "Cross Creek"
 *  for "cross creek"; the question is whether it still puts it first when a
 *  typo rule is loose enough to be useful, and whether a long name can
 *  absorb a query that has nothing to do with it.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "fuzzy.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { score, rank, didYouMean, editsWithin, slack } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

// The real list, near enough: parks, lots, people, pages.
const THINGS = [
  { item: "park:retreat", text: "The Retreat" },
  { item: "park:cross", text: "Cross Creek Mobile Home Park" },
  { item: "park:northside", text: "1140 Northside Road Mobile Home Community" },
  { item: "park:crescent", text: "Crescent Ridge" },
  { item: "lot:3114", text: "3114", also: ["The Retreat"] },
  { item: "lot:51", text: "51", also: ["1140 Northside Road Mobile Home Community"] },
  { item: "owner:colgate", text: "Colgate Trust" },
  { item: "person:alex", text: "Alex Prieto" },
  { item: "page:timesheets", text: "Timesheets", also: ["hours", "payroll", "clock"] },
  { item: "page:leasing", text: "Looking for a home", also: ["leasing", "vacant", "empty"] },
];
const top = (q) => rank(q, THINGS)[0]?.item;
const ids = (q) => rank(q, THINGS).map((h) => h.item);

// ---- the plain cases ----
t("an exact name", () => top("The Retreat") === "park:retreat");
t("a prefix", () => top("cross") === "park:cross");
t("a word in the middle", () => top("northside") === "park:northside");
t("a lot number", () => top("3114") === "lot:3114");
t("a page by its own name", () => top("timesheets") === "page:timesheets");
t("a page by a word somebody would actually type",
  () => top("payroll") === "page:timesheets");
t("and another", () => top("vacant") === "page:leasing");

// ---- typos, which is the whole point ----
t("northsde", () => top("northsde") === "park:northside");
t("retreet", () => top("retreet") === "park:retreat");
t("colgte", () => top("colgate trust") === "owner:colgate" && top("colgte") === "owner:colgate");
// Two words each one edit out. Word-by-word scoring never joins these up,
// which is why the phrase rule exists.
t("cross crk", () => top("cross crk") === "park:cross");
t("timesheat", () => top("timesheat") === "page:timesheets");

// Abbreviations are their own mistake: letters deliberately left out, three
// or four edits away, which no slack reaches without joining everything.
t("nthsd finds Northside", () => top("nthsd") === "park:northside");
// "xrthsd" shares no letters with "northside" in any useful way, so it is
// refused whether or not the first-letter rule is there -- the fault was a
// no-op. "orthsd" IS a subsequence of "northside"; only the first letter
// separates them.
t("but only sharing the first letter -- nobody abbreviates by changing it",
  () => score("orthsd", "Northside") === null);
t("while the same letters with the right first one do match",
  () => score("nrthsd", "Northside") !== null);
// "cr" is a PREFIX of "Crescent", so it never reaches the abbreviation rule
// and the floor was untested. In "Cumberland" it is a subsequence and
// nothing else: not a prefix, not a substring, not the initials.
t("and only from three letters up, since two in order are in every word",
  () => score("cr", "Cumberland") === null);
t("three of them is a believable abbreviation",
  () => score("cmb", "Cumberland") !== null);
t("an abbreviation ranks below a real typo", () => {
  const abbrev = score("crk", "creek");
  const typo = score("creeek", "creek");
  return abbrev.score < typo.score;
});
// A phrase is as good as its WEAKER half. Taking the better one would make
// "cross crk" -- an abbreviation -- rank level with a one-letter slip.
t("a phrase scores on its worst part, not its best", () => {
  const withAbbrev = score("cross crk", "Cross Creek");
  const withTypo = score("cros creek", "Cross Creek");
  return withAbbrev.score < withTypo.score;
});

t("teh finds the, because a transposition is one slip and not two",
  () => editsWithin("teh", "the", 1) === 1);
t("recieve finds receive", () => editsWithin("recieve", "receive", 1) === 1);
// "corss" swaps two ADJACENT letters, which is what a transposition is.
// "ceerk" moves a letter three places and is two edits however you count --
// the first version of this check used that and failed for the right reason.
t("and a transposition inside a real name works",
  () => top("Corss Creek") === "park:cross");

// ---- the ordering, which is where a loose matcher goes wrong ----
// "cross" is a prefix of one and three edits from the other. A single score
// tuned for typos puts Crescent above Cross Creek; tiers cannot.
// Crescent Ridge does not match "cross" at ALL, so the previous version of
// this asked nothing: both orderings passed. Asked instead with two things
// that genuinely both match, one by prefix and one by typo.
t("a prefix beats a typo", () => {
  const two = [
    { item: "typo", text: "Creek Lane" },            // one edit from "creak"
    { item: "prefix", text: "Creakside Park" },      // starts with "creak"
  ];
  const r = rank("creak", two);
  return r[0].item === "prefix" && r[0].how === "prefix"
      && r[1].item === "typo" && r[1].how === "typo";
});
t("an exact name beats a longer one containing it", () => {
  const r = rank("The Retreat", THINGS);
  return r[0].item === "park:retreat" && r[0].how === "exact";
});
// An alias is a weaker way to be found than your own name. Asked where the
// alias matches EXACTLY and so would otherwise tie -- the previous version
// of this check had the alias matching nothing at all, so the penalty was
// never consulted. The aliased one is first in the list, so a tie would
// leave it first and the check would pass for the wrong reason.
t("a thing found by its own name beats one found by an identical alias", () => {
  const two = [
    { item: "page:timesheets", text: "Timesheets", also: ["hours", "payroll"] },
    { item: "report:hours", text: "Hours" },
  ];
  return rank("hours", two)[0].item === "report:hours";
});
t("a thing found by its own name beats one found by an alias", () => {
  const r = ids("51");
  return r[0] === "lot:51";
});

// ---- a long name must not absorb an unrelated query ----
// Measured against the whole string, "1140 Northside Road Mobile Home
// Community" has enough characters to be a couple of edits from anything.
t("a long park name does not match an unrelated word",
  () => score("timesheet", "1140 Northside Road Mobile Home Community") === null);
t("nor does it match a short number it does not contain",
  () => score("9999", "1140 Northside Road Mobile Home Community") === null);
t("something genuinely unrelated matches nothing at all",
  () => rank("aubergine", THINGS).length === 0);

// ---- initials ----
t("ccmhp finds Cross Creek Mobile Home Park", () => top("ccmhp") === "park:cross");
// A single letter can only be the first initial of a name that starts with
// it, and the prefix tier catches that first -- so this reads as a check on
// the two-letter floor and is not one. Left as what it actually asserts:
// a single letter lands in the tier it belongs to.
t("a single letter is a prefix, not an initials match",
  () => score("c", "Cross Creek Mobile Home Park").how === "prefix");

// ---- the edit distance itself ----
t("identical is nought", () => editsWithin("abc", "abc", 2) === 0);
t("one substitution", () => editsWithin("abc", "abd", 2) === 1);
t("one insertion", () => editsWithin("abc", "abxc", 2) === 1);
t("one deletion", () => editsWithin("abc", "ac", 2) === 1);
t("over the ceiling is no answer", () => editsWithin("abc", "xyz", 2) === null);
t("a length gap over the ceiling exits early",
  () => editsWithin("a", "abcdefgh", 2) === null);
// A short word has no room to be wrong: "lot" and "lit" are both words.
t("a three letter word gets no slack", () => slack(3) === 0);
t("a five letter word gets one", () => slack(5) === 1);
t("a long word gets two", () => slack(12) === 2);
t("which means 'lot' does not match 'lit'",
  () => score("lot", "lit") === null);

// ---- did you mean ----
t("nothing matched, but something is close",
  () => didYouMean("northsde", THINGS) === "1140 Northside Road Mobile Home Community");
t("two letters is too little to guess from", () => didYouMean("xy", THINGS) === null);
t("and gibberish gets no guess", () => didYouMean("qqqqqqq", THINGS) === null);

// ---- punctuation, case and accents ----
t("case does not matter", () => top("CROSS CREEK MOBILE HOME PARK") === "park:cross");
t("punctuation does not matter", () => top("cross-creek") === "park:cross");
t("extra spaces do not matter", () => top("  cross   creek  ") === "park:cross");

// ---- nothing in, nothing out ----
t("an empty query matches nothing", () => rank("", THINGS).length === 0);
t("a blank query matches nothing", () => rank("   ", THINGS).length === 0);
t("an empty list is not a throw", () => rank("cross", []).length === 0);
t("scoring against an empty string is null", () => score("cross", "") === null);

t("the list is capped", () => rank("e", THINGS, 3).length <= 3);

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
