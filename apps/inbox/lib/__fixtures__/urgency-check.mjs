/**
 * How loudly a reported fault shouts, and what must not shout.
 *
 *     node lib/__fixtures__/urgency-check.mjs
 *
 * The owner photographed his own dashboard: ten rows marked EMERGENCY, and
 * six of them were smoke detectors -- "Smoke dectectors", "Smoke dectors",
 * "Same smoke dector beeping bedroom", "Smoke detectors and outlets".
 *
 * A detector chirping at three in the morning is a nine-volt battery. An
 * emergency queue with batteries at the top is a queue nobody reads to the
 * bottom, which is where the gas leak is. The file's own comment already
 * said it -- "a dashboard where half the rows shout is a dashboard where
 * nobody looks at the top" -- and then the list contained the bare word
 * "smoke".
 *
 * EVERY STRING BELOW MARKED "real" WAS TYPED BY A TENANT ON THIS ACCOUNT.
 * The misspellings are the point: a rule written against "detector" catches
 * none of them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");

const out = join(here, "jobs-urgency.gen.mjs");
writeFileSync(out, ts.transpileModule(
  readFileSync(join(lib, "jobs.ts"), "utf8"),
  { compilerOptions: { target: 99, module: 99 } }).outputText);
const { urgencyFromText, jobAnchor } = await import(out);

const checks = [];
const t = (name, fn, why) => checks.push([name, fn, why]);

const EMERGENCY = 1, URGENT = 2, NORMAL = 3;

/* --------------------------------------------- what must still shout */

for (const [text, why] of [
  ["I smell gas in the kitchen", "a gas leak"],
  ["There is no heat at all", "real, 26 October, and it is November"],
  ["the outlet is sparking", "sparking"],
  ["sewage backing up into the tub", "sewage"],
  ["the kitchen is on fire", "a fire"],
  ["I smell smoke coming from the vent", "smoke that is not a detector"],
]) {
  t(`emergency: ${text}`, () => urgencyFromText(text) === EMERGENCY, why);
}

/* ------------------------------------ what was shouting and must not */

for (const text of [
  "Smoke dectectors",                      // real
  "Smoke dectors",                         // real
  "Same smoke dector beeping bedroom",     // real
  "Smoke detectors and outlets",           // real
  "smoke alarm keeps chirping",
  "smoke detecter needs a battery",
]) {
  t(`a detector is urgent, not an emergency: ${text}`,
    () => urgencyFromText(text) === URGENT,
    "a battery at the top of the emergency queue is how the gas leak at the "
    + "bottom gets missed -- and it is still a safety item, so not normal");
}

/* ------------------------------------- the cases that tell rules apart */

t("a detector AND a real fire is still an emergency", () =>
  urgencyFromText("smoke detector going off, I can smell smoke downstairs")
    === EMERGENCY,
  "THE CASE THAT ORDERS THE TWO RULES. With only the plain detector in the "
  + "fixture, 'detectors are never an emergency' and 'detectors are an "
  + "emergency only alongside a fire' give the same answer everywhere and "
  + "the check proves nothing");

t("a fireplace is not a fire", () =>
  urgencyFromText("ceiling by fireplace looks like it has water damage")
    !== EMERGENCY,
  "REAL, on this account. Putting the bare word 'fire' in the list would "
  + "trade one false alarm for another");

t("'no heat' still outranks a detector", () =>
  urgencyFromText("no heat and the smoke detector is beeping") === EMERGENCY,
  "the detector rule is asked first, so it has to let a real emergency past "
  + "rather than swallowing the whole sentence");

/* ------------------------------------------------- and the quiet ones */

for (const [text, want, label] of [
  ["kitchen sink leaking", URGENT, "a leak"],
  ["Fridge is going out", URGENT, "real"],
  ["mailbox", NORMAL, "real"],
  ["clean out gutters", NORMAL, "real"],
  ["tree limb hanging", NORMAL, "real"],
  ["Cabinet doors keep falling off", NORMAL, "real"],
]) {
  t(`${want === URGENT ? "urgent" : "normal"}: ${text}`,
    () => urgencyFromText(text) === want, label);
}

t("most things are normal", () => {
  /* A rule that marks everything urgent passes every single-case check
     above and is still useless. This asks the shape of the whole list. */
  const sample = [
    "mailbox", "clean out gutters", "tree limb hanging", "Storm door",
    "Front porch light", "screen door broken", "Wall trimming",
    "Pressure Wash", "Shed Door Opens", "back deck",
  ];
  return sample.every((s) => urgencyFromText(s) === NORMAL);
}, "ten real requests that are nobody's emergency");

/* ------------------------------------- what a job is raised from
 *
 * "Send to…" used to appear only when the thread had a message FROM THEM.
 * The office fields a leak by telephone, opens a thread with the plumber
 * and types the first message itself -- no inbound anything, so a job
 * could not be raised from the one screen the day is spent on.
 */

const line = (id, direction, body) => ({ id, direction, body });

t("their message is what a job is summarised from", () =>
  jobAnchor([line("a", "inbound", "water pouring out under the house")])?.id === "a");

t("OUR REPLY DOES NOT BECOME THE SUMMARY", () =>
  jobAnchor([
    line("a", "inbound", "water pouring out under the house"),
    line("b", "outbound", "I'll get someone out Tuesday"),
  ])?.id === "a",
  "THE CASE THAT TELLS THE TWO RULES APART. A fixture whose last message "
  + "is always theirs cannot distinguish 'their last one' from 'the last "
  + "one', and a job that reads \"I'll get someone out Tuesday\" tells a "
  + "vendor nothing");

t("their LATEST, not their first", () =>
  jobAnchor([
    line("a", "inbound", "there is a damp patch in the hall"),
    line("b", "outbound", "can you send a photo"),
    line("c", "inbound", "it is pouring through the ceiling now"),
  ])?.id === "c",
  "with one inbound message in every case, 'their last' and 'their first' "
  + "are the same answer everywhere and the check proves nothing. A fault "
  + "that walked the thread forwards instead of backwards passed, and this "
  + "is the case where the two differ -- and differ by exactly the thing "
  + "the vendor needs to know");

t("a thread we started can still raise a job", () =>
  jobAnchor([line("a", "outbound", "leak under the house at 128 Sunflower")])?.id === "a",
  "THE ONE THE OWNER ASKED FOR. This used to be null, so no button "
  + "appeared at all");

t("and it takes the newest of ours, not the first", () =>
  jobAnchor([
    line("a", "outbound", "are you free this week"),
    line("b", "outbound", "leak under the house at 128 Sunflower"),
  ])?.id === "b");

t("a thread with nothing in it raises nothing", () =>
  jobAnchor([]) === null,
  "a thread nobody has started has no fault written down anywhere");

/* ---------------------------------------------------------------- report */

let failed = 0;
for (const [name, fn, why] of checks) {
  let ok = false, blew = null;
  try { ok = (await fn()) === true; } catch (e) { blew = e.message; }
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${blew ? `threw: ${blew}` : why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : `\nnothing obviously wrong (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
