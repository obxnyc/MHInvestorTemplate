#!/usr/bin/env node
/**
 * Run the migrations, instead of pasting them into a web page.
 *
 *   node docs/shared-line/run.mjs            # the ones not yet applied
 *   node docs/shared-line/run.mjs 046 047    # just these
 *   node docs/shared-line/run.mjs --list     # what is here and what has run
 *
 * Needs DATABASE_URL, which is the Postgres connection string from
 * Supabase: Project Settings, Database, Connection string, URI. It is a
 * password -- put it in a local .env and never anywhere else.
 *
 * WHAT HAS RUN IS WRITTEN DOWN. Every file here says it is safe to run
 * twice and most of them are, but "most" is not a thing to bet somebody's
 * data on, so this keeps a table of what it has applied and skips those.
 * A file already run by hand in the SQL editor is not in that table, so
 * the first run after this arrives will re-apply it -- which is what
 * "safe to run twice" is for, and why it is checked below rather than
 * assumed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n\n"
    + "  Supabase → your project → Project Settings → Database →\n"
    + "  Connection string → URI. It looks like\n"
    + "  postgresql://postgres.xxxx:PASSWORD@aws-0-....pooler.supabase.com:5432/postgres\n\n"
    + "  Put it in a local .env file. It is a password: it does not belong\n"
    + "  in a chat window, a commit, or a screenshot.");
  process.exit(1);
}

/** Every migration in order. The number at the front is the order. */
const all = readdirSync(here)
  .filter((f) => /^\d{3}-.*\.sql$/.test(f))
  .sort();

const args = process.argv.slice(2);
if (args.includes("--list") || args.includes("-l")) {
  // Filled in below, once the database has been asked.
}

/* `pg` lives with the application's other dependencies, not beside this
   file -- so it is resolved from there rather than from here. Without
   this the runner finds nothing and says "Cannot find package 'pg'",
   which is a stack trace at somebody who has just cloned the repo. */
const { createRequire } = await import("node:module");
const require_ = createRequire(join(here, "..", "..", "apps", "inbox", "package.json"));
let pg;
try {
  pg = require_("pg");
} catch {
  console.error("The postgres driver is not installed.\n\n"
    + "  cd apps/inbox && npm install\n\n"
    + "  then run this again.");
  process.exit(1);
}
/* Supabase terminates TLS with its own certificate chain; `rejectUnauthorized`
   false is what every Supabase client example uses for a direct connection
   and is the difference between this running and a wall of SELF_SIGNED. */
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();
} catch (e) {
  console.error(`Could not reach the database: ${e.message}`);
  console.error("\n  Check DATABASE_URL, and that the password in it is the"
    + "\n  database password rather than an API key.");
  process.exit(1);
}

await db.query(`
  create table if not exists schema_migrations (
    file       text primary key,
    applied_at timestamptz not null default now()
  )`);

const done = new Set(
  (await db.query("select file from schema_migrations")).rows.map((r) => r.file));

/**
 * THE FIRST RUN AGAINST A DATABASE THAT IS ALREADY IN USE.
 *
 * Nothing is written down yet, so every migration here looks outstanding
 * -- including the forty that were pasted into the SQL editor months ago.
 * Most say they are safe to run twice and most are; "most" is not a thing
 * to bet somebody's property records on, and a few of these drop and
 * recreate.
 *
 * So: if this table has just appeared and the database plainly has a
 * history, stop and make somebody say which it is. Running everything on
 * an empty database is the ordinary case and is allowed; the dangerous
 * one is the case this refuses.
 */
const inUse = Number((await db.query(
  `select count(*) from information_schema.tables
    where table_schema = 'public' and table_name <> 'schema_migrations'`
)).rows[0].count);

const assume = (args.find((a) => a.startsWith("--assume")) ?? "").split("=")[1]
  ?? (args.includes("--assume") ? args[args.indexOf("--assume") + 1] : undefined);

if (assume) {
  const upto = all.filter((f) => f.slice(0, 3) <= String(assume).padStart(3, "0"));
  for (const f of upto) {
    await db.query(
      "insert into schema_migrations (file) values ($1) on conflict do nothing", [f]);
  }
  console.log(`Marked ${upto.length} migration${upto.length === 1 ? "" : "s"}`
    + ` up to ${assume} as already applied. Nothing was run.`);
  console.log("Run it again to apply whatever is left.");
  await db.end();
  process.exit(0);
}

if (!done.size && inUse > 0 && !args.length) {
  console.error(
    `This database already has ${inUse} tables in it and no record of which`
    + " migrations have been run.\n\n"
    + "  Running all of them could re-apply work from months ago. Say which\n"
    + "  ones are already in, and they will be written down without being run:\n\n"
    + `    node docs/shared-line/run.mjs --assume 044\n\n`
    + "  (044 being the last one you know has been applied — then run it\n"
    + "  again and it will do only what is left.)\n\n"
    + "  Or name the ones to run outright:\n\n"
    + "    node docs/shared-line/run.mjs 045 046 047 048\n");
  await db.end();
  process.exit(1);
}

const wanted = args.filter((a) => !a.startsWith("-"));
const todo = all.filter((f) => {
  if (wanted.length) return wanted.some((w) => f.startsWith(w) || f === w);
  return !done.has(f);
});

if (args.includes("--list") || args.includes("-l")) {
  for (const f of all) console.log(`${done.has(f) ? "  run" : "  --- "} ${f}`);
  console.log(`\n${done.size} of ${all.length} recorded as applied.`);
  await db.end();
  process.exit(0);
}

if (!todo.length) {
  console.log("Nothing to run; everything here is already applied.");
  await db.end();
  process.exit(0);
}

console.log(`${todo.length} to run:\n${todo.map((f) => "  " + f).join("\n")}\n`);

let failed = null;
for (const file of todo) {
  const sql = readFileSync(join(here, file), "utf8");
  process.stdout.write(`${file} … `);
  try {
    /* ONE TRANSACTION EACH. A migration that stops halfway is worse than
       one that does not run: the next attempt meets a database in a shape
       neither the old code nor the new one expects. */
    await db.query("begin");
    await db.query(sql);
    await db.query(
      "insert into schema_migrations (file) values ($1) on conflict do nothing",
      [file]);
    await db.query("commit");
    console.log("ok");
  } catch (e) {
    await db.query("rollback").catch(() => {});
    console.log("FAILED");
    console.error(`\n  ${e.message}\n`);
    if (e.position) console.error(`  at character ${e.position}\n`);
    failed = file;
    break;
  }
}

await db.end();
if (failed) {
  console.error(`Stopped at ${failed}. Nothing from that file was applied,`
    + " and nothing after it was tried.");
  process.exit(1);
}
console.log("\nAll applied.");
