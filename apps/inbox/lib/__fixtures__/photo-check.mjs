/**
 * A photograph with no words is a whole message.
 *
 * 013 made `dm_messages.body` a column that must say something. 027
 * added `media_paths` and the screen started saying a screenshot is a
 * message on its own -- and nobody came back to the constraint. So
 * dragging a photo into a team chat hit:
 *
 *     new row for relation "dm_messages" violates check constraint
 *     "dm_messages_body_check"
 *
 * 036 replaces it with the rule that was always meant: the MESSAGE must
 * say something, and a photograph says plenty.
 *
 *     node lib/__fixtures__/photo-check.mjs
 *
 * This runs the migration against a real Postgres rather than reading
 * it: the trap in the one line that matters is that `array_length` of
 * an empty array is null and not zero, and no amount of looking at the
 * SQL tells you whether it was fallen into. Skips where there is no
 * postgres to run against, the way the picture harnesses skip without
 * a browser.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = join(here, "..", "..", "..", "..", "docs", "shared-line",
  "036-a-photo-is-a-message.sql");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(SQL)) {
  console.log("skipped: no postgres here to run the migration against.");
  process.exit(0);
}

const PORT = "55437";
const dir = mkdtempSync(join(tmpdir(), "photo-check-"));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
// initdb refuses to run as root, so this goes through the postgres user
// where there is one -- which is the case in this container and on a
// developer's machine alike.
const asPg = (line) => {
  try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
  catch { return ["sh", ["-c", line]]; }
};

let failed = 0;
const checks = [];
const t = (name, ok, why) => checks.push([name, ok, why]);

try {
  run("chmod", ["777", dir]);
  run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
  run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start`));
  await new Promise((r) => setTimeout(r, 1500));

  const psql = (db, sql) => run("psql",
    ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", db, "-tAc", sql]);
  /** Does this statement go in, or is it refused? */
  const takes = (db, sql) => {
    try { psql(db, sql); return true; }
    catch (e) { return String(e.stderr ?? e).includes("ERROR") ? false : true; }
  };

  const BASE = (withMedia) => `
    create table dm_threads (id uuid primary key default gen_random_uuid());
    create table dm_messages (
      id uuid primary key default gen_random_uuid(),
      thread_id uuid not null references dm_threads(id) on delete cascade,
      body text not null check (length(trim(body)) > 0),
      created_at timestamptz not null default now()
    );
    ${withMedia
      ? "alter table dm_messages add column media_paths text[] not null default '{}';"
      : ""}
    insert into dm_threads (id) values ('11111111-1111-1111-1111-111111111111');`;
  const T = "11111111-1111-1111-1111-111111111111";
  const photo = (body, media) =>
    `insert into dm_messages (thread_id, body${media ? ", media_paths" : ""})`
    + ` values ('${T}','${body}'${media ? `,'{${media}}'` : ""});`;

  // ---- a database with 027 run ----------------------------------------
  psql("postgres", "create database a;");
  psql("a", BASE(true));
  t("before 036, a photo with no words is refused",
    !takes("a", photo("", "dm/t/a/0.jpg")),
    "If this goes in, the bug being fixed is not present and the rest "
    + "of this harness is checking nothing.");

  /** Applied, and whether it went in -- named rather than thrown.
   *  A migration that will not apply is the most important failure this
   *  harness can report, and it was the one case that took the whole run
   *  down with it instead. */
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
  {
    const why = apply("a");
    t("036 applies", why === null, why);
  }
  {
    const why = apply("a");
    t("and replays without complaint", why === null, why);
  }

  t("a photo with no words goes in", takes("a", photo("", "dm/t/a/0.jpg")));
  t("a photo with words goes in", takes("a", photo("look", "dm/t/a/1.jpg")));
  t("words with no photo still go in", takes("a", photo("just words", "")));
  t("neither is still refused", !takes("a", photo("", "")),
    "An empty message is still nothing, and nothing is not a message.");
  t("whitespace alone is still refused", !takes("a", photo("   ", "")),
    "`length(trim(body)) > 0` is the half of the old rule worth keeping.");
  t("whitespace with a photo goes in", takes("a", photo("   ", "dm/t/a/2.jpg")));

  // The trap. `array_length('{}', 1)` is null, not 0, so a constraint
  // written without the coalesce is null for every wordless message --
  // and a CHECK that evaluates to null PASSES, which would have let the
  // empty ones through while looking correct.
  const def = psql("a", "select pg_get_constraintdef(oid) from pg_constraint"
    + " where conrelid='dm_messages'::regclass and contype='c';").trim();
  t(`the array length is coalesced (${def.includes("COALESCE") ? "yes" : "no"})`,
    /COALESCE/i.test(def),
    "array_length of an empty array is null, a null CHECK passes, and "
    + "every empty message would have gone in.");

  // ---- a database where 027 was never run ------------------------------
  psql("postgres", "create database b;");
  psql("b", BASE(false));
  {
    const why = apply("b");
    t("036 applies where media_paths does not exist", why === null,
      `${why ?? ""} — a database behind on its migrations must not be `
      + "unable to move.");
  }
  t("and words still work there", takes("b", photo("hello", "")));
  t("and empty is still refused there", !takes("b", photo("", "")));
  const defB = psql("b", "select pg_get_constraintdef(oid) from pg_constraint"
    + " where conrelid='dm_messages'::regclass and contype='c';").trim();
  t("without the column, the rule stays as it was",
    !/media_paths/.test(defB), defB);
} catch (e) {
  console.error("FAIL  the harness itself fell over");
  console.error(String(e.stderr ?? e.message ?? e).slice(0, 800));
  failed = 1;
} finally {
  try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d stop -m immediate`)); } catch { /* going anyway */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* fine */ }
}

for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} wrong` : "\nnothing obviously wrong");
process.exit(failed ? 1 : 0);
