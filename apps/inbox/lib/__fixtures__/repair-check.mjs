/**
 * Putting a name, a number and a lot back on requests already filed without.
 *
 *     node lib/__fixtures__/repair-check.mjs
 *
 * Two hundred and eighty-five maintenance requests are in this inbox naming
 * nobody, and the pull cannot mend one of them: `ingest` returns the moment
 * it recognises an `external_id`, which is what makes the pull safe to
 * re-run and what makes it useless here. So the repair goes the other way
 * round -- from the threads we hold back to Rent Manager -- and everything
 * below is about the two ways that goes wrong.
 *
 * IT MUST NOT OVERWRITE. Anything already on a thread came from the email
 * path, which carries the tenant and the lot in its subject line, or from a
 * person. Both beat a guess made from an id.
 *
 * AND IT MUST BE ABLE TO TELL THE CASES APART. "Who", "how do I reach them"
 * and "which lot" go missing separately and are not one question -- a
 * thread missing only its lot is worth a round trip, and reporting it as
 * identified because it has a name is the narrower question answered
 * confidently. That mistake has been made four times in this codebase, so
 * every fixture below differs in exactly ONE field from its neighbour: a
 * fixture that gives one of everything cannot tell two answers apart.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");
const tsc = (s) => ts.transpileModule(s,
  { compilerOptions: { target: 99, module: 99 } }).outputText;

// The real phone normaliser, not a stand-in for it: whether a number comes
// back as E.164 is half of what `mendFor` is doing.
writeFileSync(join(here, "phone.gen.mjs"), tsc(readFileSync(join(lib, "phone.ts"), "utf8")));

/* The rule itself lives in `fillblanks`, shared with `intake`, because
   the email arriving and the repair going back for it are the same
   question asked from two ends -- and a rule written twice is a rule
   that drifts. */
const pure = 'import { toE164, isValidPhone } from "./phone.gen.mjs";\n'
  + readFileSync(join(lib, "fillblanks.ts"), "utf8")
      .replace(/^import\b[\s\S]*?from\s*"[^"]*";/gm, "");
writeFileSync(join(here, "fillblanks.gen.mjs"), tsc(pure));
const {
  isPlaceholderPhone, whatIsMissing, needsMending, placeOf, mendFor,
  keepGoing, GIVE_UP_AFTER,
} = await import(join(here, "fillblanks.gen.mjs"));

// The source rules below read the two callers, which are not pure.
const raw = readFileSync(join(lib, "rm-repair.ts"), "utf8");
const intake = readFileSync(join(lib, "intake.ts"), "utf8");

/* Every assertion is a thunk, so one that reaches into a field a fault has
   just removed is reported as a named failure rather than taking the run
   down with a line number. A harness that dies on a fault reads as a
   harness that is broken. */
const checks = [];
const t = (name, fn, why) => {
  let ok = false, blew = null;
  try { ok = fn() === true; } catch (e) { blew = e.message; }
  checks.push([name, ok, blew ? `threw: ${blew}` : why]);
};

/* A thread as we hold it. Every fixture below is this, with ONE thing
   changed, so no check can pass for a reason other than the one it names. */
const WHOLE = {
  conversationId: "c1", issueId: "307", unitId: "u-51",
  placeHint: "1140 Northside Rd Lot 51", contactId: "p1",
  name: "Abel Moreno", phone: "+12525550111", email: "abel@example.com",
};
const less = (o) => ({ ...WHOLE, ...o });

/* --------------------------------------------- the phone that is not one
 *
 * `ingest` cannot write null into `contacts.phone`, so with no number it
 * writes `email:rm:issue:307`. That is a PRESENT value meaning absent, and
 * anything testing `phone ? ... : ...` reads it as a phone number and
 * reports a tenant as reachable who cannot be rung.
 *
 * The same family as the empty string `pick` must not report as the field
 * that answered: the fault is never a missing value, it is a value that
 * looks like an answer.
 */
t("the placeholder Rent Manager writes is not a phone number",
  () => isPlaceholderPhone("email:rm:issue:307") === true,
  "a bare `!phone` test reads this as a number and the tenant is never rung");
t("a real number is a phone number",
  () => isPlaceholderPhone("+12525550111") === false);
t("no number at all is no number",
  () => isPlaceholderPhone(null) === true && isPlaceholderPhone("") === true);

