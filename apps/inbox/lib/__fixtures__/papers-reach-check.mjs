/**
 * The papers have to be reachable, and they must not wait on the sale.
 *
 * `papers-check.mjs` already proves the documents read the way the
 * generator's do. This one is about the other half, which is the half
 * that was broken: an investor's papers could only be opened by walking
 * to a park, finding a lot with a sale already recorded on it, and
 * clicking the name on that card. So the purchase agreement -- the paper
 * that MAKES the sale -- could not be drawn until the sale it makes was
 * already in the database.
 *
 *     node lib/__fixtures__/papers-reach-check.mjs
 *
 * The arithmetic half runs the real `pack` over a home nobody recorded.
 * The rest are rules about the screen, which no type and no picture can
 * see: a button that is disabled is a feature that does not exist, and
 * it looks exactly like a feature that does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const load = async (p) => {
  const js = ts.transpileModule(read(p), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};

const results = [];
const t = (name, run) => {
  let ok = false, why = null;
  try { ok = run() === true; } catch (e) { why = String(e && e.message || e); }
  results.push([name, ok, why]);
};

const { pack, DEFAULTS } = await load("lib/papers.ts");

// ---- a deal with nothing recorded against it -------------------------

const deal = {
  ...DEFAULTS,
  buyer: "Oak Ridge Holdings LLC",
  parkName: "the Retreat",
  agreedOn: "2026-03-04",
  leaseFrom: "2026-03-04",
  financed: true, ratePct: 7.5, termYears: 15,
};
const typedIn = [{
  lot: "3124",
  describedAs: "2021 Clayton 16x76, 3/2, Serial# CLW0214NC",
  price: 48500, down: 9700,
}];
const papers = pack(deal, typedIn, "both");

t("a home nobody recorded still makes a purchase agreement",
  () => /PURCHASE AGREEMENT/.test(papers));
t("and its park land lease", () => /LAND LEASE/i.test(papers));
t("the lot it names is the lot that was typed in",
  () => papers.includes("3124"));
t("so is the home", () => papers.includes("CLW0214NC"));
t("and the buyer", () => papers.includes("Oak Ridge Holdings LLC"));
t("the down payment is the one typed in", () => papers.includes("9,700"));

// A fixture that cannot tell the two answers apart is not asking the
// question: two homes on the deal must give twice the documents, so a
// screen that silently drew only the first would fail here.
const two = pack(deal, [typedIn[0], { ...typedIn[0], lot: "3126" }], "both");
t("two homes typed in make two agreements, not one",
  // The heading, not the words: the first line of the agreement reads
  // "THIS PURCHASE AGREEMENT, made this the ...", so counting the phrase
  // counts twice per document and would have said four either way.
  () => (two.match(/<h2>PURCHASE AGREEMENT<\/h2>/g) ?? []).length === 2);
t("and two leases, one per lot",
  () => two.includes("3124") && two.includes("3126"));

// ---- one deal, two parks ---------------------------------------------
//
// An investor taking four homes at one park and one at another is one
// deal with one rate and one set of dates, and five leases. The park is
// the one thing on a lease that is not the deal's, so each lease has to
// name its own. A fixture with both homes in the same park cannot tell
// the override from the deal's own name.

const across = pack(
  { ...deal, parkName: "the Retreat" },
  [{ ...typedIn[0], lot: "3124" },
   { ...typedIn[0], lot: "17", parkName: "1140 Northside Road" }],
  "lease");
const leases = across.split("<h2>").slice(1);
t("a deal across two parks still makes two leases", () => leases.length === 2);
t("the first lease names the deal's park",
  () => leases[0].includes("the Retreat")
     && !leases[0].includes("1140 Northside Road"));
t("and the second names its own",
  () => leases[1].includes("1140 Northside Road")
     && !leases[1].includes("the Retreat"));

// ---- rules about the screen ------------------------------------------

const screen = read("components/OwnerScreen.tsx");
const header = read("components/AppHeader.tsx");
const index = read("app/(app)/owners/page.tsx");

/** The source with comments taken out. A rule that matches its own
 *  explanation is a rule that passes when the code is deleted. */
const bare = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
const live = bare(screen);

/** The name the screen gives the list of homes it actually draws, read
 *  out of its own declaration rather than written in here -- a guard
 *  that names a thing breaks when the thing is renamed, which is the
 *  same noise as a guard that passes on a fault. */
const drawn = (live.match(/const\s+(\w+)\s*=\s*useMemo<Home\[\]>/) ?? [])[1];
t("the screen declares one list of homes to draw", () => Boolean(drawn));

/** Cut a block out before matching inside it: an anchor with a bounded
 *  wildcard runs on past its own block and matches the next one. */
const blockAfter = (src, from) => {
  const at = src.indexOf(from);
  if (at < 0) return null;
  let depth = 0, started = false;
  for (let i = at; i < src.length; i++) {
    if (src[i] === "<") { depth++; started = true; }
    else if (src[i] === ">") { depth--; if (started && depth <= 0) {
      // ...to the end of the element, which for a button is its close tag.
      const close = src.indexOf("</button>", i);
      return src.slice(at, close < 0 ? i : close);
    } }
  }
  return null;
};

const salePapers = blockAfter(live, "<button type=\"button\" className={papers ?");
t("the Sale papers button is in the source", () => Boolean(salePapers));
t("and it is never disabled",
  () => salePapers != null && !/disabled/.test(salePapers));

const printBtn = (() => {
  const at = live.indexOf("window.print()");
  if (at < 0) return null;
  const open = live.lastIndexOf("<button", at);
  return open < 0 ? null : live.slice(open, at);
})();
t("the print button reads the drawn list, not the recorded one",
  () => printBtn != null && drawn != null && printBtn.includes(drawn));
t("and refuses while a typed-in home has no price",
  () => printBtn != null && /notReady\.length\s*>\s*0/.test(printBtn));

const drawnOut = (() => {
  const at = live.indexOf("dangerouslySetInnerHTML");
  if (at < 0) return null;
  const open = live.lastIndexOf("{", live.lastIndexOf("&&", at));
  return open < 0 ? null : live.slice(open, at);
})();
t("the papers that appear on screen are the drawn list too",
  () => drawnOut != null && drawn != null && drawnOut.includes(drawn));

// The thing that makes a home typed in by hand possible at all.
t("the screen says when the ticked homes are not one deal",
  () => /spread\.length\s*>\s*1/.test(live));
t("there is a way to add a home by hand",
  () => /Add a home/.test(live) && /setByHand\(\(was\) => \[\.\.\.was, blank\(\)\]\)/.test(live));
t("a cleared price is not read as zero",
  () => /price:\s*string/.test(live));

// Reachable: a page nobody can navigate to is a page that does not exist.
t("the nav offers the investors", () => /\["\/owners",/.test(bare(header)));
t("and there is a page at that address", () => /OwnersBoard/.test(index));
// Anchored on the redirect's own condition, not on the word appearing
// somewhere in the file: gutting the test to `false` leaves the import
// line behind, and a rule that greps the file passes on it.
t("which only the office may open", () => {
  const at = bare(index).indexOf("redirect(");
  if (at < 0) return false;
  const open = bare(index).lastIndexOf("if (", at);
  return open >= 0 && bare(index).slice(open, at).includes("canSeeOffice(");
});

// ---- say it ----------------------------------------------------------

let bad = 0;
for (const [name, ok, why] of results) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${results.length}`); process.exit(1); }
console.log("the papers are reachable and do not wait on the sale");
