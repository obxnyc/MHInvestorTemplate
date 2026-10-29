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

const source = readFileSync(
  join(here, "..", "..", "..", "mobilehomedocumentgenerator.html"), "utf8");

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
function prose(src) {
  return fixedRuns(src)
    .flatMap((run) => run.split(/<[^>]*>/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 40 && /[a-z]{3}/.test(s) && / /.test(s));
}

const theirs = prose(source);
const said = new Set(theirs.map((s) => s.toLowerCase()));

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
// Only the document functions, not the comments explaining them.
const docsOnly = documents(ours.slice(ours.indexOf("export function amortization")));
const mine = prose(docsOnly);

const drifted = mine.filter((s) => !said.has(s.toLowerCase()));
t(`every sentence is the generator's own (${mine.length} checked)`,
  drifted.length === 0,
  drifted.slice(0, 3).map((s) => `  not in the generator: ${s.slice(0, 110)}…`)
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
  t("a cash sale is paid in full", html.includes("payment in full"));
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

t("the generator names it too",
  /document\.title = \(docMode==='purchase' \? 'Purchase Agreement'/.test(source),
  "It is still the thing being printed from.");

t("and says where the header comes from",
  /Headers and footers/.test(source)
  && /your browser, not the\s*\n?\s*document/.test(source),
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
