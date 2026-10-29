/**
 * The migration runner, run.
 *
 * It is the thing that will be pointed at the owner's live database, so
 * the questions worth asking are the ones whose wrong answer costs data:
 * does it stop at the first failure, does it leave a half-applied file
 * behind, and does it skip what it has already done.
 *
 *     node lib/__fixtures__/runner-check.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const RUNNER = join(root, "..", "..", "docs", "shared-line", "run.mjs");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(RUNNER)) {
  console.log("skipped: no postgres here to run the runner against.");
  process.exit(0);
}

const PORT = "55491";
const dir = mkdtempSync(join(tmpdir(), "runner-"));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
const asPg = (line) => {
  try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
  catch { return ["sh", ["-c", line]]; }
};

const checks = [];
const t = (name, fn) => {
  try { checks.push([name, fn() === true]); }
  catch (e) {
    const why = String(e.stdout ?? e.stderr ?? e.message ?? e)
      .replace(/\s+/g, " ").trim();
    checks.push([name, false, why.slice(0, 200)]);
  }
};

/* A FOLDER OF ITS OWN, with migrations written here. Pointing it at the
   real ones would make this a test of those rather than of the runner,
   and could not ask what happens when one of them fails. */
const sqlDir = join(dir, "migrations");
mkdirSync(sqlDir, { recursive: true });
const put = (name, body) => writeFileSync(join(sqlDir, name), body);
put("001-first.sql", "create table if not exists one (id int primary key);");
put("002-second.sql", "create table if not exists two (id int primary key);");
put("003-broken.sql",
  "create table if not exists three (id int primary key);\n"
  + "create table three_again (id int references nowhere(id));");
put("004-after.sql", "create table if not exists four (id int primary key);");
// The runner lives beside the migrations, so it gets a copy here.
writeFileSync(join(sqlDir, "run.mjs"), run("cat", [RUNNER]));

