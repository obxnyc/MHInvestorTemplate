/** Migration 043, run rather than read.
 *
 *  The thing reading cannot settle is what happens to the rows it does NOT
 *  mean to touch: a text message in the same thread, a Rent Manager row whose
 *  body carries no readable date, one that carries something that is not a
 *  date at all. A migration that will not apply is the most expensive failure
 *  here, and a `::timestamptz` cast on a body somebody typed into is exactly
 *  how that happens.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = join(here, "..", "..", "..", "..", "docs", "shared-line",
  "043-put-the-backfill-back-in-the-past.sql");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(SQL)) {
  console.log("skipped: no postgres here to run the migration against.");
  process.exit(0);
}

const PORT = "55447";
const dir = mkdtempSync(join(tmpdir(), "backfill-check-"));
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

try {
  run("chmod", ["777", dir]);
  run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
  run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start`));
  await new Promise((r) => setTimeout(r, 1500));

  const psql = (sql) => run("psql",
    ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t", "-tAc", sql])
    .split("\n")[0].trim();

  run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres",
    "-c", "create database t"]);

  const FROM_RM = "\nFrom Rent Manager Service Manager, issue 41.";
  psql(`
    create table conversations (id uuid primary key default gen_random_uuid(),
      last_message_at timestamptz not null default now());
    create table messages (id uuid primary key default gen_random_uuid(),
      conversation_id uuid not null references conversations(id) on delete cascade,
      body text, created_at timestamptz not null default now());

    insert into conversations (id) values
      ('00000000-0000-0000-0000-00000000000a'),   -- a plain old backfill
      ('00000000-0000-0000-0000-00000000000b'),   -- backfill + a later text
      ('00000000-0000-0000-0000-00000000000c'),   -- body has no date
      ('00000000-0000-0000-0000-00000000000d'),   -- body has junk where the date goes
      ('00000000-0000-0000-0000-00000000000e');   -- nothing to do with Rent Manager

    insert into messages (conversation_id, body) values
      ('00000000-0000-0000-0000-00000000000a',
       'Issue: Leak' || chr(10) || 'Submitted: 2026-03-14T09:12:00' || '${FROM_RM}'),
      ('00000000-0000-0000-0000-00000000000b',
       'Issue: Door' || chr(10) || 'Submitted: 2026-03-15T08:00:00' || '${FROM_RM}'),
      ('00000000-0000-0000-0000-00000000000c',
       'Issue: No date here' || '${FROM_RM}'),
      ('00000000-0000-0000-0000-00000000000d',
       'Issue: Junk' || chr(10) || 'Submitted: whenever he gets round to it' || '${FROM_RM}'),
      ('00000000-0000-0000-0000-00000000000e', 'my pipes are overflowing');

    -- A thread whose stored date is OLDER than its newest message. The only
    -- case where "never move forward" is the rule that answers: without it
    -- this thread jumps to today. With the clause in place it does not move,
    -- because putting the backfill back is a job that only ever moves things
    -- BACK, and a date that is wrong forwards is somebody else's migration.
    insert into conversations (id, last_message_at) values
      ('00000000-0000-0000-0000-00000000000f', now() - interval '20 days');
    insert into messages (conversation_id, body, created_at) values
      ('00000000-0000-0000-0000-00000000000f',
       'Issue: Old' || chr(10) || 'Submitted: 2026-03-01T10:00:00' || '${FROM_RM}',
       now()),
      -- A plain text, today, which nothing re-dates. It is what makes this
      -- thread's newest message NEWER than its stored date -- the only shape
      -- in which "never move forward" is the rule that decides. Built the
      -- first time without it, the Rent Manager message was simply re-dated
      -- to March and the thread moved BACK, which is the migration working
      -- rather than the rule being tested.
      ('00000000-0000-0000-0000-00000000000f', 'still waiting', now());

    -- The later text on thread b, two days ago. NOT now(): with it at now()
    -- the thread's right answer and its wrong answer are both "today", and
    -- the check cannot tell a rule that fired from one that did not.
    insert into messages (conversation_id, body, created_at) values
      ('00000000-0000-0000-0000-00000000000b', 'any update on my door?',
       now() - interval '2 days');
  `);

  /* THE MOST IMPORTANT FAILURE A HARNESS CAN REPORT is a migration that will
     not apply -- and a cast over a body somebody typed into is exactly where
     that happens. Named, rather than left to throw. */
  t("043 applies, with junk where a date should be", () => {
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
      "-v", "ON_ERROR_STOP=1", "-f", SQL]);
    return true;
  });

  const at = (c) => psql(`select to_char(last_message_at,'YYYY-MM-DD')
    from conversations where id = '00000000-0000-0000-0000-00000000000${c}'`);

  t("a backfilled request goes back to the day it was submitted",
    () => at("a") === "2026-03-14");

  /* A thread follows its NEWEST message, not the backfilled one. The tenant
     chased this two days ago; burying the thread under a March date would
     hide a conversation somebody is still having. March is the wrong answer
     here and so is today -- which is why the text is dated two days back
     rather than now. */
  t("a thread with a text in it follows the text, not the old request", () => {
    const want = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
    return at("b") === want;
  });

  t("a body with no date is left exactly as it was",
    () => at("c") === new Date().toISOString().slice(0, 10));
  t("and so is one whose date is not a date",
    () => at("d") === new Date().toISOString().slice(0, 10));
  t("something that never came from Rent Manager is not touched",
    () => at("e") === new Date().toISOString().slice(0, 10));

  t("a thread is only ever moved BACK, never forward", () => {
    const want = new Date(Date.now() - 20 * 86400e3).toISOString().slice(0, 10);
    return at("f") === want;
  });

  t("the message itself carries the real date too, not just the thread", () =>
    psql(`select to_char(created_at,'YYYY-MM-DD') from messages
           where conversation_id = '00000000-0000-0000-0000-00000000000a'`)
      === "2026-03-14");

  /* Running it again must change nothing. A second apply that moved rows
     further would be a migration nobody could run safely. */
  t("replaying it changes nothing", () => {
    const before = psql("select md5(string_agg(id::text || created_at::text, ',' order by id)) from messages");
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
      "-v", "ON_ERROR_STOP=1", "-f", SQL]);
    const after = psql("select md5(string_agg(id::text || created_at::text, ',' order by id)) from messages");
    return before === after;
  });
} finally {
  try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -m immediate stop`)); } catch { /* going anyway */ }
  rmSync(dir, { recursive: true, force: true });
}

let failed = 0;
for (const [name, ok, why] of checks) {
  if (ok) console.log(` ok  ${name}`);
  else { failed++; console.error(` ✗  ${name}${why ? ` -- ${why}` : ""}`); }
}
if (failed) process.exit(1);
console.log("the backfill sits where it actually happened");
