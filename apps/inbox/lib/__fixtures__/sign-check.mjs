/**
 * Our signature, and whose line it may go on.
 *
 * "Is there a way to add a date and my signature in this form. I don't
 * want to have to do mine in docusign." There is, and the thing that
 * matters about it is not that the mark appears: it is WHERE. A mark on
 * the purchaser's line is somebody else's signature, written by us, on a
 * contract -- which is worse than no signature at all and looks exactly
 * like a signature.
 *
 *     node lib/__fixtures__/sign-check.mjs
 *
 * Asked at the level of the blocks, because that is where the question
 * actually is. A PDF or a Word file can be searched for an image and told
 * that there are four of them; neither can easily be asked which line
 * each one sits above.
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

const tmp = join(here, ".tmp-sign");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const name of ["papers", "docparse", "pdfdoc", "worddoc"]) {
  const js = ts.transpileModule(readFileSync(join(root, `lib/${name}.ts`), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"');
  writeFileSync(join(tmp, `${name}.mjs`), js);
}
const papers = await import(pathToFileURL(join(tmp, "papers.mjs")).href);
const docparse = await import(pathToFileURL(join(tmp, "docparse.mjs")).href);
const pdfdoc = await import(pathToFileURL(join(tmp, "pdfdoc.mjs")).href);
const worddoc = await import(pathToFileURL(join(tmp, "worddoc.mjs")).href);

/* A REAL SIGNATURE SHAPE, 480 x 160, not a one-pixel square. A square
   cannot tell a signature that was fitted to its box from one that was
   stretched to fill it, and a stretched signature on a contract is a
   signature nobody made. */
const SAMPLE = readFileSync(join(here, "signature-sample.png"));
const INK = "data:image/png;base64," + SAMPLE.toString("base64");
const WIDE = 480 / 160;

const base = {
  ...papers.DEFAULTS,
  buyer: "Aldercrest Property Holdings LLC",
  parkName: "The Retreat at Cross Creek",
  agreedOn: "2026-10-12", leaseFrom: "2026-10-12",
};
const homes = [
  { lot: "3100", describedAs: "2026 Champion 14x66", price: 95600, down: 33460 },
  { lot: "3101", describedAs: "2019 Fleetwood 16x76", price: 48000, down: 9600 },
];

const signed = { ...base, signedPng: INK, signedOn: "2026-10-14" };
const blocksOf = (t, which = "both") =>
  docparse.readPack(papers.pack(t, homes, which));

const results = [];
const t = (name, run) => {
  let ok = false, why = null;
  try { ok = run() === true; } catch (e) { why = String(e && e.message || e); }
  results.push([name, ok, why]);
};

// ---- whose line -------------------------------------------------------

/** The label a run of blocks is under, and whether ink follows it. */
const signatureBlocks = (blocks) => {
  const out = [];
  blocks.forEach((b, i) => {
    if (b.kind !== "p") return;
    const words = b.runs.map((r) => r.text).join("");
    if (!/^(SELLER:|BUYER:|Park Owner:|Homeowner:)$/.test(words.trim())) return;
    out.push({ label: words.trim(), inked: blocks[i + 1]?.kind === "ink" });
  });
  return out;
};

const ours = ["SELLER:", "Park Owner:"];
const theirs = ["BUYER:", "Homeowner:"];

const sigs = signatureBlocks(blocksOf(signed));
t(`every signature block was found (${sigs.length} for four documents)`,
  () => sigs.length === 8);
t("our two lines carry the mark on every document",
  () => sigs.filter((x) => ours.includes(x.label)).length === 4
     && sigs.filter((x) => ours.includes(x.label)).every((x) => x.inked));
/* THE ONE THAT MATTERS. A mark on the purchaser's line is us signing
   somebody else's name. The fixture has both sides present and signed on
   purpose: a pack with only our side in it cannot tell "signs ours" from
   "signs everything". */
t("and the buyer's and homeowner's lines carry nothing",
  () => sigs.filter((x) => theirs.includes(x.label)).length === 4
     && sigs.filter((x) => theirs.includes(x.label)).every((x) => !x.inked));

/* NO RULE UNDER A SIGNATURE. A line is there to be signed ON; once
   somebody has, it is a line ruled through their name. Counted rather
   than looked for: the blocks say how many rules there are, and a signed
   pack has four -- the buyer's and the homeowner's, which are still
   waiting to be signed. */
const rules = (blocks) => blocks.filter((b) => b.kind === "rule").length;
t("a signed pack rules a line only where nobody has signed",
  () => rules(blocksOf(signed)) === 4);
t("and an unsigned one rules all eight",
  () => rules(blocksOf(base)) === 8);

t("an unsigned pack has no mark anywhere",
  () => blocksOf(base).every((b) => b.kind !== "ink")
     && signatureBlocks(blocksOf(base)).every((x) => !x.inked));

/* ONLY OUR SIGNATURE IS A SIGNATURE. The documents contain no other
   image today, so deleting the class test changes nothing in a pack and
   the rule reads as proven when it is not. Asked directly instead: a
   picture that is not the signature must not become one. */
t("an image that is not the signature is not treated as one", () => {
  const got = docparse.readPack(
    `<p>Before</p><img class="logo" src="data:image/png;base64,AAAA">`
    + `<p>After</p>`);
  return got.every((b) => b.kind !== "ink")
    && got.filter((b) => b.kind === "p").length === 2;
});
t("and the signature still is", () => {
  const got = docparse.readPack(`<p>X</p><img class="sigink" src="${INK}">`);
  return got.some((b) => b.kind === "ink" && b.src === INK);
});

// ---- the date ---------------------------------------------------------