try {
  run("chmod", ["777", dir]);
  run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
  run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start`));
  await new Promise((r) => setTimeout(r, 1500));
  run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres",
    "-c", "create database t"]);

  const URL_ = `postgresql://postgres@localhost:${PORT}/t`;
  const psql = (sql) => run("psql",
    ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t", "-tAc", sql])
    .split("\n")[0].trim();
  const runner = (args = []) => run("node",
    [join(sqlDir, "run.mjs"), ...args],
    { env: { ...process.env, DATABASE_URL: URL_, PGSSLMODE: "disable" } });

  /* Supabase needs TLS and a local initdb does not offer it, so the one
     line that differs is patched out for this fixture. Called out rather
     than hidden: it is the single thing here that is not what runs. */
  /* Two lines differ from what ships, and both are called out rather
     than hidden. Supabase requires TLS and a local initdb offers none;
     and the copy sits in a temp folder, so the path it resolves `pg`
     through is pointed back at the real one. */
  writeFileSync(join(sqlDir, "run.mjs"),
    run("cat", [RUNNER])
      .replace("ssl: { rejectUnauthorized: false }", "ssl: false")
      .replace('join(here, "..", "..", "apps", "inbox", "package.json")',
               JSON.stringify(join(root, "package.json"))));

  let out = "";
  t("it stops at the file that fails", () => {
    try { out = runner(); return false; }
    catch (e) { out = String(e.stdout ?? "") + String(e.stderr ?? ""); return true; }
  });
  t("and says which one", () => /003-broken/.test(out));
  t("the ones before it went in",
    () => psql("select count(*) from information_schema.tables"
      + " where table_name in ('one','two')") === "2");
  /* HALF A MIGRATION IS WORSE THAN NONE: the next attempt meets a shape
     neither the old code nor the new one expects. 003 creates a table
     and then fails, so `three` must not be there. */
  t("and nothing from the one that failed",
    () => psql("select count(*) from information_schema.tables"
      + " where table_name = 'three'") === "0");
  t("nor anything after it",
    () => psql("select count(*) from information_schema.tables"
      + " where table_name = 'four'") === "0");

  // Mend it and carry on.
  put("003-broken.sql", "create table if not exists three (id int primary key);");
  t("fixing it and running again picks up where it stopped", () => {
    out = runner();
    return /All applied/.test(out)
      && psql("select count(*) from information_schema.tables"
        + " where table_name in ('three','four')") === "2";
  });
  t("and it did not run the ones it had already done",
    () => !/001-first/.test(out) && !/002-second/.test(out));

  t("running it a third time does nothing at all",
    () => /Nothing to run/.test(runner()));

  t("what has been applied is written down",
    () => psql("select count(*) from schema_migrations") === "4");

  t("and one can be asked for by number", () => {
    const only = runner(["002"]);
    return /002-second/.test(only) && !/001-first/.test(only);
  });

  t("--list says what has run and what has not",
    () => /001-first/.test(runner(["--list"])));

  /* A connection string that is wrong must say so, not hang or throw a
     stack trace at somebody who has just set this up. */
  t("a bad connection string is explained", () => {
    try {
      run("node", [join(sqlDir, "run.mjs")],
        { env: { ...process.env, DATABASE_URL: `postgresql://postgres@localhost:1/nope` } });
      return false;
    } catch (e) {
      const said = String(e.stdout ?? "") + String(e.stderr ?? "");
      return /Could not reach the database/.test(said) && !/at Object\./.test(said);
    }
  });
  t("and no connection string at all is explained", () => {
    try {
      const env = { ...process.env }; delete env.DATABASE_URL;
      run("node", [join(sqlDir, "run.mjs")], { env });
      return false;
    } catch (e) {
      return /DATABASE_URL is not set/.test(String(e.stdout ?? "") + String(e.stderr ?? ""));
    }
  });

  /* ---- the first run against a database that is already in use ----
     The dangerous case, and the one that will actually happen: forty
     migrations applied by hand months ago and nothing written down. */
  run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres",
    "-c", "create database used"]);
  const USED = `postgresql://postgres@localhost:${PORT}/used`;
  const inUsed = (sql) => run("psql",
    ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "used", "-tAc", sql])
    .split("\n")[0].trim();
  inUsed("create table properties (id int primary key)");
  const onUsed = (args2 = []) => run("node", [join(sqlDir, "run.mjs"), ...args2],
    { env: { ...process.env, DATABASE_URL: USED, PGSSLMODE: "disable" } });

  t("it refuses to run everything against a database already in use", () => {
    try { onUsed(); return false; }
    catch (e) {
      const said = String(e.stdout ?? "") + String(e.stderr ?? "");
      return /already has \d+ tables/.test(said) && /--assume/.test(said);
    }
  });
  t("and ran none of them",
    () => inUsed("select count(*) from information_schema.tables"
      + " where table_name in ('one','two','three','four')") === "0");

  t("--assume writes them down without running them", () => {
    const said = onUsed(["--assume", "002"]);
    return /Marked 2/.test(said)
      && inUsed("select count(*) from schema_migrations") === "2"
      && inUsed("select count(*) from information_schema.tables"
        + " where table_name in ('one','two')") === "0";
  });
  t("and the run after it does only what is left", () => {
    const said = onUsed();
    return /All applied/.test(said)
      && !/001-first/.test(said)
      && inUsed("select count(*) from information_schema.tables"
        + " where table_name in ('three','four')") === "2"
      && inUsed("select count(*) from information_schema.tables"
        + " where table_name in ('one','two')") === "0";
  });
  /* NAMING THEM OUTRIGHT IS STILL ALLOWED on a database in use -- that
     is the case the refusal exists to send somebody to. */
  t("naming migrations outright still works on a database in use", () => {
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres",
      "-c", "create database used2"]);
    const U2 = `postgresql://postgres@localhost:${PORT}/used2`;
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "used2",
      "-c", "create table properties (id int primary key)"]);
    const said = run("node", [join(sqlDir, "run.mjs"), "001"],
      { env: { ...process.env, DATABASE_URL: U2, PGSSLMODE: "disable" } });
    return /All applied/.test(said) && !/002-second/.test(said);
  });

} catch (e) {
  const why = String(e.stderr ?? e.message ?? e).replace(/\s+/g, " ").trim();
  checks.push(["the harness ran to the end", false, why.slice(0, 200)]);
} finally {
  try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -m immediate stop`)); } catch { /* down */ }
  rmSync(dir, { recursive: true, force: true });
}

let bad = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${!ok && why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${checks.length}`); process.exit(1); }
console.log("it applies what is missing, stops cleanly, and does not repeat itself");
