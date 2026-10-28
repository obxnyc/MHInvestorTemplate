/**
 * The Word file, opened and read.
 *
 * "If you record a legal document you don't have website urls and dates at
 * the top of pages." Quite right, and the browser's print dialog puts them
 * there unless somebody clears a tick box -- which is not reachable from
 * CSS, by design. So the file has to be one we write.
 *
 *     node lib/__fixtures__/word-check.mjs
 *
 * A .docx is a zip of XML, so this builds one and reads `document.xml`
 * back out of it. No browser: `docparse.ts` is a tokenizer rather than a
 * DOM parser for exactly this reason, and `docx` writes the same file in
 * Node that it writes in a tab.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

/* Transpiled to real files inside the project rather than loaded from
   data: URLs, because `worddoc.ts` imports `docx` from node_modules and a
   bare specifier does not resolve from a data: URL. The folder is removed
   again afterwards. */
const tmp = join(here, ".tmp-word");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const name of ["papers", "docparse", "worddoc"]) {
  const js = ts.transpileModule(readFileSync(join(root, `lib/${name}.ts`), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"');
  writeFileSync(join(tmp, `${name}.mjs`), js);
}
const papers = await import(pathToFileURL(join(tmp, "papers.mjs")).href);
const worddoc = await import(pathToFileURL(join(tmp, "worddoc.mjs")).href);

const terms = {
  ...papers.DEFAULTS,
  buyer: "Aldercrest Property Holdings LLC",
  parkName: "The Retreat at Cross Creek",
  agreedOn: "2026-10-12", leaseFrom: "2026-10-12",
  financed: true, ratePct: 5.2, termYears: 30,
};
/* TWO HOMES, because a single document is one section with nothing after
   it and cannot tell a page break that works from one that is missing. */
const homes = [
  { lot: "3100 Lady Cheryl Dr",
    describedAs: "Champion Home Legend Series 3bd/2ba 14x66, situated on Lot"
      + " 3100 Lady Cheryl Dr, The Retreat at Cross Creek",
    price: 95600, down: 33460 },
  { lot: "3102 Lady Cheryl Dr", parkName: "Northside",
    describedAs: "2019 Fleetwood 16x76 3bd/2ba, Serial# FLE8891NC",
    price: 48000, down: 9600 },
];

const blob = await worddoc.packDocx(terms, homes, "both");
mkdirSync("/tmp/word", { recursive: true });
const file = "/tmp/word/pack.docx";
writeFileSync(file, Buffer.from(await blob.arrayBuffer()));

const xml = execFileSync("unzip", ["-p", file, "word/document.xml"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const names = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" });
/* The face lives in styles.xml, not in the body -- a check that looked for
   it in document.xml would have to be satisfied by setting the font on
   every run, which is the wrong fix for a failing check. */
const styles = execFileSync("unzip", ["-p", file, "word/styles.xml"],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
/* What the document says, with the markup taken out -- the same trick as
   reading prose out of the generator, and for the same reason. */
const said = xml.replace(/<[^>]*>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#x?[0-9a-fA-F]+;/g, " ");

const results = [];
const t = (name, run) => {
  let ok = false, why = null;
  try { ok = run() === true; } catch (e) { why = String(e && e.message || e); }
  results.push([name, ok, why]);
};

// ---- nothing in the margin -------------------------------------------

t("the file carries no header part",
  () => !/word\/header\d*\.xml/.test(names));
t("and no footer part",
  () => !/word\/footer\d*\.xml/.test(names));
t("nothing references one",
  () => !/<w:headerReference|<w:footerReference/.test(xml));
t("there is no page number field anywhere in it",
  () => !/PAGE\s*\\?\*?\s*MERGEFORMAT|w:fldChar/.test(xml));
t("and no web address", () => !/https?:\/\//.test(said));

// ---- the documents, whole --------------------------------------------

t("the purchase agreement is in it",
  () => said.includes("PURCHASE AGREEMENT"));
t("so is the park land lease",
  () => said.includes("MOBILE HOME PARK LAND LEASE AGREEMENT"));
t("one of each, per home, which is four",
  () => (said.match(/IN WITNESS WHEREOF/g) ?? []).length === 4);
t("the buyer is named", () => said.includes("Aldercrest Property Holdings LLC"));
t("the home is identified in full",
  () => said.includes("Champion Home Legend Series 3bd/2ba 14x66"));
t("the figures are the deal's",
  () => said.includes("33,460.00") && said.includes("62,140"));
t("the date reads the way a contract reads one",
  () => said.includes("12th day of October, 2026"));
t("each lease names its own park",
  () => said.includes("The Retreat at Cross Creek") && said.includes("Northside"));
t("the last clause of the lease is there",
  () => said.includes("Reserve Fund"));
t("and the amortisation schedule came across as a table",
  () => /<w:tbl>/.test(xml) && said.includes("Schedule A"));

// ---- shaped like a document ------------------------------------------

t("every document after the first starts a new page",
  () => (xml.match(/w:type="page"/g) ?? []).length === 3);
t("there are signature lines to sign on",
  () => (xml.match(/<w:bottom w:val="single"/g) ?? []).length >= 8);
/* A name under a signature line is a short line, and justifying it
   spreads the three words of a company name across six inches. Asked on
   the paragraph that carries the break, because that is the one that has
   the short lines in it. */
t("the name under a signature line is not stretched across the page", () => {
  const at = xml.indexOf("Larabee Homes LLC", xml.indexOf("SELLER:"));
  const open = xml.lastIndexOf("<w:p>", at);
  const pPr = xml.slice(open, at);
  return !/w:jc w:val="both"/.test(pPr);
});
/* And the prose still is -- or the rule above would pass by justifying
   nothing at all. */
t("the body of the agreement still is", () => {
  const at = xml.indexOf("IN WITNESS WHEREOF");
  const open = xml.lastIndexOf("<w:p>", at);
  return /w:jc w:val="both"/.test(xml.slice(open, at));
});
t("and the date sits under the name rather than beside it",
  () => /<w:br\/><\/w:r><w:r><w:t xml:space="preserve">Date: _/.test(xml));
t("the page is letter with one-inch margins",
  () => /w:w="12240"/.test(xml) && /w:top="1440"/.test(xml));
t("it is set in a serif face",
  () => /Times New Roman/.test(styles));
/* A run that lost its bold would read as a contract with no defined terms
   and no figures picked out -- which still reads as a contract. */
t("the figures and defined terms are still emphasised",
  () => (xml.match(/<w:b\b/g) ?? []).length > 20);

// ---- say it ----------------------------------------------------------

let bad = 0;
for (const [name, ok, why] of results) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${file}`);
if (bad) { console.error(` ✗ ${bad} of ${results.length}`); process.exit(1); }
console.log("a file with the documents in it and nothing else");
