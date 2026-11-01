/**
 * The sale papers say what the generator says.
 *
 * The wording in `mobilehomedocumentgenerator.html` is the wording
 * somebody has already read with the job in mind. Porting it into the
 * app to fill it from the database is useful; quietly rewording a
 * sentence of it on the way is not, and is invisible -- a contract that
 * reads almost right reads right.
 *
 * So every fixed sentence in lib/papers.ts has to appear, character for
 * character, in the generator it came from. And the loan arithmetic has
 * to agree with the generator's, which is the other half of what is on
 * the page.
 *
 *     node lib/__fixtures__/papers-check.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(join(here, "papers.gen.mjs"), ts.transpileModule(
  readFileSync(join(here, "papers.ts"), "utf8"),
  { compilerOptions: { target: 99, module: 99 } }).outputText);
const P = await import(join(here, "papers.gen.mjs"));

/* THE WORDING IS THE OWNER'S DOCUMENTS NOW, not the generator at the repo
   root. He asked for this to live in the app rather than in an html thing,
   so `mobilehomedocumentgenerator.html` is no longer maintained and no
   longer the authority -- these two are, and they are what review reads.
   docs/papers/extract.mjs rewrites the .txt from the .docx he sent. */
const generator = readFileSync(
  join(here, "..", "..", "..", "mobilehomedocumentgenerator.html"), "utf8");

const PAPERS = join(here, "..", "..", "..", "docs", "papers");
const source = ["purchase-agreement-clean.txt", "land-lease-investor-clean.txt"]
  .map((f) => readFileSync(join(PAPERS, f), "utf8")).join("\n\n");

const checks = [];
const t = (name, ok, why) => checks.push([name, ok, why]);

// --- the wording -------------------------------------------------------
//
// Both files interpolate, so the comparison is on the prose BETWEEN the
// interpolations: every run of fixed text long enough to be a sentence
// has to be in the generator too.
const ours = readFileSync(join(here, "papers.ts"), "utf8");

/** The fixed runs of a template literal: what is left once every
 *  ${...} is cut out. Nested braces are counted, so a `${money(x)}`
 *  does not end the hole early. */
function fixedRuns(src) {
  const runs = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === "$" && src[i + 1] === "{") {
      let depth = 1; i += 2;
      while (i < src.length && depth) {
        if (src[i] === "{") depth += 1;
        else if (src[i] === "}") depth -= 1;
        i += 1;
      }
      runs.push("\u0000");
      continue;
    }
    runs.push(src[i]); i += 1;
  }
  return runs.join("").split("\u0000");
}

/** Prose only: anything that is a sentence rather than markup. */
const entities = (s) => s
  .replace(/&ldquo;/g, "\u201c").replace(/&rdquo;/g, "\u201d")
  .replace(/&lsquo;/g, "\u2018").replace(/&rsquo;/g, "\u2019")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function prose(src) {
  return fixedRuns(src)
    .flatMap((run) => run.split(/<[^>]*>/))
    .map((s) => entities(s).replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 40 && /[a-z]{3}/.test(s) && / /.test(s));
}

/* SUBSTRING, NOT SET MEMBERSHIP, and the reason matters. Against the
   generator both sides were template literals with the same holes, so a
   fixed run equalled a fixed run. The owner's documents are finished
   prose with the figures already filled in, so our run between two holes
   sits INSIDE one of their sentences rather than equalling it. Asking for
   equality there would fail on every interpolated clause and prove
   nothing about the rest. It still catches the thing it exists to catch:
   a sentence quietly reworded on the way into the app. */
const said = entities(source).replace(/\s+/g, " ").toLowerCase();

/** What is inside the backticks, and nothing else.
 *
 *  Run on the file as a whole this read the TypeScript as prose and
 *  reported that `export function amortization(...)` was missing from a
 *  contract -- true, and not what is being asked. The holes come out
 *  first, so no backtick can be hiding inside one. */
function documents(src) {
  const flat = src.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, "\u0000");
  return flat.split("`").filter((_, i) => i % 2 === 1).join("\u0000");
}
/* THE TWO CONTRACTS, and nothing else in the file.
   It used to start at `amortization`, which swept in the schedule table,
   its "Illustrative; assumes no prepayment" note and the notary block --
   none of which are in the owner's documents, because none of them are
   contract language. They are the app's own furniture and checking them
   against his wording reports three failures that mean nothing, which is
   how a real one gets missed. */
