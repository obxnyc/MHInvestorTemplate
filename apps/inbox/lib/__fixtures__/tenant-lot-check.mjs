/**
 * Which lot a request is about, worked out from who reported it.
 *
 *     node lib/__fixtures__/tenant-lot-check.mjs
 *
 * 315 maintenance requests on file and TWO of them knew which home they
 * were about. Rent Manager's issue endpoint carries no property, no unit and
 * no tenant -- measured, not assumed -- so the working agreements record it
 * as settled: there is no route from a pulled issue to a lot.
 *
 * True of the issue. Not true of the request: 84 of those threads had the
 * tenant's own email on them, and the portfolio import knows where 308
 * tenants live. Putting the two together placed 61 of them at once.
 *
 * WHAT THE RULE HAS TO REFUSE, and it matters more than what it finds. A
 * request filed against the WRONG home sends somebody to a stranger's door,
 * so one email on two lots is not a near miss to be settled by a tiebreak.
 * It is a question, and the answer is no.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");

const out = join(here, "tenant-lot.gen.mjs");
writeFileSync(out, ts.transpileModule(
  readFileSync(join(lib, "tenant-lot.ts"), "utf8"),
  { compilerOptions: { target: 99, module: 99 } }).outputText);
const { lotForTenant, unitFromTenant, isFullName } = await import(out);

const checks = [];
const t = (name, fn, why) => checks.push([name, fn, why]);

const r = (email, full_name, unit_id) => ({ email, full_name, unit_id });

/* A roster with the shapes that are real on this account: a household where
   two people share one lot, a person whose address is on two lots because
   they moved, and somebody with no email at all. */
const ROSTER = [
  r("brinkley@example.com", "Richard Brinkley", "lot-117"),
  r("colbert@example.com", "Kevin Colbert", "lot-105"),
  r("colbert@example.com", "Mercedes Colbert", "lot-105"), // same household
  /* ONE EMAIL, TWO LOTS, AND TWO DIFFERENT NAMES ON IT.
   *
   * Written this way because the first version had the same name on both
   * rows -- and then the name was ambiguous too, so "refuse the ambiguous
   * email" and "fall through and find the name also ambiguous" BOTH came
   * out null and the ordering check passed with the rule deleted.
   *
   * With Dana on one lot only, a fall-through returns lot-old and the two
   * answers are finally different. If you cannot say which answer the
   * wrong rule would give, the fixture is not asking the question. */
  r("moved@example.com", "Dana Forsyth", "lot-old"),
  r("moved@example.com", "Patty Vann", "lot-new"),
  r(null, "Nahtalia Bennett", "lot-56"),                    // no email on file
  r("mike.one@example.com", "Mike Alvarez", "lot-11"),
  r("mike.two@example.com", "Mike Brennan", "lot-12"),
];

/* ------------------------------------------------------------ it finds */

t("the tenant's own email names the lot", () =>
  lotForTenant({ email: "brinkley@example.com" }, ROSTER)?.unitId === "lot-117");

t("and says it was the email that answered", () =>
  lotForTenant({ email: "brinkley@example.com" }, ROSTER)?.how === "email",
  "a match somebody can understand can be disbelieved for a reason; one "
  + "that cannot be is just a number on a screen");

t("a household on one lot is ONE answer, not two", () =>
  lotForTenant({ email: "colbert@example.com" }, ROSTER)?.unitId === "lot-105",
  "THE REAL CASE. Mercedes Colbert reported the furnace on Kevin Colbert's "
  + "email and they live at 105 Mockingbird together. Two roster rows, one "
  + "home: counting rows rather than lots would refuse a match that is not "
  + "in doubt at all");

t("case and spacing do not matter", () =>
  lotForTenant({ email: "  BRINKLEY@Example.COM " }, ROSTER)?.unitId === "lot-117");

/* ------------------------------------------------------------ it refuses */

t("one email on TWO lots is refused", () =>
  lotForTenant({ email: "moved@example.com" }, ROSTER) === null,
  "somebody who moved. Picking either is a coin toss with a work order on "
  + "it, and the loser is a stranger answering the door to a plumber");

t("an AMBIGUOUS email does not fall through to the name", () => {
  const who = { email: "moved@example.com", name: "Dana Forsyth" };
  /* The name on its own IS a clean answer -- lot-old, one row, no doubt --
     so falling through would return it. That is what makes this check able
     to tell the two rules apart at all. */
  const byNameAlone = lotForTenant({ name: "Dana Forsyth" }, ROSTER);
  return byNameAlone?.unitId === "lot-old" && lotForTenant(who, ROSTER) === null;
}, "THE ORDERING RULE. An email that matched anything is an answer either "
 + "way: one lot is the lot, two is a question, and neither is an invitation "
 + "to ask something vaguer. Falling through lets the weaker evidence break "
 + "a tie the stronger evidence could not");