const words = (t2) => blocksOf(t2).filter((b) => b.kind === "p")
  .map((b) => b.runs.map((r) => r.text).join("")).join("\n");

t("the day it was signed is printed on our side",
  () => (words(signed).match(/Date: 10\/14\/2026/g) ?? []).length === 4);
t("and the other side still has a line to date",
  () => (words(signed).match(/Date: _{6,}/g) ?? []).length === 4);
t("an unsigned pack leaves every date blank",
  () => (words(base).match(/Date: _{6,}/g) ?? []).length === 8
     && !/Date: \d/.test(words(base)));

// ---- one document, or all of them -------------------------------------
//
// "I should be able to apply it to one page or across all pages." Absent
// means all, which is what signing a pack means. A set is somebody having
// said otherwise.

const onlyFirst = (key) => key === papers.docKey(0, "purchase");
const picked = docparse.readPack(papers.pack(signed, homes, "both", onlyFirst));
const pickedSigs = signatureBlocks(picked);

t("choosing one document signs exactly that one",
  () => picked.filter((b) => b.kind === "ink").length === 1);
/* And it is the RIGHT one. A fixture that only counts cannot tell
   "signed the first" from "signed the third": the first document's
   seller block is the first of the eight, so its position says which. */
t("and it is the one that was chosen",
  () => pickedSigs[0].label === "SELLER:" && pickedSigs[0].inked === true
     && pickedSigs.slice(1).every((x) => !x.inked));
t("the ones not chosen still have a line to sign on",
  () => rules(picked) === 7);
t("choosing none signs nothing at all",
  () => docparse.readPack(papers.pack(signed, homes, "both", () => false))
    .every((b) => b.kind !== "ink"));
t("and choosing all is the same as not choosing",
  () => papers.pack(signed, homes, "both", () => true)
     === papers.pack(signed, homes, "both"));

// ---- it reaches the files ---------------------------------------------

mkdirSync("/tmp/sign", { recursive: true });

const blob = await worddoc.packDocx(signed, homes, "both");
const docx = "/tmp/sign/signed.docx";
writeFileSync(docx, Buffer.from(await blob.arrayBuffer()));
const xml = execFileSync("unzip", ["-p", docx, "word/document.xml"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const names = execFileSync("unzip", ["-Z1", docx], { encoding: "utf8" });
t("the Word file carries four pictures, one per document",
  () => (xml.match(/<w:drawing>/g) ?? []).length === 4);
t("and the picture is in the file rather than linked to one",
  () => /word\/media\//.test(names));

/* Written to a file rather than piped: unzip seeks, and a pipe is not
   something it can seek in -- "cannot open zipfile [ /dev/stdin ]". */
const unsignedBlob = await worddoc.packDocx(base, homes, "both");
const plain = "/tmp/sign/unsigned.docx";
writeFileSync(plain, Buffer.from(await unsignedBlob.arrayBuffer()));
const unsignedXml = execFileSync("unzip", ["-p", plain, "word/document.xml"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
t("and an unsigned Word file carries none",
  () => !/<w:drawing>/.test(unsignedXml));

const PdfPrinter = require_("pdfmake");
const printer = new PdfPrinter(pdfdoc.TIMES);
const doc = printer.createPdfKitDocument(pdfdoc.buildPdfDef(signed, homes, "both"));
const bits = [];
doc.on("data", (b) => bits.push(b));
await new Promise((done) => { doc.on("end", done); doc.end(); });
const pdf = "/tmp/sign/signed.pdf";
writeFileSync(pdf, Buffer.concat(bits));
const raw = readFileSync(pdf, "latin1");
t("the PDF carries an image", () => /\/Subtype\s*\/Image/.test(raw));
/* FITTED, NOT STRETCHED. The box is 150 x 45 points and the signature is
   three to one, so it comes out 135 x 45 and keeps its shape. Read with
   pdfimages rather than out of the file: the content streams are
   compressed, so the drawing instructions are not there to be searched
   for. Equal horizontal and vertical resolution IS "not stretched", and
   the resolution gives the drawn size: pixels / ppi * 72. */
const drawn = execFileSync("pdfimages", ["-list", pdf], { encoding: "utf8" })
  .split("\n").slice(2)
  .map((l) => l.trim().split(/\s+/))
  .filter((c) => c[2] === "image")
  .map((c) => ({ px: Number(c[3]), py: Number(c[4]),
                 xppi: Number(c[12]), yppi: Number(c[13]) }));
t(`the signature is drawn on every document (${drawn.length})`,
  () => drawn.length === 4);
t("and it keeps its proportions rather than filling the box",
  () => drawn.length > 0 && drawn.every((d) => {
    if (d.xppi !== d.yppi) {
      throw new Error(`drawn at ${d.xppi} by ${d.yppi} dpi, so it is stretched`);
    }
    return true;
  }));
t("and it is a signature's size, not a banner", () => {
  const d = drawn[0];
  const w = d.px / d.xppi * 72, h = d.py / d.yppi * 72;
  if (!(w <= 150.5 && h <= 45.5 && w > 100)) {
    throw new Error(`drawn ${w.toFixed(1)} x ${h.toFixed(1)} points`);
  }
  return true;
});

const text = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" });
t("and still says the day it was signed",
  () => (text.match(/Date: 10\/14\/2026/g) ?? []).length === 4);

rmSync(tmp, { recursive: true, force: true });

let bad = 0;
for (const [name, ok, why] of results) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
console.log("wrote /tmp/sign/signed.{docx,pdf}");
if (bad) { console.error(` ✗ ${bad} of ${results.length}`); process.exit(1); }
console.log("our line is signed and theirs is not");
