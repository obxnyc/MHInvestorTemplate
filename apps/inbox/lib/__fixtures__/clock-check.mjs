/** Migration 038 against a real Postgres.  Run: node lib/__fixtures__/clock-check.mjs
 *
 *  Reading SQL is not running it. 036 taught that the hard way: the one line
 *  that mattered had a trap in it -- array_length('{}',1) is null and a null
 *  CHECK passes -- which reading could not find and a database found in a
 *  second.
 *
 *  What this asks of 038:
 *    - it applies at all, on a schema where none of it exists
 *    - it applies twice, which is what happens when somebody re-runs it
 *    - the constraints that protect a pay record actually refuse things
 *    - the one-open-shift rule holds under a second insert
 *    - a ping cannot be written against a shift that has been clocked out of
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..", "docs", "shared-line");
const SQL = join(root, "038-the-clock-and-the-fence.sql");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(SQL)) {
  console.log("skipped: no postgres here to run the migration against.");
  process.exit(0);
}

const PORT = "55441";
const dir = mkdtempSync(join(tmpdir(), "clock-check-"));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
const asPg = (line) => {
  try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
  catch { return ["sh", ["-c", line]]; }
};

const checks = [];
const t = (name, ok, why) => checks.push([name, ok, why]);

try {
  run("chmod", ["777", dir]);
  run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
  run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start`));
  await new Promise((r) => setTimeout(r, 1500));

  const psql = (db, sql) => run("psql",
    ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", db, "-tAc", sql]);
  const takes = (db, sql) => {
    try { psql(db, sql); return true; }
    catch (e) { return !String(e.stderr ?? e).includes("ERROR"); }
  };
  const apply = (db) => run("psql",
    ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", db,
     "-v", "ON_ERROR_STOP=1", "-f", SQL]);

  psql("postgres", "create database a;");

  // Just enough of the schema for 038 to land on: the enum it extends, the
  // two tables it references, and the two helper functions its policies
  // call. Stubbed rather than imported, because the question is whether 038
  // applies -- not whether the whole schema does.
  // Supabase's two roles. The migration revokes from one and grants to the
  // other, and a GRANT to a role that does not exist is an error rather than
  // a no-op -- which is the first thing this harness found.
  psql("a", "create role anon; create role authenticated;");
  // Supabase's auth schema. The policies call auth.uid(), and a policy
  // referring to a schema that does not exist fails at CREATE POLICY rather
  // than at query time -- so without this the migration does not apply at
  // all, which is a different failure from the policies being wrong.
  psql("a", `create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select '11111111-1111-1111-1111-111111111111'::uuid $$;`
    .replace(/\s+/g, " "));

  psql("a", `
    create type staff_role as enum ('admin','office','tech','shower');
    create table staff (id uuid primary key default gen_random_uuid(),
      role staff_role not null default 'tech', active boolean not null default true);
    create table properties (id uuid primary key default gen_random_uuid(),
      name text not null);
    create function is_active_staff() returns boolean language sql stable as $$
      select true $$;
    create function staff_has_role(variadic p_roles staff_role[])
      returns boolean language sql stable as $$ select true $$;
  `.replace(/\s+/g, " "));

  // The most important thing a harness like this can report is that the
  // migration will not apply, and in 036 that was the one case that threw --
  // taking the run down as "the harness fell over" rather than naming it.
  let applied = true, why = "";
  try { apply("a"); } catch (e) { applied = false; why = String(e.stderr ?? e).slice(-400); }
  t("the migration applies", applied, why);

  if (applied) {
    let again = true, why2 = "";
    try { apply("a"); } catch (e) { again = false; why2 = String(e.stderr ?? e).slice(-400); }
    // Somebody always runs it twice. A migration that only works once is one
    // that breaks the second time anybody is unsure whether it ran.
    t("and applies again on a database that already has it", again, why2);

    psql("a", "insert into staff (id) values ('11111111-1111-1111-1111-111111111111');");
    psql("a", "insert into properties (id, name) values "
      + "('22222222-2222-2222-2222-222222222222', 'The Retreat');");
    const W = "'11111111-1111-1111-1111-111111111111'";
    const P = "'22222222-2222-2222-2222-222222222222'";

    t("crew is a role now", takes("a", `update staff set role = 'crew' where id = ${W};`));

    // The owner pastes the whole file into the Supabase SQL editor, which
    // runs it as one statement batch. `alter type ... add value` is the kind
    // of statement Postgres has historically refused inside a transaction
    // block, so whether this file survives that is not something reading it
    // can answer.
    psql("postgres", "create database c;");
    psql("c", "create role anon2;");       // separate database, separate roles
    psql("c", `create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select '11111111-1111-1111-1111-111111111111'::uuid $$;`
      .replace(/\s+/g, " "));
    psql("c", `
      create type staff_role as enum ('admin','office','tech','shower');
      create table staff (id uuid primary key default gen_random_uuid(),
        role staff_role not null default 'tech', active boolean not null default true);
      create table properties (id uuid primary key default gen_random_uuid(),
        name text not null);
      create function is_active_staff() returns boolean language sql stable as $$
        select true $$;
      create function staff_has_role(variadic p_roles staff_role[])
        returns boolean language sql stable as $$ select true $$;
    `.replace(/\s+/g, " "));
    let oneGo = true, whyGo = "";
    try {
      run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "c",
                   "-v", "ON_ERROR_STOP=1", "-1", "-f", SQL]);
    } catch (e) { oneGo = false; whyGo = String(e.stderr ?? e).slice(-300); }
    t("the whole file runs as one transaction, the way the SQL editor runs it",
      oneGo, whyGo);
    if (oneGo) {
      t("and crew is a role in that database too",
        takes("c", "select 'crew'::staff_role;"));
    }

    t("a shift goes in",
      takes("a", `insert into shifts (id, staff_id, started_at) values
        ('33333333-3333-3333-3333-333333333333', ${W}, now() - interval '3 hours');`));

    // A pay record that can be double-counted is a pay record somebody has to
    // audit by hand. Two open shifts only ever means a second phone or a
    // stuck button, and neither should be settled by whichever row is read
    // first.
    t("a second open shift for the same person is refused",
      !takes("a", `insert into shifts (staff_id) values (${W});`));
    t("but a FINISHED second shift is fine",
      takes("a", `insert into shifts (staff_id, started_at, ended_at) values
        (${W}, now() - interval '9 hours', now() - interval '8 hours');`));

    t("a shift that ends before it starts is refused",
      !takes("a", `insert into shifts (staff_id, started_at, ended_at) values
        (${W}, now(), now() - interval '1 hour');`));
    t("a fence reading that is not one of the three is refused",
      !takes("a", `update shifts set start_fence = 'probably'
        where id = '33333333-3333-3333-3333-333333333333';`));
    t("and the three real ones are not",
      takes("a", `update shifts set start_fence = 'unsure'
        where id = '33333333-3333-3333-3333-333333333333';`));

    t("a break goes in",
      takes("a", `insert into shift_breaks (id, shift_id, started_at) values
        ('44444444-4444-4444-4444-444444444444',
         '33333333-3333-3333-3333-333333333333', now() - interval '1 hour');`));
    t("a second unfinished break on the same shift is refused",
      !takes("a", `insert into shift_breaks (shift_id) values
        ('33333333-3333-3333-3333-333333333333');`));
    t("once the first is ended another may start", takes("a",
      `update shift_breaks set ended_at = now() - interval '30 minutes'
         where id = '44444444-4444-4444-4444-444444444444';
       insert into shift_breaks (shift_id) values
         ('33333333-3333-3333-3333-333333333333');`));

    t("a ping goes in",
      takes("a", `insert into shift_pings (shift_id, lat, lng, accuracy, fence, metres)
        values ('33333333-3333-3333-3333-333333333333', 35.1, -78.9, 12, 'inside', 40);`));
    t("a ping with no position is refused",
      !takes("a", `insert into shift_pings (shift_id, lng) values
        ('33333333-3333-3333-3333-333333333333', -78.9);`));

    // A deleted shift is an hour somebody worked and cannot prove.
    //
    // Asked twice, because the first way proves nothing. A table created from
    // scratch grants nothing to `authenticated` anyway, so the REVOKE in the
    // migration is a no-op on a clean database and deleting it changes no
    // check. What the revoke is actually for is a project carrying a blanket
    // `grant all on all tables in schema public to authenticated`, which is
    // a common Supabase setup -- so the question is asked in that world, by
    // handing the grant over first and running the migration again.
    psql("a", "grant delete on shifts to authenticated;");
    t("a blanket grant really would allow deletes",
      psql("a", `select count(*) from information_schema.role_table_grants
        where table_name = 'shifts' and grantee = 'authenticated'
          and privilege_type = 'DELETE';`).trim() === "1");
    apply("a");
    t("and running the migration takes that back",
      psql("a", `select count(*) from information_schema.role_table_grants
        where table_name = 'shifts' and grantee = 'authenticated'
          and privilege_type = 'DELETE';`).trim() === "0");

    t("nobody signed in may delete a shift",
      psql("a", `select count(*) from information_schema.role_table_grants
        where table_name = 'shifts' and grantee = 'authenticated'
          and privilege_type = 'DELETE';`).trim() === "0");
    t("but they may correct one",
      psql("a", `select count(*) from information_schema.role_table_grants
        where table_name = 'shifts' and grantee = 'authenticated'
          and privilege_type = 'UPDATE';`).trim() === "1");

    t("a fence smaller than a GPS fix is refused",
      !takes("a", `update properties set fence_m = 5 where id = ${P};`));
    t("a fence bigger than a property is refused",
      !takes("a", `update properties set fence_m = 5000 where id = ${P};`));
    t("a sensible fence is kept",
      takes("a", `update properties set fence_m = 250 where id = ${P};`));

    t("the rules row exists and there is exactly one",
      psql("a", "select count(*) from clock_rules;").trim() === "1");
    t("a second rules row is refused",
      !takes("a", "insert into clock_rules (id) values (true);"));
    t("a cap of nought hours is refused",
      !takes("a", "update clock_rules set daily_cap = 0;"));

    // The policy is the claim: a ping belongs to an open shift. The policy
    // text is read rather than exercised, because exercising it needs a real
    // auth.uid() and a signed-in session, and a stub of auth.uid() would be
    // testing the stub.
    const policy = psql("a", `select pg_get_expr(polwithcheck, polrelid)
      from pg_policy where polname = 'crew_pings_own_open_shift';`);
    t("a ping may only be written against an OPEN shift",
      /ended_at IS NULL/i.test(policy), policy.trim().slice(0, 200));
    t("and only against this person's own",
      /staff_id = auth\.uid\(\)/i.test(policy), policy.trim().slice(0, 200));
  }
} catch (e) {
  t("the harness ran", false, String(e.stderr ?? e).slice(-400));
} finally {
  try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -m immediate stop`)); } catch { /* going anyway */ }
  rmSync(dir, { recursive: true, force: true });
}

let failed = 0;
for (const [n, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${n}${!ok && why ? `\n        ${why}` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
