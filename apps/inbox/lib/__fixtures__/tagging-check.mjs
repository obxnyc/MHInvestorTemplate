/**
 * What an arriving request is tagged with.
 *
 * "The requests that come in have the address, the name of the tenant,
 * and their phone number. That should talk to a database with all their
 * information and smart tag."
 *
 * They do, and it does -- `parseRentManager` reads all three out of the
 * email and `unitFromHint` matches the address against the properties
 * held. What it did NOT do was write the answer onto the thread: the work
 * order got the address and the conversation did not, so a request
 * matched perfectly still opened a thread headed "Not filed against a
 * property" with a job underneath it that knew exactly where it was. Two
 * answers to one question, and the wrong one on screen.
 *
 *     node lib/__fixtures__/tagging-check.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

const tmp = join(here, ".tmp-tag");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
// zillow is here because parse-email imports it: the rewrite below points a
// relative specifier at a sibling .mjs, so the sibling has to be written too.
for (const name of ["parse-email", "phone", "format", "zone", "zillow"]) {
  let src;
  try { src = read(`lib/${name}.ts`); } catch { continue; }
  writeFileSync(join(tmp, `${name}.mjs`),
    ts.transpileModule(src, { compilerOptions: {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
      .replace(/from "\.\/(\w|-)+"/g, (m) => m.replace('from "./', 'from "./') + "")
      .replace(/from "\.\/([\w-]+)"/g, 'from "./$1.mjs"')
      .replace(/from "@\/lib\/([\w-]+)"/g, 'from "./$1.mjs"'));
}
const { parseRentManager } = await import(pathToFileURL(join(tmp, "parse-email.mjs")).href);
rmSync(tmp, { recursive: true, force: true });

const intake = bare(read("lib/intake.ts"));

const results = [];
const t = (name, run) => {
  let ok = false, why = null;
  try { ok = run() === true; } catch (e) { why = String(e && e.message || e); }
  results.push([name, ok, why]);
};

// ---- the email really does carry all three ----------------------------

/* The owner's own words, and worth asserting rather than believing: the
   API pull carries none of this and the email carries all of it, and the
   two are easy to mistake for one another. */
const mail = parseRentManager({
  from: "noreply@rentmanager.com",
  subject: "New Issue Submitted from TWA: 1140 Northside #51, 1140 Northside Rd, Lot #51",
  messageId: "<abc@rentmanager.com>",
  text: [
    "Issue Title: Fridge is going out",
    "Description: My fridge is leaking water from the top into the bottom drawers.",
    "Tenant: Dossantos, Marie",
    "Number: (910) 555-0114",
    "Email: marie@example.com",
  ].join("\n"),
});

t("the tenant's name comes across", () => /Marie/.test(mail.name ?? ""));
t("and is put the way round a person says it",
  () => (mail.name ?? "").startsWith("Marie"));
t("their number comes across", () => /555-0114/.test(mail.phone ?? ""));
t("their email comes across", () => mail.email === "marie@example.com");
t("and the address, out of the subject line",
  () => /1140 Northside/.test(mail.unitHint ?? "")
     && /51/.test(mail.unitHint ?? ""));
t("it is filed as maintenance", () => mail.category === "maintenance");

// ---- and the answer is written onto the thread ------------------------

/* THE FAULT. `work_orders.unit_id` was set and `conversations.unit_id`
   was not, so the thread asked a human a question the job had already
   answered. Asked by position inside openJob rather than by pattern: a
   regex for "updates the conversation" matches none of the ways that can
   be written. */
t("the thread is tagged with the address that was worked out", () => {
  const at = intake.indexOf("async function openJob");
  if (at < 0) throw new Error("openJob was not found");
  const body = intake.slice(at, intake.indexOf("async function unitFromHint"));
  const matched = body.indexOf("unitFromHint(db, item.unitHint)");
  /* The UPDATE, not the first mention of the table: openJob reads the
     conversation at the top to see what it already knows, and a search
     for the table name finds that read and calls the job done. */
  const tagged = body.search(/\.from\("conversations"\)\s*\n?\s*\.update\(/);
  if (matched < 0) throw new Error("the address is never worked out");
  if (tagged < 0) throw new Error("the thread is never tagged with it");
  return tagged > matched;
});
t("and only when it was worked out here, not when it was already known",
  () => /worked = Boolean\(unitId\)/.test(intake)
     && /if \(unitId && worked\)/.test(intake));
/* THE CONTACT IS LEFT ALONE. A tenant reports a leak at their
   neighbour's as readily as their own, and writing an address onto a
   person from one request is how a record quietly becomes wrong. */
t("the person is not given an address from one request", () => {
  const at = intake.indexOf("async function openJob");
  const body = intake.slice(at, intake.indexOf("async function unitFromHint"));
  return !/\.from\("contacts"\)[\s\S]{0,200}update/.test(body);
});
/* AND A FAILED TAG IS NOT A FAILED REQUEST. The job still carries the
   address; the thread simply asks somebody to confirm it. */
t("a tag that does not write still lets the request in",
  () => /console\.warn\("could not tag the thread/.test(intake));

// ---- the matching itself, which was already right ---------------------

t("a remembered answer still beats any parsing",
  () => intake.indexOf("place_aliases") < intake.indexOf("lotDigits(hint)"));
t("and two parks sharing a lot number is still refused rather than guessed",
  () => /scored\[0\]\.hits > \(scored\[1\]\?\.hits \?\? 0\)/.test(intake));

let bad = 0;
for (const [name, ok, why] of results) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${results.length}`); process.exit(1); }
console.log("what arrives is matched, and the thread is told the answer");