t("a reporter with NO email does not match the rows that also have none", () =>
  lotForTenant({ email: null, name: null }, ROSTER) === null
  && lotForTenant({ email: "", name: "" }, ROSTER) === null,
  "THE ONE THAT IS NOT A NO-OP. Nahtalia Bennett is on the roster with a "
  + "null email. Comparing raw values matches null to null and files an "
  + "anonymous request against her home. The fixture carries that row on "
  + "purpose; without it, empty-equals-empty never fires and this check "
  + "passes with the guard deleted");

t("a single given name is not an identification", () =>
  lotForTenant({ name: "Mike" }, ROSTER) === null && isFullName("Mike") === false,
  "two Mikes in the fixture, deliberately. With one, 'refuse a bare given "
  + "name' and 'there was only one match' are the same answer and the check "
  + "proves nothing");

t("a full name does identify, when the email is missing", () =>
  lotForTenant({ name: "Nahtalia Bennett" }, ROSTER)?.unitId === "lot-56");

t("and says the name answered, not the email", () =>
  lotForTenant({ name: "Nahtalia Bennett" }, ROSTER)?.how === "name");

t("a name nobody has is nothing", () =>
  lotForTenant({ name: "Someone Entirely Else" }, ROSTER) === null);

/* --------------------------------------------------------- reading it */

function db(rows, error = null) {
  const asked = { filters: [] };
  const q = {
    select: () => q,
    eq: (c, v) => { asked.filters.push(["eq", c, v]); return q; },
    not: (c, o, v) => { asked.filters.push(["not", c, o, v]); return q; },
    ilike: (c, v) => { asked.filters.push(["ilike", c, v]); return q; },
    or: (s) => { asked.filters.push(["or", s]); return q; },
    then: (res) => res({ data: rows, error }),
  };
  return { asked, from: (tbl) => { asked.table = tbl; return q; } };
}

t("it only ever considers tenants whose home is known", async () => {
  const d = db(ROSTER);
  await unitFromTenant(d, { email: "brinkley@example.com" });
  const s = JSON.stringify(d.asked.filters);
  return d.asked.table === "contacts"
      && s.includes("current_tenant") && s.includes("unit_id");
}, "the pull's own placeholder contacts carry an email and no lot; leaving "
 + "them in lets one unplaced request answer for another");

t("it does not go to the database when there is nothing to ask about",
  async () => {
    const d = db(ROSTER);
    const got = await unitFromTenant(d, { email: null, name: "Mike" });
    return got === null && d.asked.filters.length === 0;
  },
  "an anonymous request is the common case, not the edge; a round trip per "
  + "one is work to be told what was already known");

t("a failed read is raised, not reported as 'lives nowhere'", async () => {
  try {
    await unitFromTenant(db(null, { message: "connection refused" }),
      { email: "brinkley@example.com" });
    return false;
  } catch (e) { return /connection refused/.test(e.message); }
}, "filing against nothing because the database hiccupped is the absence of "
 + "an answer being reported as an answer -- the same shape as the crew card "
 + "saying nobody is on the clock after a failed select");

/* --------------------------------------------- and the intake path uses it */

const intake = readFileSync(join(lib, "intake.ts"), "utf8");
const running = intake.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

t("a request being filed asks it", () =>
  /unitFromTenant\(\s*db\s*,/.test(running),
  "A RULE NOTHING RUNS IS A RULE THAT DOES NOT EXIST. Comments stripped "
  + "first: the paragraph explaining why this exists reads the same to a "
  + "search as the line that calls it");

t("and asks it LAST, after anything the message itself said", () => {
  const hint = running.indexOf("unitFromHint(");
  const who = running.indexOf("unitFromTenant(");
  return hint > 0 && who > hint;
}, "an address written in the subject line is about the HOME; the sender is "
 + "only about the person, and a tenant reports a leak at their "
 + "neighbour's as readily as their own");

t("a failed lookup does not throw the request away", () => {
  const at = running.indexOf("unitFromTenant(");
  const around = running.slice(Math.max(0, at - 160), at + 320);
  return /try\s*\{/.test(around) && /catch/.test(around);
}, "losing a maintenance request because a roster lookup hiccupped is a far "
 + "worse trade than filing it with no address");

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
