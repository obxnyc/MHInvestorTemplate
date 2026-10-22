/** Migration 040, run rather than read.
 *
 *  Starts a Postgres, builds the tables as the earlier migrations left them,
 *  and applies 040. Skips where there is no postgres, the way the picture
 *  harnesses skip without a browser.
 *
 *  The thing reading cannot settle: two columns on one row that can disagree.
 *  A shift against lot 20 of Northside with property_id pointing at The
 *  Retreat is two different claims about where somebody was, and nothing in
 *  the table would object. A CHECK cannot help, because the answer lives in
 *  another table. So the property is DERIVED -- and whether that actually
 *  holds on an UPDATE as well as an INSERT is a question only the database
 *  can answer.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = join(here, "..", "..", "..", "..", "docs", "shared-line",
  "040-which-lot-the-hours-went-against.sql");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(SQL)) {
  console.log("skipped: no postgres here to run the migration against.");
  process.exit(0);
}

const PORT = "55441";
const dir = mkdtempSync(join(tmpdir(), "lot-check-"));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
const asPg = (line) => {
  try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
  catch { return ["sh", ["-c", line]]; }
};

const checks = [];
/* Every assertion is a thunk, so a fault that removes a column is reported as
   a named failure rather than taking the whole run down with a TypeError. */
const t = (name, fn) => {
  try { checks.push([name, Boolean(fn())]); }
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

  /* THE FIRST LINE ONLY. `psql -tAc "insert ... returning id"` prints the
     value and then its command tag on the next line, so the whole output is
     "<uuid>\nINSERT 0 1" -- which compares equal to nothing and reads as the
     trigger not firing. Half an hour went on that reading once before; the
     answer came from asking psql directly rather than instrumenting the
     harness a third time. */
  const psql = (sql) => run("psql",
    ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t", "-tAc", sql])
    .split("\n")[0].trim();
  const takes = (sql) => {
    try { psql(sql); return true; }
    catch (e) { return !String(e.stderr ?? e).includes("ERROR"); }
  };

  run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres",
    "-c", "create database t"]);

  // The world as the earlier migrations left it, and no more of it.
  psql(`
    create table properties (id uuid primary key default gen_random_uuid(),
      name text not null, kind text);
    create table units (id uuid primary key default gen_random_uuid(),
      property_id uuid not null references properties(id) on delete cascade,
      label text not null, unique (property_id, label));
    create table staff (id uuid primary key default gen_random_uuid(),
      full_name text);
    create table shifts (id uuid primary key default gen_random_uuid(),
      staff_id uuid not null references staff(id) on delete cascade,
      property_id uuid references properties(id) on delete set null,
      property_from text check (property_from is null
        or property_from in ('fence','chosen','office')),
      started_at timestamptz not null default now(),
      ended_at timestamptz);
    insert into properties (id, name, kind) values
      ('00000000-0000-0000-0000-0000000000a1','The Retreat','mhp'),
      ('00000000-0000-0000-0000-0000000000a2','Northside','mhp');
    insert into units (id, property_id, label) values
      ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','20'),
      ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a2','20');
    insert into staff (id, full_name)
      values ('00000000-0000-0000-0000-0000000000c1','Cade');
  `);

  /* THE MOST IMPORTANT FAILURE A HARNESS CAN REPORT is a migration that will
     not apply, so it is a named check rather than something that throws. */
  t("040 applies", () => {
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
      "-v", "ON_ERROR_STOP=1", "-f", SQL]);
    return true;
  });
  t("and replays without complaint", () => {
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
      "-v", "ON_ERROR_STOP=1", "-f", SQL]);
    return true;
  });

  const shift = (sql) => psql(sql);
  const RETREAT = "00000000-0000-0000-0000-0000000000a1";
  const NORTH = "00000000-0000-0000-0000-0000000000a2";
  const R20 = "00000000-0000-0000-0000-0000000000b1";
  const N20 = "00000000-0000-0000-0000-0000000000b2";
  const ME = "00000000-0000-0000-0000-0000000000c1";

  t("a shift against a LOT files itself against that lot's property", () => {
    const got = shift(`insert into shifts (staff_id, unit_id, property_from)
      values ('${ME}','${N20}','chosen') returning property_id`);
    return got === NORTH;
  });

  /* The case the trigger exists for, and the one a CHECK could not catch:
     the two columns naming DIFFERENT places in the same statement. Lot 20 of
     Northside with The Retreat written beside it. */
  t("a lot and a property that disagree are not stored as a disagreement", () => {
    const got = shift(`insert into shifts (staff_id, unit_id, property_id, property_from)
      values ('${ME}','${N20}','${RETREAT}','chosen') returning property_id`);
    return got === NORTH;
  });

  /* An INSERT trigger alone would pass the check above and leave this one
     broken, which is why it is asked separately. */
  t("moving a shift to another park's lot moves the property with it", () => {
    const id = shift(`insert into shifts (staff_id, unit_id, property_from)
      values ('${ME}','${N20}','chosen') returning id`);
    const got = shift(`update shifts set unit_id = '${R20}'
      where id = '${id}' returning property_id`);
    return got === RETREAT;
  });

  t("and writing a wrong property onto a shift that has a lot is corrected", () => {
    const id = shift(`insert into shifts (staff_id, unit_id, property_from)
      values ('${ME}','${N20}','chosen') returning id`);
    const got = shift(`update shifts set property_id = '${RETREAT}'
      where id = '${id}' returning property_id`);
    return got === NORTH;
  });

  /* Hours against the whole park are real work -- mowing the common ground --
     so a shift with no lot must keep the property it was given. A trigger
     that nulled it would quietly unfile every one of those. */
  t("a shift with no lot keeps the property it was given", () => {
    const got = shift(`insert into shifts (staff_id, property_id, property_from)
      values ('${ME}','${RETREAT}','chosen') returning property_id`);
    return got === RETREAT;
  });

  /* Deleting a lot must not delete the hours or unfile them from the park.
     `on delete set null` nulls the lot and fires the UPDATE trigger, which
     must then leave the property alone -- the work still happened there. */
  t("deleting a lot leaves the hours filed against the park", () => {
    psql(`insert into units (id, property_id, label)
      values ('00000000-0000-0000-0000-0000000000b9','${NORTH}','99')`);
    const id = shift(`insert into shifts (staff_id, unit_id, property_from)
      values ('${ME}','00000000-0000-0000-0000-0000000000b9','chosen') returning id`);
    psql(`delete from units where id = '00000000-0000-0000-0000-0000000000b9'`);
    const row = psql(`select coalesce(unit_id::text,'-') || ' ' || coalesce(property_id::text,'-')
      from shifts where id = '${id}'`);
    return row === `- ${NORTH}`;
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
console.log("the lot owns the answer to which property");
