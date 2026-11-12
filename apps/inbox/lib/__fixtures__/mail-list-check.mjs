/**
 * Who an automatic email goes to, and the one distinction that is easy to
 * lose.
 *
 *     node lib/__fixtures__/mail-list-check.mjs
 *
 * `BOOKKEEPER_EMAIL` was a hosting setting, so adding a fourth person to the
 * bookkeeper's list meant signing in to Vercel, finding the right project,
 * opening the right variables page, typing the addresses and then
 * REDEPLOYING -- because settings are read at build time, so the edit alone
 * changes nothing and reads as the fix having failed. None of that can be
 * done from a session like this one. The morning report already solved it in
 * migration 051: who gets it is a table, not code.
 *
 * THE RULE WITH TEETH. An empty table and a table whose every row has
 * finished are NOT the same state.
 *
 *   no rows at all      nobody ever said who gets these, so the old setting
 *                       is still worth honouring
 *   rows, none active   somebody decided. That is a list of nobody, on
 *                       purpose, and falling back to a dashboard value
 *                       overrules them silently
 *
 * AND THE FIXTURE HAS TO BE ABLE TO TELL THOSE APART. With the environment
 * variable unset, "falls back" and "does not fall back" both come out empty
 * and the check proves nothing -- the oldest lesson in the working
 * agreements. So it is set, to an address that appears nowhere else, and the
 * check is that it is NOT in the answer.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");

/* Three files, because mail-list genuinely uses the other two. Its imports
   are pointed at the generated siblings rather than stripped. */
const gen = (name, rewrite = (s) => s) => {
  const out = join(here, `${name}.gen.mjs`);
  writeFileSync(out, ts.transpileModule(
    rewrite(readFileSync(join(lib, `${name}.ts`), "utf8")),
    { compilerOptions: { target: 99, module: 99 } }).outputText);
  return out;
};
gen("delinquency");
gen("invoices");
const { mailList } = await import(gen("mail-list", (s) =>
  s.replace(/from "\.\/(delinquency|invoices)"/g, 'from "./$1.gen.mjs"')));

const checks = [];
const t = (name, fn, why) => checks.push([name, fn, why]);

/** An address that is in no fixture row, so its presence in an answer can
 *  only have come from the environment. */
const DASHBOARD = "left-over@olddashboard.example";

/** A stand-in for the one query this makes, recording what it was asked. */
function db(rows, error = null) {
  const asked = [];
  return {
    asked,
    from: (table) => ({
      select: () => ({
        eq: async (col, val) => { asked.push([table, col, val]); return { data: rows, error }; },
      }),
    }),
  };
}

const row = (email, o = {}) =>
  ({ email, name: null, starts_on: null, ends_on: null, ...o });

const TODAY = "2026-11-12";

/* ------------------------------------------------- the table is the answer */

t("the four people on the table are the list", async () => {
  process.env.X = "";
  const r = await mailList(
    db([row("sam@larabeehomesllc.com"), row("alex@larabeehomesllc.com"),
        row("cade@larabeehomesllc.com"), row("info@larabeehomesllc.com")]),
    "invoices", DASHBOARD, TODAY);
  return r.to.length === 4 && r.from === "table" && !r.to.includes(DASHBOARD);
}, "with rows present the dashboard value is not consulted at all");

t("it asks for the right report", async () => {
  const d = db([row("a@b.com")]);
  await mailList(d, "invoices", null, TODAY);
  const [[table, col, val]] = d.asked;
  return table === "report_recipients" && col === "report" && val === "invoices";
}, "both lists live in one table; reading it without the filter sends the "
 + "bookkeeper the morning delinquency report's recipients");

/* ------------------------------------- the distinction this file exists for */

t("an EMPTY table falls back to the old setting", async () => {
  const r = await mailList(db([]), "invoices", DASHBOARD, TODAY);
  return r.to.length === 1 && r.to[0] === DASHBOARD && r.from === "environment";
}, "nobody has ever said who gets these, so a deployment that had the "
 + "variable set keeps working");

