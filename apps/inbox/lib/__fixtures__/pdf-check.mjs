/**
 * The PDF, rendered and read back.
 *
 * "When I click print/save as pdf it continues to have the headers with
 * dates and urls. That is not acceptable." It is not, and it was never
 * going to stop: that margin belongs to the browser's print dialog and
 * not to the page. So the Print button is gone and the application makes
 * the file, and this checks what comes out of it.
 *
 *     node lib/__fixtures__/pdf-check.mjs
 *
 * pdfmake renders the same definition in Node that it renders in a tab,
 * so the file this reads is the file the owner gets.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const require_ = createRequire(join(root, "package.json"));

const tmp = join(here, ".tmp-pdf");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const name of ["papers", "docparse", "pdfdoc"]) {
  const js = ts.transpileModule(readFileSync(join(root, `lib/${name}.ts`), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"');
  writeFileSync(join(tmp, `${name}.mjs`), js);
}
const papers = await import(pathToFileURL(join(tmp, "papers.mjs")).href);
const pdfdoc = await import(pathToFileURL(join(tmp, "pdfdoc.mjs")).href);

const terms = {
  ...papers.DEFAULTS,
  buyer: "Aldercrest Property Holdings LLC",
  parkName: "The Retreat at Cross Creek",
  agreedOn: "2026-10-12", leaseFrom: "2026-10-12",
  financed: true, ratePct: 5.2, termYears: 30,
};
/* TWO homes, so four documents: a single short agreement is one page,
   and a one-home fixture cannot tell a pack that paginated from one that
   stopped after the first document. */
const homes = [
  { lot: "3100 Lady Cheryl Dr",
    describedAs: "2026 Champion Legend Series 3bd/2ba 14x66, situated on Lot"
      + " 3100 Lady Cheryl Dr, The Retreat at Cross Creek",
    price: 95600, down: 33460 },
  { lot: "3101 Lady Cheryl Dr", parkName: "Northside",
    describedAs: "2019 Fleetwood 16x76 3bd/2ba, Serial# FLE8891NC",
    price: 48000, down: 9600 },
];

const def = pdfdoc.buildPdfDef(terms, homes, "both");

mkdirSync("/tmp/pdf", { recursive: true });
const file = "/tmp/pdf/pack.pdf";
const PdfPrinter = require_("pdfmake");
const printer = new PdfPrinter({
  [pdfdoc.SERIF]: Object.fromEntries(Object.entries(pdfdoc.FONTS[pdfdoc.SERIF])
    .map(([k, v]) => [k, join(root, "public/fonts", v)])),
});
const doc = printer.createPdfKitDocument(def);
const bits = [];
doc.on("data", (b) => bits.push(b));
await new Promise((done) => { doc.on("end", done); doc.end(); });
writeFileSync(file, Buffer.concat(bits));
rmSync(tmp, { recursive: true, force: true });

const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
const pages = text.split("\f").filter((x) => x.trim());
const raw = readFileSync(file, "latin1");

const results = [];
const t = (name, run) => {
  let ok = false, why = null;
  try { ok = run() === true; } catch (e) { why = String(e && e.message || e); }
  results.push([name, ok, why]);
};

// ---- nothing in the margin, which is the whole point -----------------

t("no web address anywhere in the text", () => !/https?:\/\/|\.com\b|\.app\b/.test(text));
/* The date the file was printed, not the dates IN the documents: a
   printed-on stamp is the month and day of today in the margin, and the
   agreement's own dates are spelled out ("12th day of October, 2026"). */