const between = (from, to) => ours.slice(ours.indexOf(from), ours.indexOf(to));
const docsOnly = documents(
  between("export function purchaseAgreement", "export const docKey"));
const mine = prose(docsOnly);

/* THE CASES HIS DOCUMENTS DO NOT COVER.
   Two sources, because the owner's clean documents describe one deal: a
   financed sale with a lien. The app still has to print a cash sale and a
   lease with annual escalation, and that wording is the generator's,
   which is reviewed prose even though it is no longer the authority.

   What is in neither is the app's own, and there are exactly two of them.
   They are listed rather than waved through, because a guard that accepts
   anything it cannot place is not a guard -- and each is checked to still
   be in use below, so the list cannot quietly rot into an excuse. */
const OURS = [
  // A cash sale: his agreement is financed throughout and has no such clause.
  "payable in full upon execution of this Agreement by certified funds",
  // The bill of sale where no lien was ever taken, so there is none to release.
  "Seller shall deliver to Purchaser a fully executed and notarized bill of sale",
];
const everywhere = (entities(source) + "\n" + entities(generator))
  .replace(/\s+/g, " ").toLowerCase();
const appsOwn = OURS.map((o) => o.replace(/\s+/g, " ").toLowerCase());

const drifted = mine.filter((s) => {
  const low = s.toLowerCase();
  return !everywhere.includes(low) && !appsOwn.some((o) => low.includes(o));
});
/* A listed exception that nothing uses any more is a hole left open. */
const unused = OURS.filter((o) => !mine.some(
  (m) => m.toLowerCase().includes(o.replace(/\s+/g, " ").toLowerCase())));
t(`every app-authored sentence listed is still used (${OURS.length})`,
  unused.length === 0, unused.map((u) => `  no longer printed: ${u}`).join("\n"));

t(`every sentence is the owner's own or the generator's (${mine.length} checked)`,
  drifted.length === 0,
  drifted.slice(0, 3).map((s) => `  not in the documents: ${s.slice(0, 110)}…`)
    .join("\n"));

// And the other way, so a clause cannot be dropped on the way across.
const clauses = [
  "W I T N E S S E T H",
  "Right of First Refusal",
  "Reserve Fund",
  "Renter Approval",
  "Security Interest",
  "Insurance &amp; Taxes",
  "Late Payment &amp; Default",
  "Annual Rent Escalation",
  "Monthly Consulting Fee",
  "Governing Law",
  "ACKNOWLEDGMENT",
];
const missing = clauses.filter((c) => !ours.includes(c));
t("no clause was dropped on the way across", missing.length === 0,
  `missing: ${missing.join(", ")}`);