/* ----------------------------------------- three questions, asked apart */

t("a thread that knows who, how and where is left alone",
  () => whatIsMissing(WHOLE).length === 0 && needsMending(WHOLE) === false,
  "if this is ever true the run never terminates: a mended thread would "
  + "still count as unidentified and `more` would never go false");

t("a thread missing only its tenant asks only for the tenant",
  () => { const m = whatIsMissing(less({ name: null }));
          return m.length === 1 && m[0] === "who"; },
  "collapsing to all three here is the narrower question answered loudly");

t("a thread missing only a way to reach them asks only for that",
  () => { const m = whatIsMissing(less({ phone: "email:rm:issue:307", email: null }));
          return m.length === 1 && m[0] === "reach"; });

t("a thread missing only its lot asks only for the lot",
  () => { const m = whatIsMissing(less({ unitId: null }));
          return m.length === 1 && m[0] === "where"; },
  "this is the one the pull files hundreds of: a tenant and no address");

t("a thread with no phone but an email is reachable",
  () => whatIsMissing(less({ phone: "email:rm:issue:307" }))
          .includes("reach") === false,
  "an email is a way to reach somebody; asking Rent Manager again is a "
  + "round trip spent to learn nothing");

t("the request as it actually arrives asks for all three",
  () => { const m = whatIsMissing({
            ...WHOLE, unitId: null, placeHint: null, name: null,
            phone: "email:rm:issue:307", email: null });
          return m.length === 3; },
  "this is the shape of all 285 of them");

/* --------------------------------------------------- the place to look up
 *
 * `unitFromHint` matches on the digits first and then breaks a tie between
 * parks on the words. Handed a bare "51" it has the digits and nothing to
 * break a tie with -- and every park has a lot 51. The pull passes exactly
 * that, which is why a lot number can be perfectly correct and match
 * nothing.
 *
 * So the fixture has TWO parks with the same lot number. With one park the
 * property name is decoration and a `placeOf` that dropped it would pass.
 */
t("the place to look up carries the park as well as the lot",
  () => { const p = placeOf({ property: "1140 Northside Rd", unit: "51" });
          return /northside/i.test(p) && /\b51\b/.test(p); },
  "without the park name, lot 51 at Northside and lot 51 at Cross Creek "
  + "are the same string and the tie cannot be broken");

t("the two parks' lot 51 are different strings",
  () => placeOf({ property: "1140 Northside Rd", unit: "51" })
     !== placeOf({ property: "Cross Creek", unit: "51" }));

t("a single home with no lot number is still a place",
  () => placeOf({ property: "114 Lisas Way", unit: null }) === "114 Lisas Way",
  "no lot in the record is a house, not a failure -- returning null here "
  + "is why single homes could never be matched");

t("nothing known is null, not an empty string",
  () => placeOf({ property: null, unit: null }) === null,
  "an empty hint written onto a thread is an address nobody can see is missing");

/* ------------------------------------------------------- filling a blank
 *
 * The rule is only ever to fill a blank. Each pair below gives the lookup
 * an answer that DIFFERS from what the thread holds, because an answer that
 * agrees cannot tell "left it alone" from "wrote it again".
 */
const FOUND = {
  tenant: "Someone Else", phone: "(252) 555-0999",
  email: "else@example.com", place: "Cross Creek Lot 9",
};

t("a tenant already named is not renamed",
  () => mendFor(WHOLE, FOUND).name === undefined,
  "the email path carries the tenant in its subject line and a person may "
  + "have typed it; both beat an id lookup");
t("a real number already held is not replaced",
  () => mendFor(WHOLE, FOUND).phone === undefined);
t("an address already on the thread is not moved",
  () => mendFor(WHOLE, FOUND).placeHint === undefined,
  "this one would file a request against the wrong park");
t("a thread that knows everything is not written to at all",
  () => Object.keys(mendFor(WHOLE, FOUND)).length === 0,
  "an empty mend is what stops an unchanged thread counting as mended");

t("a missing tenant is filled in",
  () => mendFor(less({ name: null }), FOUND).name === "Someone Else");
t("a missing address is filled in",
  () => mendFor(less({ placeHint: null }), FOUND).placeHint === "Cross Creek Lot 9");

