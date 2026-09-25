/** Due dates on a job, and the three states a list shows them in.
 *  Run: node lib/__fixtures__/dispatch.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "dispatch.ts"), "utf8")
  .replace(/^import type .*$/gm, "")
  // openWorkOrder and jobsLink need a database; the date logic does not, and it
  // is the part with an opinion worth testing.
  .replace(/^import \{ randomBytes \}.*$/gm, "");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { dueState, dueLabel } = await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (n, ok) => checks.push([n, ok]);

const now = new Date("2026-03-04T12:00:00Z");
const at = (h) => new Date(now.getTime() + h * 3_600_000).toISOString();

t("no date promised is its own state, not 'fine'", dueState(null, now) === "none");
t("a date days out is quiet", dueState(at(72), now) === "later");
t("due tomorrow is the warning", dueState(at(20), now) === "soon");
t("just over a day out is not yet the warning", dueState(at(25), now) === "later");
t("an hour overdue is late", dueState(at(-1), now) === "late");
t("the boundary belongs to 'soon', not 'late'", dueState(at(0), now) === "soon");

// Garbage in a date column must not take a page down. A job with an unreadable
// due date should read as "no date", which is true and harmless.
t("an unparseable date degrades rather than throws", dueState("not a date", now) === "none");
t("undefined is 'none'", dueState(undefined, now) === "none");

// The label has to carry both: the fact, which is what you tell a tenant, and
// how late it is, which is what makes someone act.
t("a promised date is stated plainly", dueLabel(at(48), now).startsWith("Due "));
t("lateness is counted in hours on the first day",
  dueLabel(at(-5), now).startsWith("5h late"));
t("and in days after that", dueLabel(at(-50), now).startsWith("2d late"));
t("a late label still says when it was due",
  dueLabel(at(-50), now).includes("was due"));
t("no date says so in words", dueLabel(null, now) === "No date promised");

// Elizabeth City, not UTC. A job due 9am reads as 9am to the person driving to it.
t("dates read in local time, not the server's",
  dueLabel("2026-03-04T14:00:00Z", now).includes("9:00 AM"));

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
