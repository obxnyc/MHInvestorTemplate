/** Migration 047, run rather than read.
 *
 *  A signature is the one thing in this application that is personal: the
 *  mark that goes on a contract is one person's, and the things worth
 *  checking are the ones that would let somebody else write it or read it.
 *  Everything in the office can see a deal; nobody but you may see yours.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = join(here, "..", "..", "..", "..", "docs", "shared-line",
  "047-the-signature-on-our-side.sql");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(SQL)) {
  console.log("skipped: no postgres here to run the migration against.");
  process.exit(0);
}

const PORT = "55471";
const dir = mkdtempSync(join(tmpdir(), "sign-sql-"));
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
    create table staff (id uuid primary key default gen_random_uuid(), full_name text);
    -- Supabase's own. A policy naming a schema that is not there fails at
    -- CREATE POLICY, not at query time, so without this the migration does
    -- not apply at all rather than misbehaving later.
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
    $$;
    grant usage on schema auth to authenticated, anon;
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

  const me = psql("insert into staff (full_name) values ('Ben') returning id");
  const you = psql("insert into staff (full_name) values ('Alex') returning id");
  const INK = "data:image/png;base64,iVBORw0KGgo=";

  t("a signature can be kept", () => {
    psql(`insert into signatures (staff_id, png, signs_as)
          values ('${me}', '${INK}', 'Benjamin Cade Larabee')`);
    return psql(`select png from signatures where staff_id = '${me}'`) === INK;
  });

  t("a second signature for the same person is refused", () =>
    refuses(`insert into signatures (staff_id, png) values ('${me}', '${INK}')`));

  t("signing again replaces the one that is there", () => {
    psql(`insert into signatures (staff_id, png) values ('${me}', 'data:image/png;base64,QQ==')
          on conflict (staff_id) do update set png = excluded.png, updated_at = now()`);
    return psql(`select png from signatures where staff_id = '${me}'`)
      === "data:image/png;base64,QQ==";
  });

  // Two people, so "my signature" and "the only signature" differ.
  t("somebody else keeps their own, separately", () => {
    psql(`insert into signatures (staff_id, png) values ('${you}', 'data:image/png;base64,Zm9v')`);
    return psql(`select png from signatures where staff_id = '${you}'`)
      === "data:image/png;base64,Zm9v";
  });

  t("losing the person takes their signature with them", () => {
    psql(`delete from staff where id = '${you}'`);
    return psql(`select count(*) from signatures where staff_id = '${you}'`) === "0";
  });

  // ---- whose signature anybody may see -------------------------------

  /* THE ONE THAT MATTERS, and it is not the same question as the deal
     draft above. Everybody at the desk may read a deal; a signature is
     one person's mark and the policy says so by id, not by "is staff". */
  t("you can read your own signature", () =>
    psqlEnd(`set local role authenticated;
             set local request.jwt.claims = '{"sub":"${me}"}';
             select count(*) from signatures where staff_id = '${me}'`) === "1");

  t("and not somebody else's", () => {
    const them = psql("insert into staff (full_name) values ('Dana') returning id");
    psql(`insert into signatures (staff_id, png) values ('${them}', '${INK}')`);
    return psqlEnd(`set local role authenticated;
                    set local request.jwt.claims = '{"sub":"${me}"}';
                    select count(*) from signatures where staff_id = '${them}'`) === "0";
  });

  t("and may not write one directly", () =>
    refuses(`set role authenticated;
             update signatures set png = 'data:image/png;base64,Zg=='
             where staff_id = '${me}'`));
  t("nor delete one", () =>
    refuses(`set role authenticated; delete from signatures where staff_id = '${me}'`));
  t("and a caller with no session sees nothing at all", () =>
    refuses(`set role anon; select count(*) from signatures`));

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
console.log("one signature per person, and nobody else may read it");
