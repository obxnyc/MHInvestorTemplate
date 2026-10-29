#!/usr/bin/env node
/**
 * Apply the migrations over HTTPS, so nobody has to open the SQL editor.
 *
 *   node docs/shared-line/apply.mjs            # the ones not yet applied
 *   node docs/shared-line/apply.mjs 046 047    # just these
 *   node docs/shared-line/apply.mjs --list     # what is here and what has run
 *   node docs/shared-line/apply.mjs --check    # can this machine reach it at all
 *
 * WHY THIS EXISTS ALONGSIDE run.mjs. `run.mjs` opens a Postgres socket on
 * port 5432, which is the right tool from a laptop. It is the wrong tool
 * from inside an agent container: outbound traffic there goes through an
 * HTTP proxy, a proxy carries HTTPS and not the Postgres wire protocol, so
 * 5432 is refused however the policy is set. This speaks to Supabase's
 * Management API over ordinary HTTPS on 443, which the proxy does carry.
 *
 * It keeps the SAME ledger as run.mjs -- the `schema_migrations` table,
 * the same rows -- so the two can be used against the same database on
 * different days without disagreeing about what has been applied.
 *
 * THE TOKEN CAN ARRIVE TWO WAYS, and the better one never reaches this
 * process. A Bearer *network secret* on the cloud environment, listing
 * `api.supabase.com`, has Anthropic's proxy add the Authorization header
 * after the request has left the container -- so the token is not in the
 * environment, not in a file, and not in anything printed here. It also
 * makes that host reachable without touching the allowed-domains list.
 * Nothing is set here in that case and no header is sent, so the one
 * added on the way out is the only one.
 *
 * Otherwise SUPABASE_ACCESS_TOKEN is read from the environment, which
 * works the same and puts the token inside the container. Either way it
 * is a personal access token from
 * https://supabase.com/dashboard/account/tokens -- NOT the anon key, NOT
 * the service role key, and not the database password, and never a thing
 * to paste into a commit or a chat window.
 *
 * SUPABASE_PROJECT_REF is optional. Without it the token is asked which
 * projects it can see, and a single project is taken as the answer. Two
 * projects and it stops: picking one would be guessing, and the wrong
 * guess here writes somebody's schema into somebody else's database.
 *
 * THE SHAPE OF THIS API IS A HYPOTHESIS, and this file says so out loud
 * because it was written on a machine whose egress policy refuses
 * api.supabase.com, so not one line of it has met the real service. The
 * endpoints below are what Supabase's own tooling uses. If they have moved,
 * every failure here prints the status and the body it actually got, so
 * one run corrects it rather than leaving somebody guessing.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);

/* Overridable so the harness can point this at a stand-in. Nothing else
   should ever set it. */
const API = (process.env.SUPABASE_API ?? "https://api.supabase.com").replace(/\/$/, "");

/* Absent is not an error: it is the network-secret case, where the proxy
   adds the header on the way out. What settles which of the two is
   happening is a 401, and that is reported in full when it comes. */
const token = process.env.SUPABASE_ACCESS_TOKEN;
console.log(token
  ? "Authenticating with SUPABASE_ACCESS_TOKEN from the environment."
  : "No SUPABASE_ACCESS_TOKEN here; expecting a network secret to add the"
    + " header on the way out.");

/** Every migration in order. The number at the front is the order. */
const PATTERN = /^\d{3}-[A-Za-z0-9-]+\.sql$/;
const all = readdirSync(here).filter((f) => PATTERN.test(f)).sort();

/* The one place a filename becomes part of a SQL string. Parameters are not
   on offer here -- the API takes text -- so the name is checked against the
   pattern it was listed by and the quotes are doubled anyway. Belt and
   braces, because the alternative is an injection into a migration runner. */
const literal = (file) => {
  if (!PATTERN.test(file)) throw new Error(`refusing to quote ${file}`);
  return `'${file.replace(/'/g, "''")}'`;
};

/** Never print the token, including inside something that echoes a header.
    With no token here there is nothing to scrub, and `split(undefined)`
    would quietly scrub nothing -- so that case is said rather than left to
    fall out of the arithmetic. */
const scrub = (s) => (token ? String(s).split(token).join("sbp_…") : String(s));

const api = async (path, init = {}) => {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        /* No token here means the proxy is adding it on the way out.
           Sending `Bearer undefined` would be a header for it to collide
           with. */
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (e) {
    throw new Error(`could not reach ${API}${path}: ${scrub(e.message)}`);
  }
  const body = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 && !token
      ? "\n  Nothing authenticated that. Either there is no network secret on"
        + " this\n  environment, or it does not list api.supabase.com."
      : "";
    throw new Error(
      `${API}${path} answered ${res.status}: ${scrub(body).slice(0, 400)}${hint}`);
  }
  try { return body ? JSON.parse(body) : null; } catch { return body; }
};

