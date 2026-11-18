/** Migration 072 against a real Postgres.  Run: node lib/__fixtures__/auto-guard-check.mjs
 *
 *  072 puts a trigger on `shifts`, which every clock-in in the company goes
 *  through. A trigger that refuses an ordinary clock-in is a morning when
 *  nobody's hours are recorded, so the ordinary paths are asked first, and
 *  then each thing the trigger is FOR is asked on its own:
 *
 *    - a man clocks himself in and out, as before
 *    - he cannot write a start or end time of his choosing (the hole 072 shuts)
 *    - his phone can clock him in up to 35 minutes back, only when ticked
 *    - his phone can close only a shift it started, up to 50 minutes back
 *    - his lead can clock him in and out, at the time it happens, and the
 *      lead's name is on it; the lead cannot clock in a man not on his crew
 *    - the office can enter a whole day; nobody else can
 *    - the service role (the 6pm close) passes untouched
 *
 *  AUTO_GUARD_SQL points it at another copy of the migration, to see a fault
 *  caught.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = process.env.AUTO_GUARD_SQL
  ?? join(here, "..", "..", "..", "..", "docs", "shared-line", "072-hours-for-the-man-who-never-clocks-in.sql");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/usr/local/pgsql/bin"]
  .find((d) => existsSync(join(d, "initdb")));
if (!BIN) {
  // Loud, not exit 0: a skip that reads like a pass is how four harnesses
  // went unrun for weeks.
  console.log("NOT RUN: no postgres here to run 072 against.");
  process.exit(2);
}

const PORT = "55472";
const dir = mkdtempSync(join(tmpdir(), "auto-guard-"));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe" });
const asPg = (line) => {
  try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
  catch { return ["sh", ["-c", line]]; }
};

const checks = [];
const t = (name, fn) => {
  try { const r = fn(); checks.push([name, r === true, r === true ? "" : String(r)]); }
  catch (e) { checks.push([name, false, `threw: ${String(e.stderr ?? e.message).slice(0, 200)}`]); }
};

const LEAD = "aaaaaaaa-0000-0000-0000-000000000001";
const MAN = "aaaaaaaa-0000-0000-0000-000000000002";
const OTHER = "aaaaaaaa-0000-0000-0000-000000000003";
const OFFICE = "aaaaaaaa-0000-0000-0000-000000000004";

let pgStarted = false;
try {
  run("chmod", ["777", dir]);
  run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
  run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start -w`));
  pgStarted = true;

  const psql = (sql) => run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-tAqc", sql]).trim();
  /** As a signed-in person: auth.uid() reads test.uid, as Supabase's reads the JWT. */
  // And as the role a signed-in browser uses, so the row policies apply --
  // as the superuser they would not, and "a lead cannot clock in a man not
  // on his crew" passed for that reason alone on the first run.
  const as = (uid, sql) => psql(uid
    ? `set test.uid = '${uid}'; set role authenticated; ${sql}`
    : `set test.uid = ''; ${sql}`);
  const refused = (uid, sql, why) => {
    try { as(uid, sql); return "it was allowed"; }
    catch (e) {
      const msg = String(e.stderr ?? e);
      return why.test(msg) ? true : `refused for another reason: ${msg.slice(0, 160)}`;
    }
  };

  psql(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    create type staff_role as enum ('admin','office','tech','shower','crew');
    create table staff (id uuid primary key, full_name text, role staff_role not null,
      active boolean not null default true);
    create function is_active_staff() returns boolean language sql stable as $$ select true $$;
    create function staff_has_role(variadic p_roles staff_role[]) returns boolean
      language sql stable security definer as $$
      select exists (select 1 from staff where id = auth.uid() and role = any(p_roles)) $$;
    create table crew_setup (staff_id uuid primary key references staff(id), lead_id uuid,
      on_clock boolean not null default true);
    create table clock_text_settings (id int primary key default 1, tz text, days int[],
      optional_days int[], auto_out text);
    create table shifts (id uuid primary key default gen_random_uuid(), staff_id uuid not null,
      property_id uuid, started_at timestamptz not null default now(), ended_at timestamptz,
      signed_off_at timestamptz, settled_by uuid, settled_at timestamptz,
      auto_clocked_out boolean not null default false, start_device text);
    create table shift_breaks (id uuid primary key default gen_random_uuid(), shift_id uuid,
      started_at timestamptz not null default now(), ended_at timestamptz);
    -- 038's policies on shifts, as they stand live.
    alter table shifts enable row level security;
    grant select, insert, update on shifts, shift_breaks to authenticated;
    grant select on staff, crew_setup, clock_text_settings to authenticated;
    grant usage on schema auth to authenticated;
    create policy crew_reads_own_shifts on shifts for select
      using (staff_id = auth.uid() or staff_has_role('admin','office'));
    create policy crew_opens_own_shifts on shifts for insert
      with check (is_active_staff() and (staff_id = auth.uid() or staff_has_role('admin','office')));
    create policy crew_closes_own_shifts on shifts for update
      using (staff_id = auth.uid() or staff_has_role('admin','office'))
      with check (staff_id = auth.uid() or staff_has_role('admin','office'));
  `);

  let applied = true;
  try { run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", SQL]); }
  catch (e) { applied = String(e.stderr ?? e).slice(-300); }
  t("072 applies", () => applied);
  t("and applies again", () => {
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", SQL]);
    return true;
  });

  psql(`
    insert into staff values ('${LEAD}','Jose','crew'), ('${MAN}','Pedro','crew'),
      ('${OTHER}','Luis','crew'), ('${OFFICE}','Dana','office');
    insert into crew_setup (staff_id, lead_id) values ('${LEAD}', null), ('${MAN}', '${LEAD}'),
      ('${OTHER}', null);
    insert into clock_text_settings (tz, days, optional_days, auto_out)
      values ('America/New_York', '{1,2,3,4,5}', '{6}', '18:00');
  `);
  const reset = () => psql("delete from shifts;");
  const open = (who) => psql(`select id from shifts where staff_id = '${who}' and ended_at is null`);

  /* ------------------------------------------------ the ordinary day */
  reset();
  t("a man clocks himself in, as before", () => {
    as(MAN, `insert into shifts (staff_id) values ('${MAN}')`);
    return psql(`select start_how from shifts where staff_id='${MAN}'`) === "self";
  });
  t("he moves it to another job and his phone is recorded, as before", () => {
    as(MAN, `update shifts set property_id = gen_random_uuid(), start_device = 'x' where staff_id='${MAN}'`);
    return true;
  });
  t("and clocks himself out at now, marked self", () => {
    as(MAN, `update shifts set ended_at = now() where staff_id='${MAN}' and ended_at is null`);
    return psql(`select end_how from shifts where staff_id='${MAN}'`) === "self";
  });

  /* ------------------------------------ the hole 072 shuts */
  reset();
  t("he cannot clock himself in two hours ago", () => {
    as(MAN, `insert into shifts (staff_id, started_at) values ('${MAN}', now() - interval '2 hours')`);
    const back = Number(psql(`select extract(epoch from now() - started_at) from shifts where staff_id='${MAN}'`));
    return back < 60 ? true : `started ${back}s back`;
  });
  t("he cannot move the start of his own shift", () =>
    refused(MAN, `update shifts set started_at = now() - interval '3 hours' where staff_id='${MAN}'`,
      /When a shift began is changed by asking the office/));
  t("he cannot clock himself out at ten tonight", () => {
    as(MAN, `update shifts set ended_at = now() + interval '8 hours' where staff_id='${MAN}' and ended_at is null`);
    const ahead = Number(psql(`select extract(epoch from ended_at - now()) from shifts where staff_id='${MAN}'`));
    return ahead < 60 ? true : `ended ${ahead}s ahead`;
  });
  t("nor change a finished shift's end", () =>
    refused(MAN, `update shifts set ended_at = now() + interval '1 hour' where staff_id='${MAN}'`,
      /A finished shift is changed by asking the office/));
  t("nor enter a finished day", () =>
    refused(MAN, `insert into shifts (staff_id, started_at, ended_at) values ('${MAN}', now() - interval '9 hours', now())`,
      /A finished shift is entered by the office/));
  t("nor open a shift for somebody else as if it were his", () =>
    refused(MAN, `insert into shifts (staff_id) values ('${OTHER}')`, /That shift is not yours/));

  /* ------------------------------------------------ his phone */
  reset();
  t("the phone cannot clock him in while nobody has ticked it", () =>
    refused(MAN, `insert into shifts (staff_id, start_how, started_at) values ('${MAN}','auto', now() - interval '5 minutes')`,
      /Automatic clock-in is not on for you/));
  psql(`update crew_setup set auto_clock = true where staff_id = '${MAN}'`);
  t("my_auto_clock says so to him", () => as(MAN, "select my_auto_clock()") === "t");
  t("and not to somebody else", () => as(OTHER, "select my_auto_clock()") === "f");
  t("ticked, the phone clocks him in at the time he arrived", () => {
    as(MAN, `insert into shifts (staff_id, start_how, started_at) values ('${MAN}','auto', now() - interval '20 minutes')`);
    const back = Number(psql(`select extract(epoch from now() - started_at) from shifts where staff_id='${MAN}'`));
    return back > 1100 && back < 1300 ? true : `started ${back}s back`;
  });
  t("but never more than 35 minutes back", () => {
    reset();
    return refused(MAN, `insert into shifts (staff_id, start_how, started_at) values ('${MAN}','auto', now() - interval '2 hours')`,
      /at most 35 minutes back/);
  });
  reset();
  as(MAN, `insert into shifts (staff_id, start_how, started_at) values ('${MAN}','auto', now() - interval '30 minutes')`);
  t("the phone closes the shift it started at the time he left", () => {
    as(MAN, `update shifts set ended_at = now() - interval '10 minutes', end_how = 'auto' where staff_id='${MAN}'`);
    const back = Number(psql(`select extract(epoch from now() - ended_at) from shifts where staff_id='${MAN}'`));
    return back > 500 && back < 700 && psql(`select end_how from shifts where staff_id='${MAN}'`) === "auto"
      ? true : `ended ${back}s back`;
  });
  reset();
  as(MAN, `insert into shifts (staff_id, start_how, started_at) values ('${MAN}','auto', now() - interval '30 minutes')`);
  t("but not more than 50 minutes back", () =>
    refused(MAN, `update shifts set ended_at = now() - interval '3 hours', end_how = 'auto' where staff_id='${MAN}'`,
      /at most 50 minutes back/));

  /* ------------------------------------------------ his lead */
  reset();
  t("a lead sees his crew", () => as(LEAD, "select full_name from my_crew()") === "Pedro");
  t("a lead clocks his man in, with his own name on it", () => {
    as(LEAD, `insert into shifts (staff_id, start_how, started_at) values ('${MAN}','lead', now() - interval '3 hours')`);
    const row = psql(`select start_how || ',' || started_by || ',' || (extract(epoch from now() - started_at) < 60) from shifts where staff_id='${MAN}'`);
    return row === `lead,${LEAD},true` ? true : row;
  });
  t("and clocks him out, at now, marked lead", () => {
    as(LEAD, `update shifts set ended_at = now() + interval '5 hours' where staff_id='${MAN}' and ended_at is null`);
    const row = psql(`select end_how || ',' || ended_by || ',' || (extract(epoch from ended_at - now()) < 60) from shifts where staff_id='${MAN}'`);
    return row === `lead,${LEAD},true` ? true : row;
  });
  t("a lead cannot clock in a man who is not on his crew", () =>
    refused(LEAD, `insert into shifts (staff_id, start_how) values ('${OTHER}','lead')`, /row-level security|violates/));
  t("a lead cannot set his own man's hours after the fact", () =>
    refused(LEAD, `insert into shifts (staff_id, start_how, started_at, ended_at) values ('${MAN}','lead', now() - interval '9 hours', now())`,
      /A finished shift is entered by the office/));
  reset();
  as(MAN, `insert into shifts (staff_id, start_how, started_at) values ('${MAN}','auto', now() - interval '5 minutes')`);
  t("a lead cannot close a shift backdated as if the phone had", () =>
    refused(LEAD, `update shifts set ended_at = now() - interval '4 minutes', end_how = 'auto' where staff_id='${MAN}'`,
      /Only a shift the phone started is ended by the phone/));

  /* ------------------------------------------------ the office */
  reset();
  t("the office enters a whole day, with its name on it", () => {
    as(OFFICE, `insert into shifts (staff_id, start_how, started_at, ended_at, end_how)
      values ('${MAN}','office', now() - interval '30 hours', now() - interval '21 hours', 'office')`);
    return psql(`select started_by from shifts where staff_id='${MAN}'`) === OFFICE;
  });
  t("nobody else can enter as the office", () =>
    refused(LEAD, `insert into shifts (staff_id, start_how) values ('${MAN}','office')`, /Only the office enters hours/));

  /* ------------------------------------------------ the 6pm close */
  reset();
  as(MAN, `insert into shifts (staff_id) values ('${MAN}')`);
  t("the service role closes a forgotten shift at six, untouched", () => {
    as(null, `update shifts set ended_at = now() - interval '2 hours', auto_clocked_out = true, end_how = 'clock' where staff_id='${MAN}'`);
    const back = Number(psql(`select extract(epoch from now() - ended_at) from shifts where staff_id='${MAN}'`));
    return back > 7000 ? true : `ended ${back}s back`;
  });
  t("clock_window answers", () => /America\/New_York/.test(as(MAN, "select clock_window()")));
} catch (e) {
  checks.push(["the harness ran to the end", false, String(e.stderr ?? e.message).slice(0, 300)]);
} finally {
  if (pgStarted) { try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d stop -m fast`)); } catch { /* gone */ } }
}

const bad = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
console.log(`\n${checks.length - bad.length}/${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
