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

const { pack, DEFAULTS, TEMPLATES, templateOf } = await load("lib/papers.ts");

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

// ---- the line that says which home ------------------------------------

const { homeSentence } = await load("lib/describe.ts");
const recorded = {
  homeYear: 2021, homeMake: "Clayton", homeSerial: "CLW0214NC",
  lot: "3124", parkName: "The Retreat",
  parkAddress: "3100 Lady Viola Dr, Fayetteville NC",
};
const said = homeSentence(recorded);
t("the home is identified by year, make and serial",
  () => said.includes("2021") && said.includes("Clayton")
     && said.includes("Serial# CLW0214NC"));
t("and by where it stands, which is the half that was missing",
  () => said.includes("Lot 3124") && said.includes("The Retreat")
     && said.includes("3100 Lady Viola Dr"));
// A home nobody recorded a make for still has to say where it is, and a
// home whose park is unknown still has to say what it is -- a fixture
// with every field filled cannot tell those two apart.
t("a home with no make still says where it stands",
  () => homeSentence({ ...recorded, homeYear: null, homeMake: null,
                       homeSerial: null }).startsWith("situated on Lot 3124"));
t("and a home with no park still says what it is",
  () => homeSentence({ ...recorded, lot: "", parkName: "", parkAddress: null })
        === "2021 Clayton Serial# CLW0214NC");

// ---- the three templates ---------------------------------------------
//
// Two of them have to produce DIFFERENT documents or the picker is a row
// of buttons that does nothing, and a fixture that cannot say which
// document it is looking at cannot tell you that.

const tpl = (key) => {
  const found = TEMPLATES.find((x) => x.key === key);
  return { ...deal, ...(found ? found.changes : {}) };
};
const house = pack(tpl("house"), typedIn, "both");
const investor = pack(tpl("investor"), typedIn, "both");

t("there are three templates", () => TEMPLATES.length === 3);
t("the house template carries the annual escalation",
  () => /Annual Rent Escalation/.test(house));
t("and the investor-friendly one does not",
  () => !/Annual Rent Escalation/.test(investor));
t("the house template keeps a lien until the home is paid for",
  () => /Security Interest\./.test(house));
t("and the investor-friendly one does not",
  () => !/Security Interest\./.test(investor));
t("the house template charges a late fee",
  () => /Late Payment/.test(house));
t("and the investor-friendly one does not",
  () => !/Late Payment/.test(investor));
// Not merely "investor-friendly has fewer clauses": both insure the home,
// so the difference is the three above and not a blanket subtraction.
t("both of them insure the home",
  () => /Insurance &amp; Taxes/.test(house) && /Insurance &amp; Taxes/.test(investor));
t("and they give different notice periods",
  () => tpl("house").noticeDays !== tpl("investor").noticeDays
     && house.includes(`${tpl("house").noticeDays} days`)
     && investor.includes(`${tpl("investor").noticeDays} days`));

/* A TEMPLATE MAY NOT TOUCH THE MONEY. The figures on a deal are typed in
   every time, and a template that quietly moved a rate or a lot rent
   would be a template that changed the price of the home. */
const MONEY_KEYS = ["ratePct", "termYears", "perYear", "lotRent", "consulting",
  "reserve", "lateFee", "escalatePct"];
t("no template changes a figure except the escalation per cent", () =>
  TEMPLATES.every((x) => Object.keys(x.changes).every(
    (k) => !MONEY_KEYS.includes(k) || k === "escalatePct")));

t("the screen can tell which template is showing",
  () => templateOf(tpl("house")) === "house"
     && templateOf(tpl("investor")) === "investor");
t("and calls it custom once a switch is moved by hand",
  () => templateOf({ ...tpl("house"), security: false }) === "custom");

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

/* The two buttons that hand over a file. `window.print()` used to be one
   of them and is gone: the browser's print dialog writes the date and
   this page's address into the margin of every page and no stylesheet
   can reach it, so a document that gets recorded cannot come from it. */
const fileBtn = (label) => {
  const at = live.indexOf(label);
  if (at < 0) return null;
  const open = live.lastIndexOf("<button", at);
  return open < 0 ? null : live.slice(open, at);
};
t("the browser's print dialog is not offered for a document",
  () => !/window\.print\(\)/.test(live));