/** Run SQL and hand back the rows, whatever the service wraps them in. */
const sql = async (text) => {
  const out = await api(`/v1/projects/${ref}/database/query`,
    { method: "POST", body: JSON.stringify({ query: text }) });
  if (Array.isArray(out)) return out;
  if (out && Array.isArray(out.result)) return out.result;
  return [];
};

/* ---- which project ------------------------------------------------- */

let ref = process.env.SUPABASE_PROJECT_REF;
if (!ref) {
  const projects = await api("/v1/projects");
  const list = Array.isArray(projects) ? projects : [];
  if (list.length === 1) {
    ref = list[0].id ?? list[0].ref;
    console.log(`Project: ${list[0].name ?? ref} (${ref})`);
  } else if (!list.length) {
    console.error("That token can see no projects at all.");
    process.exit(1);
  } else {
    console.error(
      `That token can see ${list.length} projects, so which one is a guess:\n`
      + list.map((p) => `    ${p.id ?? p.ref}  ${p.name ?? ""}`).join("\n")
      + "\n\n  Set SUPABASE_PROJECT_REF to the one this repo belongs to.");
    process.exit(1);
  }
}

/* ---- can this machine do any of it at all --------------------------- */

if (has("--check")) {
  const rows = await sql("select current_database() as db, version() as v");
  const r = rows[0] ?? {};
  console.log(`Reached ${ref}. Database ${r.db ?? "?"}.`);
  console.log(String(r.v ?? "").slice(0, 60));
  process.exit(0);
}

/* ---- the ledger ----------------------------------------------------- */

await sql(`create table if not exists schema_migrations (
    file       text primary key,
    applied_at timestamptz not null default now()
  )`);

const done = new Set(
  (await sql("select file from schema_migrations")).map((r) => r.file));

/**
 * THE FIRST RUN AGAINST A DATABASE THAT IS ALREADY IN USE.
 *
 * The same refusal `run.mjs` makes, for the same reason: nothing is written
 * down yet, so every migration looks outstanding, including the forty
 * pasted into the SQL editor months ago. Most say they are safe to run
 * twice. "Most" is not a thing to bet property records on.
 */
const inUse = Number((await sql(
  `select count(*)::int as count from information_schema.tables
    where table_schema = 'public' and table_name <> 'schema_migrations'`
))[0]?.count ?? 0);

const assume = (args.find((a) => a.startsWith("--assume=")) ?? "").split("=")[1]
  ?? (has("--assume") ? args[args.indexOf("--assume") + 1] : undefined);

if (assume) {
  const upto = all.filter((f) => f.slice(0, 3) <= String(assume).padStart(3, "0"));
  if (upto.length) {
    await sql(`insert into schema_migrations (file) values `
      + upto.map((f) => `(${literal(f)})`).join(", ")
      + ` on conflict do nothing`);
  }
  console.log(`Marked ${upto.length} migration${upto.length === 1 ? "" : "s"}`
    + ` up to ${assume} as already applied. Nothing was run.`);
  console.log("Run it again to apply whatever is left.");
  process.exit(0);
}

const wanted = args.filter((a) => !a.startsWith("-"));

if (!done.size && inUse > 0 && !wanted.length) {
  console.error(
    `This database already has ${inUse} tables in it and no record of which`
    + " migrations have been run.\n\n"
    + "  Say which ones are already in, and they will be written down\n"
    + "  without being run:\n\n"
    + "    node docs/shared-line/apply.mjs --assume 047\n\n"
    + "  Or name the ones to run outright:\n\n"
    + "    node docs/shared-line/apply.mjs 048\n");
  process.exit(1);
}

if (has("--list") || has("-l")) {
  for (const f of all) console.log(`${done.has(f) ? "  run" : "  --- "} ${f}`);
  console.log(`\n${done.size} of ${all.length} recorded as applied.`);
  process.exit(0);
}

const todo = all.filter((f) => (wanted.length
  ? wanted.some((w) => f.startsWith(w) || f === w)
  : !done.has(f)));

if (!todo.length) {
  console.log("Nothing to run; everything here is already applied.");
  process.exit(0);
}

console.log(`${todo.length} to run:\n${todo.map((f) => "  " + f).join("\n")}\n`);

let failed = null;
for (const file of todo) {
  const text = readFileSync(join(here, file), "utf8");
  process.stdout.write(`${file} … `);
  try {
    /* ONE TRANSACTION EACH, and it has to be inside the one request: two
       requests are two sessions, and a `begin` in the first would be rolled
       back by the end of it. A migration that stops halfway leaves a
       database in a shape neither the old code nor the new one expects. */
    await sql(`begin;\n${text}\n;insert into schema_migrations (file) values `
      + `(${literal(file)}) on conflict do nothing;\ncommit;`);
    console.log("ok");
  } catch (e) {
    console.log("FAILED");
    console.error(`\n  ${scrub(e.message)}\n`);
    failed = file;
    break;
  }
}

if (failed) {
  console.error(`Stopped at ${failed}. Nothing from that file was applied,`
    + " and nothing after it was tried.");
  process.exit(1);
}
console.log("\nAll applied.");
