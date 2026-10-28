/** Migration 045, run rather than read.
 *
 *  An alias decides which home a work order is filed against, so the things
 *  worth checking are the ones that would let it point somewhere wrong or
 *  quietly stop pointing anywhere: two aliases for one key, a row that
 *  outlives the property it names, and a read-only guest being able to write
 *  one by going round the application.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = join(here, "..", "..", "..", "..", "docs", "shared-line",
  "045-what-rent-manager-calls-a-place.sql");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(SQL)) {
  console.log("skipped: no postgres here to run the migration against.");
  process.exit(0);
}

const PORT = "55451";
const dir = mkdtempSync(join(tmpdir(), "alias-check-"));
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
  const refuses = (sql) => {
    try { psql(sql); return false; } catch { return true; }
  };

  run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres",
    "-c", "create database t"]);
  psql(`
    create role authenticated; create role anon;
    create or replace function is_active_staff() returns boolean
      language sql stable as $$ select true $$;
    create table properties (id uuid primary key default gen_random_uuid(), name text);
    create table units (id uuid primary key default gen_random_uuid(),
      property_id uuid not null references properties(id) on delete cascade, label text);
    create table staff (id uuid primary key default gen_random_uuid(), full_name text);
    insert into properties (id, name) values
      ('00000000-0000-0000-0000-00000000000a','114 Lisas Way'),
      ('00000000-0000-0000-0000-00000000000b','1140 Northside');
    insert into units (id, property_id, label) values
      ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000b','51');
  `);

  t("045 applies", () => {
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
      "-v", "ON_ERROR_STOP=1", "-f", SQL]);
    return true;
  });
  t("and replays without complaint", () => {
    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
      "-v", "ON_ERROR_STOP=1", "-f", SQL]);
    return true;
  });

  t("a place can be matched to a property", () => {
    psql(`insert into place_aliases (key, saw, property_id)
          values ('114 lisas way','114 Lisas Way, 114 Lisas Way',
                  '00000000-0000-0000-0000-00000000000a')`);
    return psql(`select count(*) from place_aliases`) === "1";
  });

  /* TWO ANSWERS FOR ONE KEY IS THE FAILURE THIS TABLE EXISTS TO PREVENT.
     Without the primary key, a second match quietly wins or loses depending
     on row order, and a work order lands on whichever home came back first. */
  t("one key cannot point at two properties", () =>
    refuses(`insert into place_aliases (key, saw, property_id)
             values ('114 lisas way','again',
                     '00000000-0000-0000-0000-00000000000b')`));

  t("a lot can be named as well as a property", () => {
    psql(`insert into place_aliases (key, saw, property_id, unit_id)
          values ('1140 northside 51','1140 Northside #51, Lot #51',
                  '00000000-0000-0000-0000-00000000000b',
                  '00000000-0000-0000-0000-0000000000c1')`);
    return psql(`select unit_id::text from place_aliases
                  where key = '1140 northside 51'`)
      === "00000000-0000-0000-0000-0000000000c1";
  });

  /* A lot can be deleted while the park stays. The alias must lose the lot
     and keep the park -- a mapping that vanished would silently stop filing
     requests, and one pointing at a deleted lot would fail at write time. */
  t("deleting a lot leaves the alias pointing at the park", () => {
    psql(`delete from units where id = '00000000-0000-0000-0000-0000000000c1'`);
    return psql(`select coalesce(unit_id::text,'-') || ' ' || property_id::text
                   from place_aliases where key = '1140 northside 51'`)
      === "- 00000000-0000-0000-0000-00000000000b";
  });

  t("and deleting the property takes its aliases with it", () => {
    psql(`delete from properties where id = '00000000-0000-0000-0000-00000000000b'`);
    return psql(`select count(*) from place_aliases
                  where key = '1140 northside 51'`) === "0";
  });

  /* A read-only guest reads the application through `authenticated`. An alias
     decides which home a work order is filed against, so writing one has to
     go through the route, which checks who is asking. */
  t("a signed-in client may read aliases", () =>
    psql(`select has_table_privilege('authenticated','place_aliases','select')`)
      === "t");
  t("and may not write one directly", () =>
    psql(`select has_table_privilege('authenticated','place_aliases','insert')`)
      === "f");
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
console.log("one place, one answer, and it outlives nothing it names");
