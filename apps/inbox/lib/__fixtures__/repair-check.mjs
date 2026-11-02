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

const raw = readFileSync(join(lib, "rm-repair.ts"), "utf8");
const src = 'import { toE164, isValidPhone } from "./phone.gen.mjs";\n'
  + raw.replace(/^import\b[\s\S]*?from\s*"[^"]*";/gm, "");
writeFileSync(join(here, "rm-repair.gen.mjs"), tsc(src));
const { isPlaceholderPhone, whatIsMissing, needsMending, placeOf, mendFor } =
  await import(join(here, "rm-repair.gen.mjs"));

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

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : `\nnothing obviously wrong (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
