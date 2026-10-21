/** What the hosting plan will actually accept.  Run: node lib/__fixtures__/plan-check.mjs
 *
 *  This exists because the lesson was already written down and shipped
 *  anyway. CLAUDE.md says, in so many words, that a Hobby cron fires once a
 *  day whatever the expression asks for and that a more frequent one "can
 *  fail the deployment" -- and the very next thing committed was
 *  `15 * * * *`, hourly, which fails it.
 *
 *  Every deployment for a day was refused. Twelve commits of work sat on
 *  main while the live site served the build from before them, and nothing
 *  from this end could tell: a merge that shipped and a merge that was
 *  refused are the same thing here.
 *
 *  A rule a person has to remember is a rule that gets forgotten. This one
 *  is in the suite.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const vercel = JSON.parse(readFileSync(join(here, "..", "..", "vercel.json"), "utf8"));

/** The plan this project is on. One word, and it decides the rest. */
const PLAN = "hobby";

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

/**
 * Does this expression fire at most once a day?
 *
 * Only if BOTH the minute and the hour are single fixed numbers. A star, a
 * step, a list or a range in either field means more than one firing, and
 * Vercel refuses the whole deployment rather than clamping it.
 */
const atMostDaily = (expr) => {
  const [min, hour] = String(expr).trim().split(/\s+/);
  const fixed = (f) => /^\d{1,2}$/.test(f ?? "");
  return fixed(min) && fixed(hour);
};

t("vercel.json has crons to check", () => Array.isArray(vercel.crons) && vercel.crons.length > 0);
t("every cron has a path and a schedule",
  () => vercel.crons.every((c) => c.path && c.schedule));

for (const c of vercel.crons ?? []) {
  t(`${c.path} fires at most once a day, which is all ${PLAN} allows`,
    () => PLAN !== "hobby" || atMostDaily(c.schedule));
}

// The reader itself, because a rule that answers "yes" to everything is not
// a rule. Each of these is a real expression somebody would write.
t("hourly is caught", () => !atMostDaily("15 * * * *"));
t("every fifteen minutes is caught", () => !atMostDaily("0,15,30,45 * * * *"));
t("a stepped minute is caught", () => !atMostDaily("0/15 9 * * *"));
t("every four hours is caught", () => !atMostDaily("0 0-23/4 * * *"));
t("twice a day is caught", () => !atMostDaily("0 9,17 * * *"));
t("an hour range is caught", () => !atMostDaily("0 9-17 * * *"));
t("a plain daily time passes", () => atMostDaily("15 11 * * *"));
t("midnight passes", () => atMostDaily("0 0 * * *"));
t("a weekly one passes, because it is daily or rarer",
  () => atMostDaily("0 9 * * 1"));
t("rubbish does not pass", () => !atMostDaily("") && !atMostDaily("every hour"));

// When the plan changes, this file is the thing that has to be told -- so it
// says so out loud rather than quietly letting everything through.
t("the plan is named here so changing it is a deliberate edit",
  () => ["hobby", "pro", "enterprise"].includes(PLAN));

t("a throwing check is named, not fatal", () => { throw new Error("on purpose"); });
if (checks.pop()[0] !== "a throwing check is named, not fatal") {
  console.log("FAIL  the harness does not catch a throwing check");
  process.exit(1);
}

let failed = 0;
for (const [n, ok, note] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${n}${note ? ` (${note})` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
