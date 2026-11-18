/**
 * 072 against a real Postgres: private conversations, the record, the
 * watch-list and the areas a person is not shown.
 *
 * Every rule here is about who can READ what, and that is decided by row
 * policies as the signed-in person -- which a superuser skips. So each
 * question is asked as `authenticated`, with auth.uid() set to one of three
 * people: the owner (reads everything), Natashia (office, areas hidden) and
 * Alex (office, nothing hidden). Three, because with two the owner's rule and
 * the member's rule cannot be told apart.
 *
 *   node lib/__fixtures__/record-check.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = process.env.RECORD_SQL ?? join(here, "..", "..", "..", "..", "docs", "shared-line",
  "072-private-record-watch.sql");
const SQL073 = process.env.RECORD_SQL_073 ?? join(here, "..", "..", "..", "..", "docs", "shared-line",
  "073-maintenance-stays-shared.sql");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(SQL)) {
  console.log("SKIPPED: no postgres here to run the migration against -- this is not a pass.");
  process.exit(2);
}

const PORT = "55441";
const dir = mkdtempSync(join(tmpdir(), "record-check-"));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
const asPg = (line) => {
  try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
  catch { return ["sh", ["-c", line]]; }
};

const OWNER = "00000000-0000-0000-0000-00000000000a";
const NAT = "00000000-0000-0000-0000-00000000000b";
const ALEX = "00000000-0000-0000-0000-00000000000c";
const OPEN = "10000000-0000-0000-0000-000000000001";
const SECRET = "10000000-0000-0000-0000-000000000002";

const results = [];
const t = (name, fn) => {
  let ok = false, why = "";
  try { ok = Boolean(fn()); } catch (e) { why = ` (threw: ${String(e.stderr ?? e.message).split("\n").find((l) => l.includes("ERROR")) ?? e.message})`; }
  results.push(`${ok ? "  ok " : "FAIL"}  ${name}${why}`);
};

const STUBS = `
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
  create schema net;
  create table net.sent (id bigserial primary key, url text, body jsonb, headers jsonb);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
    headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint
    language sql as $$ insert into net.sent (url, body, headers) values (url, body, headers) returning id $$;
  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  insert into vault.decrypted_secrets values ('reports_cron_key', 'k-the-key');

  create table staff (id uuid primary key, full_name text, role text, active boolean default true,
    reads_all_dms boolean default false);
  insert into staff values ('${OWNER}','Cade','admin',true,true),
    ('${NAT}','Natashia Heinrich','office',true,false), ('${ALEX}','Alex','office',true,false);
  create function can_read_all_dms() returns boolean language sql stable security definer
    set search_path = public as
    $$ select exists (select 1 from staff s where s.id = auth.uid() and s.active and s.reads_all_dms) $$;

  create type conv_category as enum ('maintenance', 'general');
  create table conversations (id uuid primary key, subject text, category conv_category default 'general');
  alter table conversations enable row level security;
  create policy office_reads_all on conversations for select using (true);
  create table messages (id uuid primary key default gen_random_uuid(), conversation_id uuid,
    direction text, body text, media_paths text[] default '{}', sent_by uuid,
    created_at timestamptz default now());
  alter table messages enable row level security;
  create policy read_messages on messages for select
    using (exists (select 1 from conversations c where c.id = messages.conversation_id));
  create table notes (id uuid primary key default gen_random_uuid(), conversation_id uuid,
    author_id uuid, body text, media_paths text[] default '{}', created_at timestamptz default now());
  create table dm_messages (id uuid primary key default gen_random_uuid(), thread_id uuid,
    author_id uuid, body text, media_paths text[] default '{}', created_at timestamptz default now());
  create table calls (id uuid primary key default gen_random_uuid(), conversation_id uuid,
    voicemail_text text);
  alter table calls enable row level security;
  create policy staff_reads_calls on calls for select using (true);
  create table distribution_statements (id serial primary key, owed int);
  alter table distribution_statements enable row level security;
  create policy desk_reads on distribution_statements for select using (true);
  create table shift_pings (id serial primary key, lat float);
  alter table shift_pings enable row level security;
  create policy desk_reads on shift_pings for select using (true);

  insert into conversations values ('${OPEN}', 'a tenant'), ('${SECRET}', 'Instinct');
  insert into messages (conversation_id, direction, body) values
    ('${OPEN}', 'inbound', 'the sink is leaking'),
    ('${SECRET}', 'inbound', 'about the acquisition');
  insert into calls (conversation_id, voicemail_text) values ('${SECRET}', 'call me back about it');
  insert into distribution_statements (owed) values (100);
  insert into shift_pings (lat) values (36.3);
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage on all sequences in schema public to authenticated;
`;

try {
  run("chmod", ["777", dir]);
  run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
  run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start`));
  await new Promise((r) => setTimeout(r, 1500));

  const psql = (sql) => run("psql",
    ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAc", sql]).trim();
  /** One question, asked as one signed-in person. */
  const as = (who, sql) => psql(
    `set role authenticated; set request.jwt.claim.sub = '${who}'; ${sql}`).split("\n").pop().trim();
  const apply = (file = SQL) => {
    try {
      run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres",
        "-q", "-v", "ON_ERROR_STOP=1", "-f", file]);
      return null;
    } catch (e) {
      return String(e.stderr ?? e.message).split("\n").find((l) => l.includes("ERROR")) ?? "would not apply";
    }
  };

  psql(STUBS);
  let why = apply();
  t(`072 applies${why ? ` -- ${why}` : ""}`, () => why === null);
  why = apply();
  t(`and replays${why ? ` -- ${why}` : ""}`, () => why === null);

  // ---- private conversations ----
  psql(`update conversations set private_to = '{${ALEX}}' where id = '${SECRET}'`);
  t("before it was private, everyone saw both -- and still sees the open one", () =>
    as(NAT, `select count(*) from conversations where id = '${OPEN}'`) === "1");
  t("a private conversation is hidden from somebody not in it", () =>
    as(NAT, `select count(*) from conversations where id = '${SECRET}'`) === "0");
  t("its messages are hidden with it", () =>
    as(NAT, `select count(*) from messages where conversation_id = '${SECRET}'`) === "0");
  t("its calls and voicemails are hidden with it", () =>
    as(NAT, `select count(*) from calls where conversation_id = '${SECRET}'`) === "0");
  t("the person it is private to sees it", () =>
    as(ALEX, `select count(*) from messages where conversation_id = '${SECRET}'`) === "1");
  t("the owner sees it though he is not in it", () =>
    as(OWNER, `select count(*) from messages where conversation_id = '${SECRET}'`) === "1");

  // ---- maintenance stays shared (073) ----
  why = apply(SQL073);
  t(`073 applies${why ? ` -- ${why}` : ""}`, () => why === null);
  why = apply(SQL073);
  t(`and replays${why ? ` -- ${why}` : ""}`, () => why === null);
  const refusedSql = (sql) => { try { psql(sql); return false; } catch { return true; } };
  psql(`update conversations set category = 'maintenance' where id = '${OPEN}'`);
  t("a maintenance conversation cannot be made private", () =>
    refusedSql(`update conversations set private_to = '{${ALEX}}' where id = '${OPEN}'`)
    && psql(`select private_to is null from conversations where id = '${OPEN}'`) === "t");
  t("a private one re-filed as maintenance is shared again", () => {
    psql(`update conversations set category = 'maintenance' where id = '${SECRET}'`);
    const shared = psql(`select private_to is null from conversations where id = '${SECRET}'`) === "t";
    psql(`update conversations set category = 'general', private_to = '{${ALEX}}' where id = '${SECRET}'`);
    return shared;
  });
  t("and anything else can still be private", () =>
    psql(`select array_length(private_to, 1) from conversations where id = '${SECRET}'`) === "1");

  // ---- the record ----
  t("everything already written is in the record", () =>
    psql(`select count(*) from message_record where source = 'text'`) === "2");
  psql(`insert into messages (conversation_id, direction, body) values ('${OPEN}', 'outbound', 'on our way')`);
  psql(`update messages set body = 'on our way, 10 min' where body = 'on our way'`);
  psql(`delete from messages where body = 'on our way, 10 min'`);
  t("a message, its edit and its deletion are each kept", () =>
    psql(`select string_agg(event || ':' || body, ' | ' order by id) from message_record where body like 'on our way%'`)
      === "sent:on our way | edited:on our way, 10 min | deleted:on our way, 10 min");
  psql(`update messages set direction = 'inbound' where body = 'the sink is leaking'`);
  t("a change that is not to the words is not an edit", () =>
    psql(`select count(*) from message_record where body = 'the sink is leaking'`) === "1");
  t("team chat is kept", () => {
    psql(`insert into dm_messages (thread_id, author_id, body) values (gen_random_uuid(), '${NAT}', 'between us')`);
    return psql(`select count(*) from message_record where source = 'team' and body = 'between us'`) === "1";
  });
  t("notes are kept", () => {
    psql(`insert into notes (conversation_id, author_id, body) values ('${OPEN}', '${ALEX}', 'called her')`);
    return psql(`select count(*) from message_record where source = 'note'`) === "1";
  });
  t("the owner can read the record", () => Number(as(OWNER, `select count(*) from message_record`)) > 3);
  t("nobody else can", () => as(ALEX, `select count(*) from message_record`) === "0");
  const refused = (sql) => { try { psql(sql); return false; } catch { return true; } };
  t("the record cannot be edited, even by the superuser", () =>
    refused(`update message_record set body = 'nothing to see' where id = 1`));
  t("or deleted", () => refused(`delete from message_record where id = 1`));
  t("or emptied", () => refused(`truncate message_record cascade`));

  // ---- the watch-list ----
  psql(`insert into watch_words (phrase) values ('loan'), ('cash only'), ('$5k')`);
  const said = (body) => {
    psql(`insert into messages (conversation_id, direction, body) values ('${OPEN}', 'inbound', '${body}')`);
    return psql(`select string_agg(h.phrase, ',' order by h.phrase) from watch_hits h
      join message_record r on r.id = h.record_id where r.body = '${body}'`);
  };
  t("a watched word is caught", () => said("can I get a loan?") === "loan");
  t("whatever its case", () => said("LOAN please") === "loan");
  t("but not inside another word", () => said("ask Sloane") === "");
  t("a phrase is caught", () => said("pay me cash only ok") === "cash only");
  t("a phrase with a symbol in it is words, not a pattern", () =>
    said("it was $5k") === "$5k" && said("it was 5k") === "");
  t("a hit asks the app to alert, carrying the key", () => {
    const sent = psql(`select headers->>'Authorization' || ' ' || url from net.sent order by id desc limit 1`);
    return sent === "Bearer k-the-key https://app.larabeehomesllc.com/api/watch/alert";
  });
  t("a deletion raises no new alarm", () => {
    const before = psql(`select count(*) from watch_hits`);
    psql(`delete from messages where body = 'LOAN please'`);
    return psql(`select count(*) from watch_hits`) === before;
  });
  t("only the owner can keep the watch-list", () => {
    try { as(ALEX, `insert into watch_words (phrase) values ('mine')`); } catch { /* refused */ }
    return psql(`select count(*) from watch_words where phrase = 'mine'`) === "0";
  });
  t("and only he sees the hits", () =>
    as(ALEX, `select count(*) from watch_hits`) === "0"
    && Number(as(OWNER, `select count(*) from watch_hits`)) > 0);

  // ---- areas ----
  psql(`update staff set hidden_areas = '{distributions,pay,trail,investors}' where id = '${NAT}'`);
  t("Natashia has the four areas hidden", () =>
    psql(`select array_to_string(hidden_areas, ',') from staff where id = '${NAT}'`)
      === "distributions,pay,trail,investors");
  t("so the distribution rows are refused to her", () =>
    as(NAT, `select count(*) from distribution_statements`) === "0");
  t("and the trail", () => as(NAT, `select count(*) from shift_pings`) === "0");
  t("but not to Alex, who is Office too", () =>
    as(ALEX, `select count(*) from distribution_statements`) === "1");
  t("nor to the owner", () => as(OWNER, `select count(*) from shift_pings`) === "1");
  psql(`update staff set hidden_areas = '{}' where id = '${NAT}'`);
  why = apply();
  t("a re-run does not hide them again once the owner has changed his mind", () =>
    why === null && psql(`select cardinality(hidden_areas) from staff where id = '${NAT}'`) === "0");
} catch (e) {
  results.push(`FAIL  the harness itself fell over: ${String(e.stderr ?? e.message).slice(0, 300)}`);
} finally {
  try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d stop -m fast`)); } catch { /* fine */ }
}

console.log(results.join("\n"));
const bad = results.filter((r) => r.startsWith("FAIL")).length;
console.log(bad ? `\n${bad} failed` : "\nthe record holds");
process.exit(bad ? 1 : 0);
