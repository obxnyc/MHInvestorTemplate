/** Migration 051, run against a real Postgres.  Run: node lib/__fixtures__/pipeline-sql-check.mjs
 *
 *  Reading a migration does not find what running it finds (CLAUDE.md, 036
 *  and 038). This builds the tables 051 touches as the live project has them
 *  -- including the Supabase roles and the storage schema, because a grant to
 *  a role that does not exist is an error and not a no-op -- applies 051,
 *  applies it AGAIN, and asks the database the questions the pipeline relies
 *  on:
 *
 *   - one open follow-up of each kind per showing, even when showing_id is
 *     null (a plain unique index lets any number of nulls through);
 *   - only one run claims the runner at a time;
 *   - a stage or showing status nobody planned for is refused;
 *   - the listing-photos bucket is public, and the hours are not doubled
 *     by a second run.
 *
 *  Skips where there is no postgres -- and says so loudly, because a skip
 *  prints exit 0 and reads like a pass.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = join(here, "..", "..", "..", "..", "docs", "shared-line", "051-from-zillow-to-a-showing.sql");

const BIN = ["/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN) {
  console.log("SKIPPED -- NOT A PASS: no postgres here to run migration 051 against.");
  process.exit(0);
}

const PORT = "55451";
const dir = mkdtempSync(join(tmpdir(), "pipeline-sql-"));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
const asPg = (line) => {
  try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
  catch { return ["sh", ["-c", line]]; }
};

const checks = [];
const t = (name, ok, why) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok, why]); }
  catch (e) { checks.push([name, false, `threw: ${String(e.stderr ?? e.message).split("\n")[0]}`]); }
};

try {
  run("chmod", ["777", dir]);
  run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
  run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start`));
  await new Promise((r) => setTimeout(r, 1500));

  const psql = (sql) => run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "p",
    "-v", "ON_ERROR_STOP=1", "-tAc", sql]).trim();
  const takes = (sql) => { try { psql(sql); return true; } catch { return false; } };
  run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-tAc", "create database p;"]);

  // What 051 meets on the live project: the Supabase roles, a storage schema
  // with its buckets table, is_active_staff, and the tables as schema.sql +
  // 037 left them.
  psql(`
    create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean default false);
    create function is_active_staff() returns boolean language sql as 'select true';
    create type inquiry_outcome as enum ('open','leased_with_us','unknown');
    create table staff (id uuid primary key default gen_random_uuid());
    create table contacts (id uuid primary key default gen_random_uuid(), phone text not null unique);
    create table properties (id uuid primary key default gen_random_uuid(), name text not null);
    create table units (id uuid primary key default gen_random_uuid(),
      property_id uuid not null references properties(id), label text not null);
    create table prequal_submissions (id uuid primary key default gen_random_uuid());
    create table conversations (id uuid primary key default gen_random_uuid());
    create table inquiries (id uuid primary key default gen_random_uuid(),
      contact_id uuid not null references contacts(id), conversation_id uuid,
      inquired_at timestamptz not null default now(),
      outcome inquiry_outcome not null default 'open', unit_id uuid references units(id));
    create table showings (id uuid primary key default gen_random_uuid(),
      contact_id uuid not null references contacts(id), unit_id uuid references units(id),
      scheduled_for timestamptz not null, external_event_id text unique,
      submission_id uuid, confirmed_prospect_at timestamptz, attended boolean,
      created_at timestamptz not null default now());
    insert into contacts (id, phone) values ('11111111-1111-1111-1111-111111111111', '+12525550100');
    insert into inquiries (id, contact_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
    insert into showings (contact_id, scheduled_for) values ('11111111-1111-1111-1111-111111111111', now());
  `);

  const body = readFileSync(SQL, "utf8");
  const apply = () => { try { psql(body); return null; } catch (e) { return String(e.stderr ?? e).split("\n")[0]; } };

  const first = apply();
  t("051 applies", first === null, first);
  const second = apply();
  t("051 applies a second time (safe to run twice)", second === null, second);

  // And the whole file as one transaction, the way the SQL editor sends it.
  t("051 applies inside one transaction, as the SQL editor sends it", () =>
    takes(`begin; ${body} commit;`));

  t("an existing inquiry starts at 'new'", () =>
    psql("select stage from inquiries") === "new");
  t("an existing showing is 'booked', not null", () =>
    psql("select status from showings") === "booked");
  t("a stage nobody planned for is refused", () =>
    !takes("update inquiries set stage = 'maybe'"));
  t("a showing status nobody planned for is refused", () =>
    !takes("update showings set status = 'probably'"));

  const Q = "22222222-2222-2222-2222-222222222222";
  const fu = (kind, showing = "null") =>
    `insert into lead_followups (inquiry_id, kind, due_at, showing_id) values ('${Q}', '${kind}', now(), ${showing})`;
  t("a follow-up can be planned", () => takes(fu("invite_nudge_1")));
  // A unique index over a nullable column lets any number of nulls through;
  // the coalesce in 051 is what stops a second nudge with no showing.
  t("the same follow-up with no showing cannot be planned twice", () => !takes(fu("invite_nudge_1")));
  const S = psql("select id from showings limit 1");
  t("the same reminder for the same showing cannot be planned twice", () =>
    takes(fu("showing_soon", `'${S}'`)) && !takes(fu("showing_soon", `'${S}'`)));
  t("a follow-up state nobody planned for is refused", () =>
    !takes(`update lead_followups set state = 'pending'`));

  t("the first run claims the runner", () => psql("select claim_followup_run(5, 3)") === "t");
  t("a second run while it is going does not", () => psql("select claim_followup_run(5, 3)") === "f");
  t("a run that never finished is presumed dead after its time", () => {
    psql("update followup_runs set started_at = now() - interval '10 minutes'");
    return psql("select claim_followup_run(5, 3)") === "t";
  });
  t("a run that finished a minute ago is not repeated", () => {
    psql("update followup_runs set finished_at = now() - interval '1 minute'");
    return psql("select claim_followup_run(5, 3)") === "f";
  });
  t("the browser's role cannot start a run", () =>
    !takes("set role authenticated; select claim_followup_run(0, 0);"));
  t("the server's role can", () => takes("set role service_role; select claim_followup_run(0, 0);"));

  t("showing hours were seeded once, and a second run did not double them", () =>
    psql("select count(*) from showing_hours") === "6");
  t("there is no Sunday in the seeded hours", () =>
    psql("select count(*) from showing_hours where weekday = 0") === "0");
  t("a showing hour that ends before it starts is refused", () =>
    !takes("insert into showing_hours (weekday, starts, ends) values (1, '15:00', '14:00')"));
  t("the listing-photos bucket exists and is public", () =>
    psql("select public from storage.buckets where id = 'listing-photos'") === "t");
  t("a listing is one per home", () => {
    const U = psql(`insert into properties (name) values ('Northside') returning id`).split("\n")[0];
    const unit = psql(`insert into units (property_id, label) values ('${U}', '14') returning id`).split("\n")[0];
    return takes(`insert into listings (unit_id) values ('${unit}')`)
      && !takes(`insert into listings (unit_id) values ('${unit}')`);
  });
  t("the browser's role cannot write a listing", () =>
    !takes("set role authenticated; insert into listings (unit_id) select id from units limit 1;"));
} catch (e) {
  checks.push(["the harness ran", false, String(e.stderr ?? e.message).split("\n")[0]]);
} finally {
  try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -m immediate stop`)); } catch { /* already down */ }
}

let bad = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && why ? ` (${why})` : ""}`);
  if (!ok) bad++;
}
console.log(`\n${checks.length - bad}/${checks.length} passed`);
process.exit(bad ? 1 : 0);