// --- the arithmetic ----------------------------------------------------
{
  // $100,000, $30,000 down, 4.9% over 20 years -- the generator's own
  // placeholder numbers.
  //
  // Checked by paying the loan off rather than against a number typed
  // here. A figure written into a test is a figure somebody invented,
  // and the first one I wrote was thirty cents out; running the balance
  // down to zero is the thing the payment is actually FOR.
  const pay = P.payment(70000, 4.9, 20, 12);
  let bal = 70000;
  const r = 4.9 / 100 / 12;
  for (let k = 0; k < 240; k++) bal = bal + bal * r - pay;
  t(`240 payments of $${pay.toFixed(2)} clear $70,000 at 4.9% `
    + `(ends at $${bal.toFixed(2)})`,
    Math.abs(bal) < 0.01, `ends at ${bal.toFixed(2)}, not zero`);
  // And a cent either way would not: the test has to be tight enough
  // to notice.
  let off = 70000;
  for (let k = 0; k < 240; k++) off = off + off * r - (pay + 0.01);
  t("and a cent more a month would not", Math.abs(off) > 0.5);
  t("an interest-free balance divides evenly",
    Math.abs(P.payment(12000, 0, 10, 12) - 100) < 1e-9);

  /* EVERY TERM, NOT ONE TERM.
     These deals are written at whatever rate and length the parties agree,
     and the one case above -- 20 years at 4.9% -- cannot tell a formula
     that generalises from one that happens to land on that pair. A dozen
     of them, including 0%, a short term and a long one, and each has to
     pay the balance off to the cent.

     This is the arithmetic the CONTRACT prints: the installment figure in
     clause (b) and every row of Schedule A come from it, so a rounding
     that drifts here is a contract that never quite clears. */
  const money0Left = [];
  for (const yrs of [3, 5, 10, 15, 20, 30]) {
    for (const apr of [0, 3.75, 4.9, 5.2, 7.25]) {
      for (const bal of [8500, 62140, 150000]) {
        const pm = P.payment(bal, apr, yrs, 12);
        const r = apr / 100 / 12, n = yrs * 12;
        let b = bal;
        for (let k = 0; k < n; k++) b = b + b * r - pm;
        /* Tolerance scales with the balance, not an absolute cent: the
           payment is rounded to the cent when printed but carried at full
           precision here, and 360 of those add up on a six-figure loan. */
        if (Math.abs(b) > Math.max(0.01, bal * 1e-9)) {
          money0Left.push(`${yrs}yr ${apr}% $${bal} ends at ${b.toFixed(2)}`);
        }
      }
    }
  }
  t(`every term and rate pays the balance off (${6 * 5 * 3} combinations)`,
    money0Left.length === 0, money0Left.slice(0, 3).join("; "));

  /* THE SENTENCE AND THE SCHEDULE HAVE TO AGREE. Clause (b) states a
     number of installments in words and figures; Schedule A prints the
     rows. A term change that moved one and not the other would be a
     contract disagreeing with its own attachment. */
  const sentenceWrong = [];
  for (const yrs of [5, 15, 30]) {
    const terms = { ...P.DEFAULTS, financed: true, amortize: true,
      ratePct: 5.2, termYears: yrs, perYear: 12, agreedOn: "2026-07-27",
      amortDetail: "monthly" };
    const html = P.purchaseAgreement(terms,
      { lot: "1", describedAs: "A home", price: 95600, down: 33460 });
    const flat = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const n = yrs * 12;
    if (!flat.includes(`(${n}) consecutive monthly installments`)) {
      sentenceWrong.push(`${yrs}yr: sentence does not say ${n}`);
    }
    if (!flat.includes(`(${yrs}) year term`)) {
      sentenceWrong.push(`${yrs}yr: sentence does not say a ${yrs} year term`);
    }
    // One row per payment, plus the totals row.
    const rows = (html.match(/<tr>/g) ?? []).length - 2;
    if (rows !== n) sentenceWrong.push(`${yrs}yr: ${rows} rows for ${n} payments`);
    // And the last payment lands on the Maturity Date the clause names.
    const sch = P.schedule(terms);
    if (!flat.includes(P.plainDate(sch.maturity))) {
      sentenceWrong.push(`${yrs}yr: maturity ${sch.maturity} not printed`);
    }
  }
  t("the installment count, the term, Schedule A and the Maturity Date agree",
    sentenceWrong.length === 0, sentenceWrong.slice(0, 3).join("; "));
}
t("five hundred is Five Hundred", P.words(500) === "Five Hundred");
t("and reads as dollars", P.dollarsWords(500) === "Five Hundred Dollars");
t("one is a Dollar, not Dollars", P.dollarsWords(1) === "One Dollar");
t("a price in words carries its thousands",
  P.words(95600) === "Ninety-Five Thousand Six Hundred");
t("a date reads the way a contract reads one",
  P.longDate("2026-08-03") === "3rd day of August, 2026");
t("the eleventh is not the eleven-st", P.longDate("2026-08-11") === "11th day of August, 2026");
t("and an empty date leaves a line", P.longDate("") === "________________");