t("a number found for a thread that has none is kept, as E.164",
  () => mendFor(less({ phone: "email:rm:issue:307" }), FOUND).phone === "+12525550999",
  "stored any other way it will not match the contact a text from that "
  + "same number creates");

t("a number that is not a number is not stored",
  () => mendFor(less({ phone: "email:rm:issue:307" }),
                { ...FOUND, phone: "n/a" }).phone === undefined,
  "a junk phone written onto a contact is worse than none: it reads as a "
  + "way to reach somebody");

/* ------------------------------------------------- when to stop asking
 *
 * This runs by itself every few minutes now, against somebody's live
 * property-management system. If Rent Manager will not say who a tenant
 * is on this account, three hundred threads is three hundred round trips
 * spent learning the same thing, forever.
 *
 * The two answers are deliberately different. Out of time means press
 * again. Nothing coming back means pressing again does exactly this, and
 * saying so is the difference between one more press and twenty.
 */
const SOON = { now: 1000, until: 9000 };

t("it keeps going while there is time and answers are coming back",
  () => keepGoing({ blanksInARow: 0, ...SOON }) === "go");

t("out of time is out of time, and says press again",
  () => keepGoing({ blanksInARow: 0, now: 9001, until: 9000 }) === "time");

t("enough empty answers in a row and it stops",
  () => keepGoing({ blanksInARow: GIVE_UP_AFTER, ...SOON })
          === "nothing-coming-back");

t("one short of enough is still going",
  () => keepGoing({ blanksInARow: GIVE_UP_AFTER - 1, ...SOON }) === "go",
  "an off-by-one here gives up a request earlier than intended every run");

t("running out of time is reported as time, not as a dead endpoint",
  () => keepGoing({ blanksInARow: GIVE_UP_AFTER, now: 9001, until: 9000 })
          === "time",
  "told 'nothing is coming back' when it simply ran out, nobody presses "
  + "again and the backlog stops dead with 290 still blank");

/* THE RESET, which is the whole trap in this rule.
 *
 * The count is of blanks IN A ROW. A run that increments but never resets
 * is counting blanks in the whole run -- and on a backlog of three
 * hundred, where plenty of requests legitimately have nothing to add,
 * that gives up almost immediately and reports itself as finished.
 *
 * A source rule for this would be fragile and a type cannot see it, so
 * it is asked of the loop's own words: the counter must be set back to
 * zero somewhere that is not its declaration. */
t("the count is of empty answers in a row, and is reset by a good one",
  () => {
    const loop = raw.slice(raw.indexOf("for (const h of todo"));
    return /blanksInARow\s*=\s*0\s*;/.test(loop)
        && /blanksInARow\s*\+=\s*1/.test(loop);
  },
  "counting blanks for the whole run instead of consecutively means a "
  + "backlog with scattered misses gives up at once and calls it done");

/* --------------------------------------------------------- source rules
 *
 * Two things a pure test cannot see, asked of the source. Both are
 * anchored on the CALL rather than on any wording, and the block is cut
 * out before matching, because an anchor that runs on past its own block
 * matches the next one along -- which cost a round in `inside-check.mjs`
 * and again in the sign-off filter.
 */
const body = (() => {
  const i = raw.indexOf("export async function repairIssues");
  return i < 0 ? "" : raw.slice(i);
})();