const today = new Date();
const stamped = [
  `${today.getMonth() + 1}/${today.getDate()}/`,
  today.toISOString().slice(0, 10),
];
for (const mark of stamped) {
  t(`no “${mark}” stamped on any page`, () => !text.includes(mark));
}
t("no page numbering in the margin", () => {
  // "1/13", "Page 1 of 13" -- what a print dialog writes.
  return !/\b\d+\s*\/\s*\d+\b/.test(text) && !/Page \d+ of \d+/i.test(text);
});
t("the file declares no document title", () => !/\/Title\s*\(/.test(raw));

// ---- the documents, whole --------------------------------------------

t(`it is more than one page (${pages.length})`, () => pages.length > 1);
t("the purchase agreement is there", () => text.includes("PURCHASE AGREEMENT"));
/* THE HEADINGS ARE BOLD, which pdftotext cannot see -- it reads letters,
   not weights. Counted off the definition instead: every run of a title
   and of a numbered clause heading must ask for bold, and the line that
   identifies the home must too. A block that asks for bold while its
   runs say otherwise is a heading in plain text. */
const defOf = (t2) => pdfdoc.buildPdfDef(t2, homes, "both").content;
const def2 = defOf(terms);
const allBold = (piece) => Array.isArray(piece.text)
  && piece.text.length > 0 && piece.text.every((r) => r.bold === true);
t("every document title is set in bold",
  () => def2.filter((x) => x.fontSize === 14).length === 4
     && def2.filter((x) => x.fontSize === 14).every(allBold));
t("and every numbered clause heading",
  () => def2.filter((x) => x.fontSize === 12).length > 20
     && def2.filter((x) => x.fontSize === 12).every(allBold));
t("and the line that says which home is being sold",
  () => {
    const at = def2.findIndex((x) => Array.isArray(x.text)
      && x.text.some((r) => /to wit:/.test(r.text)));
    return at >= 0 && allBold(def2[at + 1]);
  });
t("so is the park land lease",
  () => text.includes("MOBILE HOME PARK LAND LEASE AGREEMENT"));
t("one of each per home, which is four",
  () => (text.match(/IN WITNESS WHEREOF/g) ?? []).length === 4);
t("each document starts a page of its own", () => {
  const first = pages.filter((p) =>
    /PURCHASE AGREEMENT|MOBILE HOME PARK LAND LEASE AGREEMENT/
      .test(p.split("\n").slice(0, 4).join("\n")));
  return first.length === 4;
});
t("the buyer is named", () => text.includes("Aldercrest Property Holdings LLC"));
t("the home is identified in full",
  () => text.includes("2026 Champion Legend Series 3bd/2ba 14x66"));
t("the figures are the deal's",
  () => text.includes("33,460.00") && text.includes("62,140"));
t("the agreement's own date is spelled out",
  () => text.includes("12th day of October, 2026"));
/* A SPACE BEFORE A COMMA. pdfmake lays each styled run out as its own
   inline, so the bold date and the plain comma after it were two words
   and justification put a space between them: "2025 , by". Asked on a
   justified line, because left-aligned text hides it. */
t("there is no space before a comma that ends a bold run",
  () => !/\s,/.test(text.replace(/\n/g, " ")));
t("each lease names its own park",
  () => text.includes("The Retreat at Cross Creek") && text.includes("Northside"));
t("the amortisation schedule came across",
  () => text.includes("Schedule A") && /Principal paid/.test(text));
t("the last clause of the lease is there", () => text.includes("Reserve Fund"));
t("there is somewhere to sign",
  () => text.includes("SELLER:") && text.includes("Date:"));

// ---- set like a document ---------------------------------------------

/* The face is EMBEDDED now, which is the point: the fourteen faces every
   reader already has are WinAnsi-encoded and have no non-breaking hyphen,
   and a plain one is somewhere pdfmake will stretch a justified line. */
t("the typeface travels with the document",
  () => /FontFile2/.test(raw) && /Tinos/.test(raw));
t("in both weights, or the bold is a lie",
  () => (raw.match(/Tinos/g) ?? []).length >= 2);
/* THE THING THE EMBEDDING IS FOR. A compound word may not be split, and
   a justified line may not be stretched in the middle of one. */
/* Justifying, pdfmake stretches every place a line MAY break, not only
   the spaces -- so a slash or a hyphen inside a word became a gap.
   Asked over the whole pack rather than on one phrase, because the
   words it happens to are the deal's: "3bd/2ba" is a description
   somebody typed and "$341.22/yr" is a figure. */
const pulled = (text.replace(/\n/g, " ")
  .match(/\S*[\u2010\u2011/-] \S+/g) ?? [])
  .filter((x) => !/^-|— | - /.test(x));
t("no word is pulled apart at a slash or a hyphen",
  () => { if (pulled.length) throw new Error(pulled.slice(0, 4).join(" | "));
          return true; });
t("and the fixture contains words that would be",
  () => /3bd.2ba/.test(text) && /\d\/\s?yr|a year/.test(text));
t("and the non-breaking hyphen is really in there",
  () => /purchase\u2011money|purchase-money/.test(text.replace(/\s+/g, " ")));
t("the page is letter",
  () => /\/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]/.test(raw));

let bad = 0;
for (const [name, ok, why] of results) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
console.log(`wrote ${file}`);
if (bad) { console.error(` ✗ ${bad} of ${results.length}`); process.exit(1); }
console.log("a PDF with the documents in it and nothing in the margin");
