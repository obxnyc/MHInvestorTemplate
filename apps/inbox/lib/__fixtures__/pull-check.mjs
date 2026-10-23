/** Migration 042, run rather than read.
 *
 *  The question reading cannot settle: several people open the inbox at the
 *  same moment. "When did it last run, and should I run?" asked as two
 *  statements is a race the width of a round trip -- three browsers read the
 *  same stale timestamp, all three decide yes, and Rent Manager gets three
 *  identical pulls. The claim has to be one statement, and whether it really
 *  is can only be answered by two connections trying it at once.
 */
import { execFileSync, exec } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = join(here, "..", "..", "..", "..", "docs", "shared-line",
  "042-pull-when-somebody-looks.sql");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(SQL)) {
  console.log("skipped: no postgres here to run the migration against.");
  process.exit(0);
}

const PORT = "55443";
const dir = mkdtempSync(join(tmpdir(), "pull-check-"));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
const asPg = (line) => {
  try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
  catch { return ["sh", ["-c", line]]; }
};

const checks = [];
const t = (name, fn) => {
  try { checks.push([name, Boolean(fn())]); }
  catch (e) {
    const why = String(e.stderr ?? e.message ?? e).replace(/\s+/g, " ").trim();
    checks.push([name, false, why.slice(0, 150)]);
  }
};
const ta = async (name, fn) => {
  try { checks.push([name, Boolean(await fn())]); }
  catch (e) {
    const why = String(e.stderr ?? e.message ?? e).replace(/\s+/g, " ").trim();
    checks.push([name, false, why.slice(0, 150)]);
  }
};

try {
  run("chmod", ["777", dir]);
  run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
  run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start`));
  await new Promise((r) => setTimeout(r, 1500));

  // psql prints a command tag after a returned value, so take the first line.
  const psql = (sql) => run("psql",
    ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t", "-tAc", sql])
    .split("\n")[0].trim();

  run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres",
    "-c", "create database t"]);

  /* The migration calls is_active_staff(), which lives in an earlier one. A
     function that is not there is a migration that will not apply, not a
     policy that misbehaves later -- which is the lesson 038 taught. */
  psql(`
    create role authenticated;
    create role anon;
    create or replace function is_active_staff() returns boolean
      language sql stable as $$ select true $$;
  `);

  t("042 applies", () => {
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
      "-v", "ON_ERROR_STOP=1", "-f", SQL]);
    return true;
  });
  t("and replays without complaint", () => {
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
      "-v", "ON_ERROR_STOP=1", "-f", SQL]);
    return true;
  });
  t("there is exactly one row, after running it twice", () =>
    psql("select count(*) from rm_issue_pulls") === "1");

  const claim = (stale = 5, dead = 5) =>
    psql(`select claim_issue_pull(${stale}, ${dead})`);

  t("nothing has ever pulled, so the first caller may", () => claim() === "t");

  /* The one the lock exists for: a pull is in flight and has not timed out. */
  t("a second caller while the first is still running is refused",
    () => claim() === "f");

  t("once it has finished, a caller inside the window is still refused", () => {
    psql("select finish_issue_pull(true, 3, null)");
    return claim(5, 5) === "f";
  });

  t("and a caller outside the window may pull", () => claim(0, 5) === "t");

  /* A function killed at the plan's sixty-second ceiling never writes its
     finish. Without the dead-run clause the lock is held forever by a run
     that is not happening, and nothing pulls again until somebody notices. */
  t("a pull that started and never finished does not hold the lock forever", () => {
    psql(`update rm_issue_pulls
            set started_at = now() - interval '30 minutes', finished_at = null`);
    return claim(5, 10) === "t";
  });
  t("but it does hold it while it could still be running", () => {
    psql(`update rm_issue_pulls
            set started_at = now() - interval '30 seconds', finished_at = null`);
    return claim(5, 10) === "f";
  });

  t("how it went is recorded, so 'is this up to date' has an answer", () => {
    psql("select finish_issue_pull(false, 0, 'rent manager said no')");
    return psql(`select ok::text || ' ' || coalesce(error,'-') from rm_issue_pulls`)
      === "false rent manager said no";
  });

  /* ------------------------------------------- the race, on two connections */

  await ta("two callers at the same instant: exactly one wins", async () => {
    psql(`update rm_issue_pulls set started_at = null, finished_at = null`);
    /* Both sessions start a transaction, both run the claim, and both commit.
       On one connection the second simply sees the first's work and refuses,
       which proves nothing about concurrency -- so they are held open at the
       same time and released together. */
    const one = (tag) => new Promise((res) => {
      exec(`psql -h /tmp -p ${PORT} -U postgres -d t -tAc `
        + `"begin; select pg_sleep(0.3); select claim_issue_pull(60, 60); commit;"`,
        (_e, stdout) => res(`${tag}:${stdout.replace(/\s+/g, " ").trim()}`));
    });
    const got = await Promise.all([one("a"), one("b")]);
    const wins = got.filter((g) => /\bt\b/.test(g)).length;
    if (wins !== 1) console.error("   both said:", got.join(" | "));
    return wins === 1;
  });
} finally {
  try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -m immediate stop`)); } catch { /* going anyway */ }
  rmSync(dir, { recursive: true, force: true });
}

/* ------------------------------------------------------ the route's own rule
 *
 * A FAILURE THAT IS NOT WRITTEN LEAVES THE ROW CLAIMED. If the route returns
 * early on an error without finishing the pull, the lock is held until the
 * dead window passes -- so a Rent Manager that is simply down stops the inbox
 * pulling at all rather than retrying in five minutes. The database cannot
 * see that mistake; only the shape of the route can.
 */
{
  const src = readFileSync(join(here, "..", "..", "app", "api", "rentmanager",
    "issues", "auto", "route.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  t("the pull is wrapped so a throw cannot skip the finish", () => {
    const tryAt = src.indexOf("try {");
    /* The CALL, not the name. `pullServiceIssues` appears in the import at
       the top of the file, which is before every `try` in it -- so anchoring
       on the word reported the pull as unwrapped when it was wrapped. Third
       time this exact shape has cost a round here. */
    const pullAt = src.indexOf("pullServiceIssues({");
    const finishAt = src.indexOf("finish_issue_pull");
    const catchAt = src.indexOf("} catch");
    return tryAt >= 0 && tryAt < pullAt && pullAt < catchAt && catchAt < finishAt;
  });
  t("and there is no way out between claiming and finishing", () => {
    const claimAt = src.indexOf("claim_issue_pull");
    const finishAt = src.indexOf("finish_issue_pull");
    const between = src.slice(claimAt, finishAt);
    /* One early return is allowed and required -- the one that bows out
       because somebody ELSE holds the claim, which must not write a finish
       over their run. Any other is a claim nobody releases. */
    const returns = [...between.matchAll(/\breturn\b/g)].length;
    return returns === 2;
  });
}

let failed = 0;
for (const [name, ok, why] of checks) {
  if (ok) console.log(` ok  ${name}`);
  else { failed++; console.error(` ✗  ${name}${why ? ` -- ${why}` : ""}`); }
}
if (failed) process.exit(1);
console.log("only one pull runs, however many people open the inbox");