for (const [label, call] of [["Download Word", "saveWord"],
                             ["Download PDF", "savePdf"]]) {
  const btn = fileBtn(label);
  t(`the ${label} button is there`, () => btn != null && btn.includes(call));
  t(`${label} reads the drawn list, not the recorded one`,
    () => btn != null && drawn != null && btn.includes(drawn));
  t(`${label} refuses while a typed-in home has no price`,
    () => btn != null && /notReady\.length\s*>\s*0/.test(btn));
}

const drawnOut = (() => {
  const at = live.indexOf("dangerouslySetInnerHTML");
  if (at < 0) return null;
  const open = live.lastIndexOf("{", live.lastIndexOf("&&", at));
  return open < 0 ? null : live.slice(open, at);
})();
t("the papers that appear on screen are the drawn list too",
  () => drawnOut != null && drawn != null && drawnOut.includes(drawn));

// The thing that makes a home typed in by hand possible at all.
// ---- what was typed is still there tomorrow ---------------------------
//
// "I changed these items and when the page reloads it goes away." Eight
// homes' worth of figures, switches and descriptions is an afternoon, and
// it lived in a browser tab.

t("there is a Save for the deal",
  () => /keepDeal/.test(live) && /method: "PUT"/.test(live));

/* NOTHING IS MARKED SAVED UNTIL THE SERVER SAYS SO, which is the rule
   that makes the Saved line worth reading. Asked by position inside the
   handler rather than by pattern: a regex for "sets the mark after the
   answer" matches none of the ways that can be written. */
t("the mark is not set before the answer has been read", () => {
  const at = live.indexOf("const keepDeal");
  if (at < 0) return false;
  const block = live.slice(at, at + 1400);
  const sent = block.indexOf("await fetch");
  const marked = block.indexOf("setBaseline(");
  return sent >= 0 && marked > sent;
});
/* And it marks the text that was SENT, not whatever is on screen by the
   time the answer comes back -- otherwise a keystroke during the round
   trip is quietly reported as saved. */
t("and it marks what was sent, not what is on screen now", () => {
  const at = live.indexOf("const keepDeal");
  const block = live.slice(at, at + 1400);
  return /const body = dealText;/.test(block)
    && /setBaseline\(body\)/.test(block);
});
t("a failed save says so and offers to try again",
  () => /setSaveSaid\(/.test(live) && /Try again/.test(live));
/* The migration not having run is not the same as nothing being saved,
   and a screen that cannot tell them apart says "Saved" into a table
   that is not there. */
t("and the screen can tell a missing table from an empty one",
  () => /canKeep/.test(live) && /046/.test(live));
/* The draft has to be read before the recorded sales seed the screen, or
   the seed races it and the afternoon is overwritten by the database. */
t("the draft is read before anything is seeded from the sales", () => {
  const at = live.indexOf("if (seeded ||");
  return at > 0 && /!draftRead/.test(live.slice(at, at + 120));
});

t("the template picker is on the screen",
  () => /TEMPLATES\.map/.test(live) && /templateOf\(terms\)/.test(live));
/* TWO PLACES, ASKED SEPARATELY. The box has to show what was typed and
   the papers have to read it, and `saidAs` appearing once anywhere in the
   file satisfies a rule that only greps for the name -- so taking the
   binding off the box passed while the box was showing the default and
   ignoring every edit. */
t("the box shows what was typed into it", () => {
  const at = live.indexOf("Home on lot");
  if (at < 0) return false;
  const open = live.lastIndexOf("<input", at);
  return open >= 0 && live.slice(open, at).includes("saidAs[h.saleId]");
});
t("and the papers are drawn from it", () => {
  // Inside the mapping over the ticked sales, not the first `describedAs:`
  // in the file -- which is the type declaration for a home typed by hand.
  const at = live.indexOf("chosen.map(");
  if (at < 0) return false;
  const said = live.indexOf("describedAs:", at);
  return said >= 0 && live.slice(said, said + 120).includes("saidAs[h.saleId]");
});
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
