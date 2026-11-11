/**
 * Whether the paths that bring work in are bringing it in.
 *
 *     node lib/__fixtures__/intake-health-check.mjs
 *
 * 309 maintenance requests arrived by the hourly API read. ZERO have
 * ever arrived by email -- not one, since the day the forward was set
 * up. The email is the only path that carries the tenant's name, their
 * number and the lot, so every request in the inbox sat against no
 * property, and five separate fixes were built in one week against a
 * thing none of them could ever see.
 *
 * Nothing said so, which is the whole point of this file.
 *
 * THE RULE IT HAS TO GET RIGHT. "Nothing arrived" is not a fault. A
 * quiet week is a quiet week, and a check that shouts about one is a
 * check nobody reads by Thursday -- worse than no check, because the
 * real finding is in that list too.
 *
 * The fault is ONE PATH SILENT WHILE ANOTHER IS BUSY.
 *
 * So the fixture must hold both, and they must come out differently.
 * With only the broken case in it, "shout when no email arrived" and
 * "shout when the email path is dead" are the same rule and the check
 * proves nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");
const raw = readFileSync(join(lib, "intake-health.ts"), "utf8");
writeFileSync(join(here, "intake-health.gen.mjs"), ts.transpileModule(
  raw.replace(/^import\b[\s\S]*?from\s*"[^"]*";/gm, ""),
  { compilerOptions: { target: 99, module: 99 } }).outputText);
const { intakeVerdict } = await import(join(here, "intake-health.gen.mjs"));

const checks = [];
const t = (name, fn, why) => {
  let ok = false, blew = null;
  try { ok = fn() === true; } catch (e) { blew = e.message; }
  checks.push([name, ok, blew ? `threw: ${blew}` : why]);
};

const week = (o) => ({ byEmail: 0, byPull: 0, byText: 0, lastEmailAt: null,
                       days: 7, ...o });

/* The four weeks that matter, and they differ in ONE number each. */
const BROKEN = week({ byPull: 42, byText: 3 });        // the real one
const QUIET  = week({});                               // nothing at all
const WORKING = week({ byEmail: 9, byPull: 42, byText: 3 });
const EMAIL_ONLY = week({ byEmail: 4 });

/* ------------------------------------------------- the fault, and only it */

t("requests coming in by every route except the one that knows where they are",
  () => intakeVerdict(BROKEN).level === "bad",
  "THE REAL STATE for months: 309 by the pull, zero by email, and the "
  + "address only ever exists in the email");

t("a quiet week is not a fault",
  () => intakeVerdict(QUIET).level === "ok",
  "THE CASE THAT TELLS THE RULES APART. Both weeks have zero emails. A "
  + "check that only counts emails shouts at both, and the office stops "
  + "reading it by Thursday");

t("and a quiet week does not read as a broken forward",
  () => !/not arriv|not deliver/i.test(intakeVerdict(QUIET).headline
          + intakeVerdict(QUIET).detail),
  "crying wolf is worse than no check at all");

t("emails arriving is fine, however many came the other way",
  () => intakeVerdict(WORKING).level === "ok");

t("emails arriving and nothing else is also fine",
  () => intakeVerdict(EMAIL_ONLY).level === "ok",
  "a week where the forward worked and the pull found nothing new is a "
  + "working week, not a broken pull");

/* ------------------------------------------------- it has to be actionable */

t("the fault says how many came the other way",
  () => /42/.test(intakeVerdict(BROKEN).detail),
  "'no emails' is a fact nobody can act on; 'forty-five arrived another "
  + "way and none by email' names a broken forward");

t("it says what is actually lost, not just that a count is zero",
  () => /name|number|lot/i.test(intakeVerdict(BROKEN).detail),
  "the reason it matters is that the address is only in the email");

t("it names where to look",
  () => /gmail/i.test(intakeVerdict(BROKEN).detail)
     && /postmark/i.test(intakeVerdict(BROKEN).detail),
  "the chain is Rent Manager, a Gmail filter, Postmark, this app -- a "
  + "report that does not say which links to check sends somebody "
  + "nowhere");

t("never having had one reads differently from having lost it",
  () => {
    const never = intakeVerdict(BROKEN);
    const lapsed = intakeVerdict({ ...BROKEN, lastEmailAt: "Sep 3, 2026" });
    return /NEVER|not one has ever/i.test(never.detail)
        && /Sep 3, 2026/.test(lapsed.detail)
        && never.detail !== lapsed.detail;
  },
  "a forward that never worked is a setup that was never finished; one "
  + "that stopped in September is a thing that broke, and they are "
  + "looked into differently");

/* -------------------------------------------------------- the daily report */

const rep = readFileSync(join(lib, "delinquency.ts"), "utf8");
const route = readFileSync(
  join(lib, "..", "app/api/cron/delinquency/route.ts"), "utf8");

/* Each file asked the question it actually answers.
 *
 * `delinquency.ts` has NO IMPORTS on purpose -- its own header says so,
 * and its harness loads it as a data: URL where a relative import
 * cannot resolve. Importing `intakeVerdict` into it took that whole
 * harness down. So the route works the verdict out and the report
 * renders it, and this asks each for its own half. */
t("the route reads the arrivals and works out the verdict",
  () => /readArrivals\(/.test(route) && /intakeVerdict\(/.test(route),
  "a check nothing runs is a check that does not exist -- which is how "
  + "this went unnoticed for months in the first place");

t("and hands it to the report",
  () => /render\(\s*report\s*,\s*vac\s*,\s*intake\s*\)/.test(route),
  "computed and then dropped is the same as never computed");

t("the report puts it in front of somebody",
  () => /intake\.headline/.test(rep) && /intake\.detail/.test(rep),
  "a verdict that reaches no reader is a log line");

t("the report still has no imports",
  () => !/^import\b/m.test(rep),
  "its harness loads it as a data: URL, where a relative import cannot "
  + "resolve -- one import here and 44 checks stop running");

/* Asked of the subject line itself, not of the file.
 *
 * The first version checked that `intakePart` appears in the source and
 * is declared above the subject -- both still true when the subject
 * stops using it, because the declaration is still sitting there. It
 * passed with the fault in. Testing for the presence of a name tests
 * nothing about whether anything reads it. */
t("a broken forward reaches the SUBJECT line",
  () => {
    const m = /const subject = `([^`]*)`/.exec(rep);
    return m !== null && m[1].includes("${intakePart}");
  },
  "a fault reported only in the body of a daily email is a fault "
  + "nobody reads about");

t("only a broken forward reaches the subject",
  () => /intake\?\.level === "bad"[\s\S]{0,80}intakePart|intakePart[\s\S]{0,80}"bad"/
          .test(rep),
  "a subject line that mentions maintenance every single morning stops "
  + "being read, including on the morning it matters");

t("reading it can never stop the report going out",
  () => {
    const i = route.indexOf("readArrivals(");
    const around = route.slice(Math.max(0, i - 300), i + 300);
    return /try\s*\{/.test(around) && /catch/.test(around);
  },
  "a balance that could not be read is still worth sending, and so is "
  + "one read on a morning this half failed");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : `\nnothing obviously wrong (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
