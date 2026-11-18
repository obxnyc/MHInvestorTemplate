/**
 * Rent Manager knows which requests are finished. Nothing ever asked.
 *
 *     node lib/__fixtures__/rm-close-check.mjs
 *
 * The owner looked at his Messages queue and asked whether prospects would
 * get lost among the maintenance. 319 threads, 315 of them maintenance.
 *
 * His real list is SEVEN. 307 of those 315 arrived in one batch 15-30 days
 * ago -- the October import of eight months of Rent Manager history -- and
 * every one of them was filed open. The live rate is about four a week.
 *
 * `IsClosed` has been read off every record since the deep probe settled
 * the field names, and then dropped on the floor. `readIssue` puts it in
 * `issue.closed`; nothing read it. So the import could only ever open
 * things, and a job finished in March sat in the queue looking like work.
 *
 * Closing them by hand would be guessing which are dead. The pull
 * reconciles instead: Rent Manager is the system of record for an issue's
 * status, and it has known all along.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");

const src = readFileSync(join(lib, "rm-issues.ts"), "utf8");
const gen = join(here, "rm-close.gen.mjs");
writeFileSync(gen, ts.transpileModule(
  src.replace(/^import\b[\s\S]*?from\s*"[^"]*";/gm, ""),
  { compilerOptions: { target: 99, module: 99 } }).outputText);
const { closePatch } = await import(gen);

const checks = [];
const t = (name, fn, why) => checks.push([name, fn, why]);

/* ------------------------------------------------- what gets recorded */

t("the close is dated when RENT MANAGER closed it", () =>
  closePatch({ closedOn: "2026-03-14T10:00:00Z", resolution: null })
    .closed_at === "2026-03-14T10:00:00Z",
  "THE WHOLE REASON THIS IS A FUNCTION. Stamping the import's own moment "
  + "would make a job finished in March look finished today -- the same "
  + "fault as eight months of history arriving at the top of the inbox "
  + "reading 'just now'");

t("and when it did not say, today is the honest answer", () => {
  const at = closePatch({ closedOn: null, resolution: null }).closed_at;
  return typeof at === "string" && Math.abs(Date.now() - Date.parse(at)) < 5000;
}, "a close with no date at all cannot be ordered against anything");

t("an empty date string is not a date", () =>
  Math.abs(Date.now() - Date.parse(closePatch({ closedOn: "", resolution: null })
    .closed_at)) < 5000,
  "`||` and not `??` on purpose: rmAPI hands back an empty string as "
  + "readily as a null, and `??` would pass the empty one straight through "
  + "to a timestamp column");

t("the resolution is what it says", () =>
  closePatch({ closedOn: null, resolution: "Replaced the flapper valve" })
    .closed_reason === "Closed in Rent Manager: Replaced the flapper valve");

t("and where it is on the record", () =>
  closePatch({ closedOn: null, resolution: null })
    .closed_reason === "Closed in Rent Manager",
  "a thread that just says 'closed' is one somebody reopens to find out why");

t("a very long resolution cannot overflow the column", () =>
  closePatch({ closedOn: null, resolution: "x".repeat(900) })
    .closed_reason.length <= 500);

t("it closes", () =>
  closePatch({ closedOn: null, resolution: null }).status === "closed");

/* --------------------------------------------------- how it is wired */

const running = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

t("the pull asks whether each issue is closed", () =>
  /if\s*\(issue\.closed\)/.test(running),
  "read off every record since the deep probe, and dropped on the floor "
  + "until today");

t("IT ASKS FOR ISSUES WE ALREADY HAD, not only for new ones", () => {
  /* `ingest` returns early on an external_id it has seen, so a close done
     inside the new-row branch would reconcile NOTHING in the backlog --
     which is the entire 307. Cut to the close and check what encloses it. */
  const at = running.indexOf("if (issue.closed)");
  if (at < 0) return false;
  const before = running.slice(0, at);
  const lastDup = before.lastIndexOf("res.duplicate");
  if (lastDup < 0) return true;
  /* Everything between the duplicate test and the close must have shut its
     braces: the close may not sit inside that branch. */
  const between = before.slice(lastDup);
  let depth = 0;
  for (const ch of between) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  return depth <= 0;
}, "THE ONE THAT IS EASY TO GET WRONG. The 307 in the backlog are all "
 + "duplicates to `ingest`; closing only new rows would reconcile none of "
 + "them and read as working, because new closed issues would still close");

t("it finds the thread through the message that carries the id", () => {
  const at = running.indexOf("if (issue.closed)");
  const around = running.slice(at, at + 700);
  return /from\("messages"\)/.test(around)
      && /external_id/.test(around)
      && !/conversations"\)[\s\S]{0,80}eq\("external/.test(around);
}, "`conversations` has no external key -- the first version invented one "
 + "and would have matched nothing, closing nothing, silently");

t("only a thread that is OPEN here is touched", () => {
  const at = running.indexOf("if (issue.closed)");
  return /\.eq\("status",\s*"open"\)/.test(running.slice(at, at + 900));
}, "re-running the pull must not keep rewriting closed_at on threads that "
 + "were already shut, and must not overwrite the date somebody here set");

t("an issue Rent Manager still has open does not REOPEN it here", () => {
  const at = running.indexOf("if (issue.closed)");
  const around = running.slice(at, at + 900);
  return !/status:\s*"open"/.test(around) && !/\belse\b/.test(around.slice(0, 40));
}, "one direction only. A request closed in this office was closed by "
 + "somebody who decided that, and `closeIssue` is what pushes it the "
 + "other way");

t("a close that failed does not abandon the pull", () => {
  const at = running.indexOf("if (issue.closed)");
  return /closeError/.test(running.slice(at, at + 900));
}, "one unwritable close is not a reason to stop filing the rest");

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