t("a rehearsal stops before anything is written",
  () => {
    const guard = body.indexOf("if (dryRun)");
    const write = body.search(/\.update\(/);
    return guard > 0 && write > 0 && guard < write;
  },
  "checked by POSITION, not by pattern: a regex for 'returns before "
  + "writing' matches none of the ways that line can be written");

t("a rehearsal cannot report anything as mended",
  () => {
    const g = body.indexOf("if (dryRun)");
    const m = body.indexOf("out.mended += 1");
    return g > 0 && m > g;
  },
  "a dry run that counts mends reads exactly like a real one");

t("the number is checked against the contacts we hold before it is written",
  () => {
    const i = body.indexOf("if (mend.phone");
    if (i < 0) return false;
    const block = body.slice(i, i + 900);
    return /\.eq\("phone", mend\.phone\)/.test(block)
        && /contact_id: already\.id/.test(block);
  },
  "`contacts.phone` is unique: a tenant who also texts us already holds "
  + "their number, so writing it onto the placeholder is refused and the "
  + "thread stays anonymous. The thread is pointed at the person instead");

/* ------------------------------- the email, arriving after the pull did
 *
 * "I showed you the email this came in on and it had all the information
 * you should need to associate this one."
 *
 * It does. Rent Manager's notification carries the tenant, their number
 * and the lot in its subject line, and `parseRentManager` reads all
 * three. `ingest` joins it to the thread the pull already filed, on what
 * the tenant actually wrote -- and then kept whichever arrival got here
 * FIRST, on the reasoning that the email lands within the minute and the
 * pull is hourly.
 *
 * Sound reasoning, false premise. No notification email has ever reached
 * this application, so the pull got here first for all three hundred and
 * six, and the one arrival that knows who sent it was being written in
 * as a line of text and otherwise dropped.
 *
 * These are source rules because the join is a database write, and they
 * are anchored by cutting the branch out first -- an anchor that runs on
 * past its own block matches the next one along, which has cost a round
 * twice in this codebase.
 */
const twinBranch = (() => {
  const i = intake.indexOf("if (seen?.conversation_id) {");
  if (i < 0) return "";
  // To the end of that branch and no further.
  const j = intake.indexOf("return { ok: true, duplicate: true, joined:", i);
  return j < 0 ? "" : intake.slice(i, j);
})();

t("an email joining a thread the pull already filed is not just filed as text",
  () => twinBranch.length > 0 && /fillBlanks\(/.test(twinBranch),
  "this is the whole complaint: the email had the tenant, the number and "
  + "the lot on it, and the thread it joined still said it knew nobody");

t("the message itself is still recorded, not replaced by the tidying",
  () => /\.from\("messages"\)\s*\.insert\(/.test(twinBranch),
  "the second arrival must not be lost either");

t("what it fills in is decided by the one shared rule, not a second copy",
  () => /from "\.\/fillblanks"/.test(intake)
     && /from "\.\/fillblanks"/.test(raw),
  "two copies of 'only fill a blank' is one copy that will drift");

t("the thread is read before anything is written to it",
  () => {
    const i = intake.indexOf("async function fillBlanks");
    if (i < 0) return false;
    const body = intake.slice(i, i + 3200);
    const read = body.search(/\.select\(/);
    const write = body.search(/\.update\(/);
    return read > 0 && write > 0 && read < write;
  },
  "by position: filling a blank means knowing it was blank, and a write "
  + "sent before the read overwrites the answer it was meant to protect");

/* ------------------------------------------- the half that runs by itself
 *
 * None of this is a button any more. It rides the pull that fires when
 * somebody opens the inbox, which is the only schedule this plan really
 * has -- a Hobby cron fires once a day whatever the expression says.
 *
 * Two things about that are worth holding, and neither is visible in a
 * type: tidying what is already here must never cost the office what has
 * just come in, and the whole thing has sixty seconds before Vercel kills
 * it and returns something that is not JSON.
 */
const auto = readFileSync(
  join(lib, "..", "app/api/rentmanager/issues/auto/route.ts"), "utf8");

t("the repair runs by itself, off the back of the pull",
  () => /repairIssues\(/.test(auto),
  "a button on a diagnostics page is not a feature the office has");

t("a repair that goes wrong cannot cost the office the new requests",
  () => {
    const i = auto.indexOf("repairIssues(");
    if (i < 0) return false;
    const around = auto.slice(Math.max(0, i - 400), i + 400);
    return /try\s*\{/.test(around) && /catch/.test(around);
  },
  "what came in is what the office is waiting for; tidying what is "
  + "already here is not worth losing it over");

t("the pull is asked for first, and the repair gets what is left",
  () => {
    const pull = auto.indexOf("pullServiceIssues(");
    const fix = auto.indexOf("repairIssues(");
    return pull > 0 && fix > pull;
  },
  "checked by position: new requests matter more than old blanks");

t("neither of them is allowed to reach the sixty-second ceiling",
  () => {
    const budgets = [...auto.matchAll(/seconds:\s*(\d+)/g)].map((m) => +m[1]);
    const ceiling = /maxDuration\s*=\s*(\d+)/.exec(auto);
    return budgets.length > 0 && ceiling !== null
        && budgets.every((b) => b < +ceiling[1] - 5);
  },
  "a function killed at the ceiling does not return JSON -- it returns "
  + "whatever Vercel serves, which the browser blames on the parser");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : `\nnothing obviously wrong (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
