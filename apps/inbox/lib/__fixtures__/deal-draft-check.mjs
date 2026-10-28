/** Migration 046, run rather than read.
 *
 *  What this table holds is an afternoon of somebody's typing. So the
 *  things worth checking are the ones that would lose it or let the wrong
 *  person change it: a second row for the same investor, a draft that
 *  outlives the investor it belongs to, and a read-only guest writing one
 *  by going round the application.
 *
 *  And the one thing reading cannot answer: whether the file applies at
 *  all. A migration that will not apply is the most important failure a
 *  harness can report, so it is a named check rather than a crash.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = join(here, "..", "..", "..", "..", "docs", "shared-line",
  "046-the-deal-somebody-is-working-on.sql");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(SQL)) {
  console.log("skipped: no postgres here to run the migration against.");
  process.exit(0);
}

const PORT = "55461";
const dir = mkdtempSync(join(tmpdir(), "deal-check-"));
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
    const why = String(e.stderr ?? e.message ?? e).replace(/\s+/g, " ").trim();
    checks.push([name, false, why.slice(0, 160)]);
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
  /* The LAST line, for a read that has a `set role` in front of it: psql
     prints "SET" first and the first-line rule -- which is right for an
     `insert ... returning`, where the command tag comes second -- picks
     that up and compares it to a count. */
  const psqlEnd = (sql) => run("psql",
    ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t", "-tAc", sql])
    .split("\n").map((x) => x.trim()).filter(Boolean).pop() ?? "";
  const refuses = (sql) => { try { psql(sql); return false; } catch { return true; } };

  run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres",
    "-c", "create database t"]);
  /* The roles have to exist first: a GRANT to a role that is not there is
     an error, not a no-op, and the whole migration stops at it. */
  psql(`
    create role authenticated; create role anon;
    create or replace function is_active_staff() returns boolean
      language sql stable as $$ select true $$;
    create table owners (id uuid primary key default gen_random_uuid(), name text);
    create table staff (id uuid primary key default gen_random_uuid(), full_name text);
    -- THE CASE THE REVOKE EXISTS FOR, and it has to be a DEFAULT
    -- privilege. A plain GRANT ALL ON ALL TABLES only reaches ones that
    -- already exist, so handing it over before the migration creates
    -- deal_drafts grants nothing on deal_drafts -- the revoke then has
    -- nothing to take back and the two checks below pass with it
    -- deleted. A project that has set this is the one where the revoke
    -- is the only thing standing between a read-only guest and somebody
    -- else's terms.
    alter default privileges in schema public
      grant all on tables to authenticated;
  `);

  // ---- does it apply at all -----------------------------------------
  let applied = true, why = "";
  try {
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
      "-v", "ON_ERROR_STOP=1", "-f", SQL]);
  } catch (e) {
    applied = false;
    why = String(e.stderr ?? e.message).replace(/\s+/g, " ").trim().slice(0, 200);
  }
  checks.push(["the migration applies", applied, why]);
  if (!applied) throw new Error("stopping: nothing below can be true");

  t("and applies again, because it will be pasted twice", () => {
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
      "-v", "ON_ERROR_STOP=1", "-f", SQL]);
    return true;
  });

  const owner = psql("insert into owners (name) values ('Aldercrest') returning id");
  const other = psql("insert into owners (name) values ('Oak Ridge') returning id");
  const who = psql("insert into staff (full_name) values ('Ben') returning id");

  // ---- one deal per investor ----------------------------------------

  t("a deal can be kept", () => {
    psql(`insert into deal_drafts (owner_id, deal, by_staff)
          values ('${owner}', '{"v":1,"terms":{"ratePct":5.2}}', '${who}')`);
    return psql(`select deal->'terms'->>'ratePct' from deal_drafts
                 where owner_id = '${owner}'`) === "5.2";
  });

  t("a second deal for the same investor is refused", () =>
    refuses(`insert into deal_drafts (owner_id, deal)
             values ('${owner}', '{"v":1}')`));

  t("and saving again replaces the one that is there", () => {
    psql(`insert into deal_drafts (owner_id, deal) values ('${owner}', '{"v":1,"terms":{"ratePct":7.5}}')
          on conflict (owner_id) do update set deal = excluded.deal, updated_at = now()`);
    return psql(`select deal->'terms'->>'ratePct' from deal_drafts
                 where owner_id = '${owner}'`) === "7.5"
      && psql(`select count(*) from deal_drafts`) === "1";
  });

  // Two investors, so "this owner's draft" and "the only draft" differ.
  t("another investor keeps their own, separately", () => {
    psql(`insert into deal_drafts (owner_id, deal)
          values ('${other}', '{"v":1,"terms":{"ratePct":0}}')`);
    return psql(`select deal->'terms'->>'ratePct' from deal_drafts
                 where owner_id = '${owner}'`) === "7.5"
      && psql(`select deal->'terms'->>'ratePct' from deal_drafts
               where owner_id = '${other}'`) === "0";
  });

  // ---- it does not outlive what it names -----------------------------

  t("deleting the investor takes their draft with it", () => {
    psql(`delete from owners where id = '${other}'`);
    return psql(`select count(*) from deal_drafts where owner_id = '${other}'`) === "0";
  });

  t("but losing the person who saved it does not lose the draft", () => {
    psql(`delete from staff where id = '${who}'`);
    return psql(`select count(*) from deal_drafts where owner_id = '${owner}'`) === "1"
      && psql(`select by_staff is null from deal_drafts where owner_id = '${owner}'`) === "t";
  });

  // ---- who may change one --------------------------------------------

  t("a signed-in client may read a draft", () =>
    psqlEnd(`set role authenticated;
             select count(*) from deal_drafts where owner_id = '${owner}'`) === "1");

  /* The revoke is the whole of this one. A project carrying a blanket
     `grant all on all tables` -- which this fixture hands over above --
     is the case it exists for; on a clean database it would change
     nothing and the check would be a no-op. */
  t("and may not write one directly", () =>
    refuses(`set role authenticated;
             update deal_drafts set deal = '{"v":1,"terms":{"ratePct":0}}'
             where owner_id = '${owner}'`));
  t("nor delete one", () =>
    refuses(`set role authenticated; delete from deal_drafts where owner_id = '${owner}'`));
  t("and a caller with no session sees nothing at all", () =>
    refuses(`set role anon; select count(*) from deal_drafts`));

} catch (e) {
  /* The named check above has already recorded what went wrong. Letting
     this out would print a stack trace and no results at all, which reads
     as "the harness fell over" rather than "the migration did not
     apply" -- the most important thing a harness like this can say. */
  const why = String(e && e.message || e).replace(/\s+/g, " ").trim();
  if (!/^stopping:/.test(why)) checks.push(["the harness ran to the end", false, why]);
} finally {
  try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -m immediate stop`)); } catch { /* down already */ }
  rmSync(dir, { recursive: true, force: true });
}

let bad = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${!ok && why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${checks.length}`); process.exit(1); }
console.log("one deal per investor, kept, and nobody else may move it");
