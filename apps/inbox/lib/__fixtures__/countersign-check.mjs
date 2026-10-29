/**
 * Filling in the other side's signature.
 *
 * The pack is frozen when it is sent, and signing is a substitution on
 * that exact text: regenerating it would mean a change to this codebase
 * could change what somebody had already agreed to.
 *
 *     node lib/__fixtures__/countersign-check.mjs
 *
 * The whole risk is in WHERE the substitution lands. A signature in the
 * wrong slot is us putting the buyer's name on the seller's line.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const tmp = join(here, ".tmp-counter");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const name of ["papers", "docparse", "countersign"]) {
  writeFileSync(join(tmp, `${name}.mjs`),
    ts.transpileModule(readFileSync(join(root, `lib/${name}.ts`), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'));
}
const papers = await import(pathToFileURL(join(tmp, "papers.mjs")).href);
const docparse = await import(pathToFileURL(join(tmp, "docparse.mjs")).href);
const cs = await import(pathToFileURL(join(tmp, "countersign.mjs")).href);
rmSync(tmp, { recursive: true, force: true });

const SAMPLE = readFileSync(join(here, "signature-sample.png"));
const OURS = "data:image/png;base64," + SAMPLE.toString("base64");
/* THEIR mark must be a DIFFERENT picture from ours, or nothing below can
   tell whose signature ended up on whose line -- a substitution that
   wrote over our line as well would look exactly like a correct one. */
const THEIRS = "data:image/png;base64,"
  + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
  + "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
if (THEIRS === OURS) throw new Error("the two marks must differ");

const base = {
  ...papers.DEFAULTS,
  buyer: "Aldercrest Property Holdings LLC",
  parkName: "The Retreat", agreedOn: "2026-10-12", leaseFrom: "2026-10-12",
  signedPng: OURS, signedOn: "2026-10-14",
};
const homes = [
  { lot: "3100", describedAs: "2026 Champion 14x66", price: 95600, down: 33460 },
  { lot: "3101", describedAs: "2019 Fleetwood 16x76", price: 48000, down: 9600 },
];

const results = [];
const t = (name, run) => {
  let ok = false, why = null;
  try { ok = run() === true; } catch (e) { why = String(e && e.message || e); }
  results.push([name, ok, why]);
};

const sent = papers.pack({ ...base, counterSign: true }, homes, "both");
const printed = papers.pack(base, homes, "both");

// ---- what is sent, and what is printed, are not the same -------------

t("a pack to be signed has a slot for every one of their lines",
  () => cs.slotsIn(sent) === 4);
/* A PRINTED CONTRACT MUST NOT CARRY SLOTS. It would be a contract
   waiting for a web page, and nobody looking at it would know. */
t("and a pack to be printed has none",
  () => cs.slotsIn(printed) === 0);
/* Only the slot spans come out: `<span class="fill">` is the document's
   own emphasis on every figure in it, and stripping that too compared
   two things that were different for a reason that is not this one. */
const unslot = (html) => html
  .replace(/<span class="(?:sign|date)slot" data-for="[a-z]+">([\s\S]*?)<\/span>/g,
           "$1");
t("the two read the same to anybody holding them",
  () => unslot(sent) === printed);

// ---- whose line ------------------------------------------------------

const signed = cs.countersign(sent, { png: THEIRS, on: "2026-10-20" });

const sigs = (html) => {
  const out = [];
  const blocks = docparse.readPack(html);
  blocks.forEach((b, i) => {
    if (b.kind !== "p") return;
    const words = b.runs.map((r) => r.text).join("").trim();
    if (!/^(SELLER:|BUYER:|Park Owner:|Homeowner:)$/.test(words)) return;
    const next = blocks[i + 1];
    out.push({ label: words, src: next?.kind === "ink" ? next.src : null });
  });
  return out;
};

const after = sigs(signed);
t("every block is accounted for", () => after.length === 8);
t("our lines still carry our mark",
  () => after.filter((x) => ["SELLER:", "Park Owner:"].includes(x.label))
    .every((x) => x.src === OURS));
/* THE ONE THAT MATTERS. The fixture gives the two sides DIFFERENT
   pictures on purpose: with one picture for both, a substitution that
   wrote over our line as well would look exactly like a correct one. */
t("their lines carry theirs, and theirs is not ours",
  () => after.filter((x) => ["BUYER:", "Homeowner:"].includes(x.label))
    .every((x) => x.src === THEIRS && x.src !== OURS));
t("nothing is left to sign afterwards", () => cs.slotsIn(signed) === 0);

// ---- the dates -------------------------------------------------------

const words = (html) => docparse.readPack(html).filter((b) => b.kind === "p")
  .map((b) => b.runs.map((r) => r.text).join("")).join("\n");

t("the day WE signed is still ours",
  () => (words(signed).match(/Date: 10\/14\/2026/g) ?? []).length === 4);
t("and the day THEY signed is theirs",
  () => (words(signed).match(/Date: 10\/20\/2026/g) ?? []).length === 4);
t("no line is left blank once both have signed",
  () => !/Date: _{6,}/.test(words(signed)));

// ---- it does not touch anything else ---------------------------------

t("not one word of the contract is changed", () => {
  const before = words(sent).replace(/Date: _{6,}/g, "");
  const now = words(signed).replace(/Date: \d\d\/\d\d\/\d{4}/g, "");
  return before.replace(/Date: \d\d\/\d\d\/\d{4}/g, "") === now;
});
t("signing a pack with nowhere to sign changes nothing",
  () => cs.countersign(printed, { png: THEIRS, on: "2026-10-20" }) === printed);

// ---- a deal written up after the fact ---------------------------------
//
// "I need to be able to set the investor's signature date sometimes as
// some of these are retroactive."

const back = papers.pack(
  { ...base, counterSign: true, counterOn: "2026-08-01" }, homes, "both");

t("a buyer's date that was set is printed on their line",
  () => (words(back).match(/Date: 08\/01\/2026/g) ?? []).length === 4);
t("and the slot for it is gone, so signing cannot write over it", () => {
  const after = cs.countersign(back, { png: THEIRS, on: "2026-10-20" });
  return (words(after).match(/Date: 08\/01\/2026/g) ?? []).length === 4
    && !/10\/20\/2026/.test(words(after));
});
/* THE MARK STILL GOES ON. A date set in advance must not stop them
   signing -- it is the date that is fixed, not the signature. */
t("but their signature still lands",
  () => cs.slotsIn(back) === 4
    && cs.slotsIn(cs.countersign(back, { png: THEIRS, on: "2026-10-20" })) === 0);
/* AND OURS IS UNTOUCHED: the two dates are different numbers on purpose,
   so a change that wrote the buyer's date over the seller's would show. */
t("and our own date is still ours",
  () => (words(back).match(/Date: 10\/14\/2026/g) ?? []).length === 4);
t("left blank, their line is still dated the day they sign", () => {
  const after = cs.countersign(sent, { png: THEIRS, on: "2026-10-20" });
  return (words(after).match(/Date: 10\/20\/2026/g) ?? []).length === 4;
});

let bad = 0;
for (const [name, ok, why] of results) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${results.length}`); process.exit(1); }
console.log("their mark goes on their lines and nowhere else");
