/**
 * The stage column, run rather than read.
 *  Run:  node lib/__fixtures__/stage-check.mjs
 *
 * Skips where there is no postgres, the way photo-check.mjs does.
 *
 * The one line that matters here cannot be checked by reading it. The whole
 * design of 049 rests on a claim about Postgres:
 *
 *     alter table inquiries add column stage inquiry_stage;   -- no default
 *     alter table inquiries alter column stage set default 'new';
 *
 * that an existing row is left NULL and only later inserts get 'new'. If that
 * is wrong -- if the second statement backfills -- then every lead already on
 * file is relabelled "nobody has answered this person", which is a false
 * statement about work somebody did and is the one that decides who gets rung
 * this afternoon. One `add column ... default 'new'` instead, and the whole
 * honesty of the thing is gone with nothing on screen to say so.
 *
 * So it is asked of a real database, with a row already in the table.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = join(here, "..", "..", "..", "..", "docs", "shared-line",
  "049-where-we-are-with-this-person.sql");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(SQL)) {
  console.log("skipped: no postgres here to run the migration against.");
  process.exit(0);
}

const PORT = "55441";
const dir = mkdtempSync(join(tmpdir(), "stage-check-"));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
const asPg = (line) => {
  try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
  catch { return ["sh", ["-c", line]]; }
};

const checks = [];
const t = (name, ok, why) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok, why]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

try {
  run("chmod", ["777", dir]);
  run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
  run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start`));
  await new Promise((r) => setTimeout(r, 1500));

  const psql = (db, sql) => run("psql",
    ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", db, "-tAc", sql]).trim();
  const takes = (db, sql) => {
    try { psql(db, sql); return true; }
    catch (e) { return !String(e.stderr ?? e).includes("ERROR"); }
  };

  /** Applied, and whether it went in -- NAMED rather than thrown. A migration
   *  that will not apply is the most important failure this harness can
   *  report, and in 036 it was the one case that took the whole run down as
   *  "the harness fell over" instead of naming it. */
  const apply = (db) => {
    try {
      run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", db,
                   "-q", "-v", "ON_ERROR_STOP=1", "-f", SQL]);
      return null;
    } catch (e) {
      return String(e.stderr ?? e.message ?? e).split("\n")
        .find((l) => l.includes("ERROR")) ?? "it would not apply";
    }
  };

  /* `inquiries` as 037 left it -- only the columns this migration touches or
     reads, plus the outcome the partial index is built on. */
  const BASE = `
    create type inquiry_outcome as enum ('open','leased_with_us','unknown');
    create table inquiries (
      id uuid primary key default gen_random_uuid(),
      contact_id uuid not null,
      inquired_at timestamptz not null default now(),
      outcome inquiry_outcome not null default 'open'
    );
    insert into inquiries (contact_id) values
      ('11111111-1111-1111-1111-111111111111');`;

  psql("postgres", "create database a;");
  psql("a", BASE);

  t("before 049 there is no stage to set",
    !takes("a", "update inquiries set stage = 'new';"),
    "If this works, the column already exists and the rest checks nothing.");

  {
    const why = apply("a");
    t("049 applies", why === null, why);
  }
  {
    // A migration is pasted into the SQL editor more than once.
    const why = apply("a");
    t("and applies a second time unchanged", why === null, why);
  }

  /* ---- the claim the design rests on ---- */

  t("THE ROW THAT WAS ALREADY THERE IS LEFT NULL, not relabelled 'new'",
    psql("a", "select coalesce(stage::text,'<null>') from inquiries;") === "<null>",
    "An `add column ... default 'new'` would have backfilled it, and every"
    + " answered lead on file would now read as unanswered.");

  t("and its stage_at is null too, so nothing is 'waiting' from a made-up date",
    psql("a", "select coalesce(stage_at::text,'<null>') from inquiries;") === "<null>");

  psql("a", "insert into inquiries (contact_id) values ('22222222-2222-2222-2222-222222222222');");
  t("a row inserted AFTER the migration starts at 'new'",
    psql("a", "select stage from inquiries where contact_id"
      + " = '22222222-2222-2222-2222-222222222222';") === "new");
  t("and gets a stage_at it can be measured from",
    psql("a", "select stage_at is not null from inquiries where contact_id"
      + " = '22222222-2222-2222-2222-222222222222';") === "t");

  /* ---- the enum is the guard, so a typo is refused by the database ---- */

  t("every stage the application knows is accepted",
    ["new", "replied", "tour_booked", "toured", "applied", "approved"]
      .every((s) => takes("a", `update inquiries set stage = '${s}';`)));
  t("a stage nobody defined is refused",
    !takes("a", "update inquiries set stage = 'probably_fine';"));
  t("and 'leased' is NOT a stage: that is an outcome, in one column only",
    !takes("a", "update inquiries set stage = 'leased';"));

  /* ---- applying to a database that never had the old rows ---- */

  psql("postgres", "create database b;");
  psql("b", BASE.replace(/insert into inquiries[\s\S]*?;\s*$/, ""));
  {
    const why = apply("b");
    t("it applies to a database with no inquiries at all", why === null, why);
  }
  t("the partial index is there for the board to sort on",
    psql("b", "select count(*) from pg_indexes where indexname"
      + " = 'inquiries_stage_idx';") === "1");

} catch (e) {
  checks.push(["the harness ran at all", false,
    String(e.stderr ?? e.message ?? e).split("\n").slice(0, 3).join(" | ")]);
} finally {
  try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -m immediate stop`)); } catch { /* going anyway */ }
  rmSync(dir, { recursive: true, force: true });
}

let failed = 0;
for (const [n, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${n}${!ok && why ? `\n      ${why}` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