t("a table whose every row has FINISHED does not fall back", async () => {
  const r = await mailList(
    db([row("gone@larabeehomesllc.com", { ends_on: "2026-01-01" })]),
    "invoices", DASHBOARD, TODAY);
  return r.to.length === 0 && r.from === "nobody";
}, "THE CASE THE FIXTURE HAS TO BE ABLE TO TELL APART. Somebody took that "
 + "person off; sending to the dashboard's address instead is the "
 + "application overruling a decision. The variable is deliberately SET "
 + "here -- with it unset, falling back and not falling back both come out "
 + "empty and this check would prove nothing");

t("and it says how many are on the list but not active", async () => {
  const r = await mailList(
    db([row("gone@larabeehomesllc.com", { ends_on: "2026-01-01" }),
        row("soon@larabeehomesllc.com", { starts_on: "2026-12-01" })]),
    "invoices", DASHBOARD, TODAY);
  return r.waiting === 2;
}, "a list that looks empty and can be explained beats one that is merely "
 + "empty");

/* ------------------------------------------------------------ the dates */

t("somebody starting next month gets nothing yet", async () => {
  const r = await mailList(
    db([row("now@larabeehomesllc.com"),
        row("soon@larabeehomesllc.com", { starts_on: "2026-12-01" })]),
    "invoices", null, TODAY);
  return r.to.length === 1 && r.to[0] === "now@larabeehomesllc.com";
});

t("somebody starting today does get it", async () => {
  const r = await mailList(
    db([row("today@larabeehomesllc.com", { starts_on: TODAY })]),
    "invoices", null, TODAY);
  return r.to.length === 1;
}, "a start date is the day they begin, not the day after");

t("an end date is the day they stop, not their last day", async () => {
  const sameDay = await mailList(
    db([row("x@y.com", { ends_on: TODAY })]), "invoices", null, TODAY);
  const dayAfter = await mailList(
    db([row("x@y.com", { ends_on: "2026-11-13" })]), "invoices", null, TODAY);
  return sameDay.to.length === 0 && dayAfter.to.length === 1;
}, "asked both ways round, because either answer alone is consistent with "
 + "the comparison being < or <=");

/* --------------------------------------------- a read that failed is not nobody */

t("a database that errors is raised, not reported as an empty list",
  async () => {
    try {
      await mailList(db(null, { message: "connection refused" }),
        "invoices", DASHBOARD, TODAY);
      return false;
    } catch (e) { return /connection refused/.test(e.message); }
  },
  "returning nobody would drop the email silently, and falling back would "
  + "send a bookkeeper's invoice to whoever a stale dashboard names on a "
  + "morning the database was unreachable");

/* ------------------------------------------------------------ source rules */

const invoice = readFileSync(
  join(lib, "..", "app/api/jobs/link/[token]/invoice/route.ts"), "utf8");
const setup = readFileSync(join(lib, "setup-check.ts"), "utf8");

const running = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

t("nothing reads the old setting except as the fallback argument", () => {
  const guilty = [invoice, setup].filter((src) =>
    running(src).split("\n").some((l) =>
      /process\.env\.BOOKKEEPER_EMAIL/.test(l) && !/mailList\(/.test(l)));
  return guilty.length === 0;
}, "comments stripped first -- a file explaining the variable reads the "
 + "same as a file depending on it");

t("the invoice route asks the list for 'invoices'", () => {
  return /mailList\(\s*db\s*,\s*"invoices"/.test(invoice);
}, "anchored on the call, not on the word appearing somewhere in the file");

t("a list that could not be read does not report the invoice as emailed", () => {
  /* Cut to the try block rather than searching the file: a `catch` anywhere
     else would answer for this one, which is the fault that let a sign-off
     reaching every person's shifts pass a check anchored six hundred
     characters downstream. */
  const at = running(invoice).indexOf("mailList(");
  if (at < 0) return false;
  const around = running(invoice).slice(Math.max(0, at - 200), at + 400);
  return /try\s*\{/.test(around) && /catch/.test(around)
      && /let to: string\[\] = \[\]/.test(running(invoice));
}, "the invoice is already saved and the vendor already told it was, so a "
 + "failure here must skip the send -- not throw away the submission, and "
 + "not mark the row emailed");

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