// --- the pack ----------------------------------------------------------
{
  const terms = { ...P.DEFAULTS, buyer: "Colgate Trust", agreedOn: "2026-10-12",
                  leaseFrom: "2026-10-12", ratePct: 4.9 };
  const homes = Array.from({ length: 8 }, (_, i) => ({
    lot: String(i + 1),
    describedAs: `Clayton TruHome 3bd/2ba Serial# CWP0592${55 + i}TNAC`,
    price: 95600, down: 20000,
  }));
  const html = P.pack(terms, homes);
  const agreements = html.split("PURCHASE AGREEMENT</h2>").length - 1;
  const leases = html.split("MOBILE HOME PARK LAND LEASE AGREEMENT</h2>").length - 1;
  t("eight homes make eight purchase agreements", agreements === 8);
  t("and eight leases", leases === 8);
  t("each starting on its own page",
    html.split('class="pagebreak"').length - 1 === 15,
    `${html.split('class="pagebreak"').length - 1} breaks between 16 documents`);
  t("every lot number appears in its own lease",
    homes.every((h) => html.includes(`identified as Lot <span class="fill">${h.lot}</span>`)));
  t("the buyer is named on every one",
    html.split("Colgate Trust").length - 1 >= 16);
  t("purchase only leaves the leases out",
    !P.pack(terms, homes, "purchase").includes("LAND LEASE AGREEMENT"));
  t("lease only leaves the agreements out",
    !P.pack(terms, homes, "lease").includes("PURCHASE AGREEMENT"));

  // A name with an ampersand in it is a name, not markup.
  const risky = P.pack({ ...terms, buyer: 'Smith & Sons <Trust>' }, [homes[0]]);
  t("a name with an ampersand in it does not become markup",
    risky.includes("Smith &amp; Sons &lt;Trust&gt;")
    && !risky.includes("<Trust>"));
}

{
  // A cash sale says so, and says nothing about installments.
  const terms = { ...P.DEFAULTS, buyer: "Colgate Trust", financed: false };
  const html = P.purchaseAgreement(terms, { lot: "1", describedAs: "A home", price: 40000, down: 0 });
  /* His documents only describe a financed sale, so the cash sentence is
     the app's own. The rule is the same -- it has to say the thing is paid
     for -- but the words are the ones actually written. */
  t("a cash sale is paid in full",
    html.includes("payable in full upon execution"));
  t("and says no financing is extended",
    html.includes("no financing is extended by Seller"));
  t("and carries no amortization schedule", !html.includes("Schedule A"));
  t("and no late-payment clause, which is about a loan",
    !html.includes("Late Payment"));
  t("and no security interest, which is also about a loan",
    !html.includes("Security Interest"));
}

// --- the header the browser prints ------------------------------------
//
// A contract headed with a file path out of somebody's Downloads folder
// does not look like a contract. It is the browser's doing and there is
// no CSS for it: the one trick that works, `@page{margin:0}`, also takes
// the top and bottom margin off every continuation page -- measured at
// 14 pages with the margin against 10 without, which is a two-page
// agreement whose second page starts at the paper's edge.
//
// So the page may not try it, and both the app and the generator have to
// name the document, because a title is what the header shows beside the
// address.
const screen = readFileSync(join(here, "../components/OwnerScreen.tsx"), "utf8");
const css = readFileSync(join(here, "..", "app", "globals.css"), "utf8");

t("the printed page keeps its margins on every page",
  /@page\{size:letter;margin:0\.8in\}/.test(css)
  && !/@page\s*\{[^}]*margin:\s*0[;}]/.test(css),
  "A zero page margin hides the browser's header and takes the top and "
  + "bottom margin off every page after the first with it.");

t("the app names the document it is printing",
  /document\.title = `\$\{what\} — \$\{terms\.buyer \|\| owner\.name\}`;/.test(screen),
  "The header shows the page title beside the address, and `Owner` is "
  + "no better than a file path.");

t("and puts the old title back when the papers close",
  /return \(\) => \{ document\.title = was; \};/.test(screen));

/* The generator is no longer where the wording comes from -- the owner
   asked for this to live in the app rather than an html thing -- but the
   file is still there and still printed from, so what it does with the
   print header is still worth holding. It gets its own read: pointing
   these at `source` made them assertions about his contracts, which say
   nothing about a print dialog, and they failed for that reason alone. */
t("the generator names it too",
  /document\.title = \(docMode==='purchase' \? 'Purchase Agreement'/.test(generator),
  "It is still the thing being printed from.");

t("and says where the header comes from",
  /Headers and footers/.test(generator)
  && /your browser, not the\s*\n?\s*document/.test(generator),
  "Somebody looking at a file path on a contract needs to be told it is "
  + "the print dialog, not something wrong with the document.");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(why ? `${why}` : ""); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : "\nnothing obviously wrong");
process.exit(failed ? 1 : 0);
