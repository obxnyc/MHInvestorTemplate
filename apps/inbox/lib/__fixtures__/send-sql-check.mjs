/** Migration 048, run rather than read.
 *
 *  A row here is a contract offered and, later, a contract signed. The
 *  things worth checking are the ones that would lose it, let it be signed
 *  twice, or let somebody who is not the office change what was agreed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = join(here, "..", "..", "..", "..", "docs", "shared-line",
  "048-sending-it-to-be-signed.sql");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(SQL)) {
  console.log("skipped: no postgres here to run the migration against.");
  process.exit(0);
}

const PORT = "55481";
const dir = mkdtempSync(join(tmpdir(), "send-sql-"));
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
    create table owners (id uuid primary key default gen_random_uuid(), name text);
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
  const who = psql("insert into owners (name) values ('Aldercrest') returning id");
  const SOON = "now() + interval '14 days'";
  const send = (tok, extra = "") => psql(
    `insert into signing_requests (token, owner_id, title, pack, to_name,
       to_email, sent_by, expires_at ${extra ? ", " + extra.split("=")[0] : ""})
     values ('${tok}', '${who}', 'Papers', '<p>A</p>', 'Dana',
       'dana@example.com', '${me}', ${SOON}
       ${extra ? ", " + extra.split("=").slice(1).join("=") : ""})
     returning id`);

  t("a request can be sent", () => {
    const id = send("tok-one");
    return psql(`select to_name from signing_requests where id = '${id}'`) === "Dana";
  });

  t("two requests cannot share a token", () => refuses(
    `insert into signing_requests (token, owner_id, title, pack, to_name,
       to_email, expires_at)
     values ('tok-one', '${who}', 'Papers', '<p>B</p>', 'Dana',
       'dana@example.com', ${SOON})`));

  /* NOWHERE TO SEND IT IS NOT A REQUEST. Both columns null is a row that
     looks sent and reached nobody. */
  t("a request with no email and no number is refused", () => refuses(
    `insert into signing_requests (token, owner_id, title, pack, to_name, expires_at)
     values ('tok-nowhere', '${who}', 'Papers', '<p>B</p>', 'Dana', ${SOON})`));
  t("but a number alone is enough", () => {
    psql(`insert into signing_requests (token, owner_id, title, pack, to_name,
            to_phone, expires_at)
          values ('tok-sms', '${who}', 'Papers', '<p>B</p>', 'Dana',
            '+19105550114', ${SOON})`);
    return psql(`select to_phone from signing_requests where token = 'tok-sms'`)
      === "+19105550114";
  });

  // The same investor can have two out at once -- a second park, new terms.
  t("one investor can have two out at once", () => {
    send("tok-two");
    return psql(`select count(*) from signing_requests
                 where owner_id = '${who}'`) === "3";
  });

  /* WHAT WAS SENT SURVIVES THE INVESTOR BEING DELETED. A signed contract
     is not a thing that disappears because a record was tidied up. */
  t("losing the investor does not lose what they signed", () => {
    psql(`update signing_requests set signed_at = now(), signed_name = 'Dana',
            signed_pack = '<p>A signed</p>', agreed = true
          where token = 'tok-one'`);
    psql(`delete from owners where id = '${who}'`);
    return psql(`select signed_name from signing_requests where token = 'tok-one'`)
      === "Dana"
      && psql(`select owner_id is null from signing_requests
               where token = 'tok-one'`) === "t";
  });

  t("and nor does losing whoever sent it", () => {
    psql(`delete from staff where id = '${me}'`);
    return psql(`select count(*) from signing_requests where token = 'tok-one'`) === "1";
  });

  // ---- who may touch one ---------------------------------------------

  t("the office may read what was sent", () =>
    psqlEnd(`set local role authenticated;
             select count(*) from signing_requests where token = 'tok-one'`) === "1");

  /* The whole of this table is written by routes holding the service
     role. A browser that could update it could mark an unsigned contract
     signed, or change the text of one that already was. */
  t("and may not change one", () => refuses(
    `set role authenticated;
     update signing_requests set signed_pack = '<p>something else</p>'
     where token = 'tok-one'`));
  t("nor write one", () => refuses(
    `set role authenticated;
     insert into signing_requests (token, owner_id, title, pack, to_name,
       to_email, expires_at)
     values ('tok-forged', null, 'Papers', '<p>C</p>', 'Nobody',
       'x@example.com', ${SOON})`));
  t("nor delete one", () => refuses(
    `set role authenticated; delete from signing_requests where token = 'tok-one'`));
  t("and a caller with no session sees nothing at all", () =>
    refuses(`set role anon; select count(*) from signing_requests`));

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
console.log("what was sent is kept, and only the office may see it");
