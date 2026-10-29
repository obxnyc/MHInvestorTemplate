/** The HTTPS migration runner, run rather than read.
 *
 *  `docs/shared-line/apply.mjs` is what applies a migration from inside the
 *  agent container, where port 5432 is not on offer. It cannot be tested
 *  against the real Management API from here -- egress refuses
 *  api.supabase.com -- so it is tested against a stand-in that speaks the
 *  same two endpoints with a REAL Postgres behind it. What that cannot
 *  prove is the shape of Supabase's replies; what it can prove is
 *  everything this file decides, which is the half that loses data.
 *
 *  The stand-in answers only the questions the runner asks. It wraps a
 *  single `select` so rows come back as named JSON fields, and runs
 *  anything else as a script with ON_ERROR_STOP -- which is what makes the
 *  rollback check mean something.
 *
 *  IT RUNS IN A PROCESS OF ITS OWN, and that is not tidiness. The first
 *  version served from this process and spawned the runner with
 *  execFileSync, which blocks the event loop -- so the runner's fetch could
 *  not be answered until the runner returned, and the runner could not
 *  return until its fetch was answered. The harness hung with no output at
 *  all, which reads exactly like a harness that is broken.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(here, "..", "..", "..", "..", "docs", "shared-line", "apply.mjs");

const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/local/pgsql/bin"].find((d) => existsSync(join(d, "initdb")));
if (!BIN || !existsSync(RUNNER)) {
  console.log("skipped: no postgres here to run the runner against.");
  process.exit(0);
}

const PORT = "55493";
const dir = mkdtempSync(join(tmpdir(), "apply-"));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
const asPg = (line) => {
  try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
  catch { return ["sh", ["-c", line]]; }
};

const checks = [];
/* Every assertion is a thunk, so a fault that removes a field is reported
   as a named failure rather than taking the run down with a TypeError. */
const t = (name, fn) => {
  try { checks.push([name, fn() === true]); }
  catch (e) {
    const why = String(e.stdout ?? e.stderr ?? e.message ?? e)
      .replace(/\s+/g, " ").trim();
    checks.push([name, false, why.slice(0, 220)]);
  }
};

const TOKEN = "sbp_a_token_that_must_never_be_printed";
const REF = "abcdefghijklmnopqrst";

/* A folder of its own, with migrations written here. Pointing it at the
   real ones would make this a test of those rather than of the runner,
   and could not ask what happens when one of them fails. */
const sqlDir = join(dir, "migrations");
mkdirSync(sqlDir, { recursive: true });
const put = (name, body) => writeFileSync(join(sqlDir, name), body);
put("001-first.sql", "create table if not exists one (id int primary key);");
/* The first statement succeeds and the second does not: so "nothing was
   left behind" is a claim with something to leave behind. */
put("002-broken.sql",
  "create table if not exists two (id int primary key);\n"
  + "create table two_again (id int references nowhere(id));");
put("003-after.sql", "create table if not exists three (id int primary key);");
writeFileSync(join(sqlDir, "apply.mjs"), readFileSync(RUNNER, "utf8"));

let server, standIn;
const projectsFile = join(dir, "projects.json");
/* The server reads this afresh on every request, so the harness can change
   which projects the token can see without restarting anything. */
const setProjects = (list) =>
  writeFileSync(projectsFile, JSON.stringify(list));
setProjects([{ id: REF, name: "Larabee-inbox" }]);

try {
  run("chmod", ["777", dir]);
  run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
  run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start`));
  await new Promise((r) => setTimeout(r, 1500));
  const psql = (db, sql, extra = []) => run("psql",
    ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", db, "-X", "-q", "-t", "-A",
      "-v", "ON_ERROR_STOP=1", ...extra, "-c", sql]);
  psql("postgres", "create database t");

  /* ---- the stand-in, in a process of its own ------------------------- */
  const portFile = join(dir, "port");
  writeFileSync(join(dir, "server.mjs"), `
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [TOKEN, REF, PORT, dir, projectsFile, portFile] = process.argv.slice(2);
const psql = (args) => execFileSync("psql", args, { encoding: "utf8", stdio: "pipe" });
const base = ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t", "-X", "-q",
  "-v", "ON_ERROR_STOP=1"];
const onlyOneSelect = (q) =>
  /^\\s*select\\b/i.test(q) && !/;\\s*\\S/.test(q.replace(/;\\s*$/, ""));
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const say = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
    };
    // A network secret is added by the proxy AFTER the request leaves the
    // container, so from the API's side it simply arrives authorized while
    // the caller sent nothing. The flag file stands in for that.
    writeFileSync(dir + "/lastauth", req.headers.authorization ?? "(none)");
    const proxied = existsSync(dir + "/proxy");
    if (!(req.headers.authorization === "Bearer " + TOKEN
          || (proxied && !req.headers.authorization))) {
      return say(401, { message: "Unauthorized: bad or expired token" });
    }
    if (req.url === "/v1/projects") {
      return say(200, JSON.parse(readFileSync(projectsFile, "utf8")));
    }
    if (req.url === "/v1/projects/" + REF + "/database/query") {
      let q;
      try { q = JSON.parse(body).query; }
      catch { return say(400, { message: "bad body" }); }
      try {
        if (onlyOneSelect(q)) {
          const wrapped = "select coalesce(json_agg(t), '[]'::json) from ("
            + q.replace(/;\\s*$/, "") + ") t";
          return say(200, JSON.parse(psql([...base, "-t", "-A", "-c", wrapped]).trim() || "[]"));
        }
        const f = dir + "/q.sql";
        writeFileSync(f, q);
        psql([...base, "-f", f]);
        return say(200, []);
      } catch (e) {
        const why = String(e.stderr ?? e.message ?? e).replace(/\\s+/g, " ").trim();
        // A gateway echoing the request's own credentials back inside an
        // error is the whole reason the runner scrubs. Without a reply that
        // actually carries it, "the token is never printed" passes whether
        // the scrubbing is there or not.
        return say(400, { message: why.slice(0, 300)
          + " [authorized as " + req.headers.authorization + "]" });
      }
    }
    say(404, { message: "no such endpoint" });
  });
}).listen(0, "127.0.0.1", function () {
  writeFileSync(portFile, String(this.address().port));
});
`);
  server = spawn("node", [join(dir, "server.mjs"), TOKEN, REF, PORT, dir,
    projectsFile, portFile], { stdio: "ignore" });
  for (let i = 0; i < 100 && !existsSync(portFile); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!existsSync(portFile)) throw new Error("the stand-in never came up");
  standIn = `http://127.0.0.1:${readFileSync(portFile, "utf8").trim()}`;

  /* ---- driving the runner -------------------------------------------- */
  const apply = (argv = [], env = {}) => {
    try {
      const out = run("node", [join(sqlDir, "apply.mjs"), ...argv], {
        env: {
          ...process.env, SUPABASE_API: standIn, SUPABASE_ACCESS_TOKEN: TOKEN,
          SUPABASE_PROJECT_REF: REF, ...env,
        },
      });
      return { code: 0, out };
    } catch (e) {
      return {
        code: e.status ?? 1,
        out: String(e.stdout ?? "") + String(e.stderr ?? ""),
      };
    }
  };
  const tables = () => psql("t",
    "select table_name from information_schema.tables where table_schema='public'")
    .split("\n").map((s) => s.trim()).filter(Boolean);
  const ledger = () => {
    try {
      return psql("t", "select file from schema_migrations order by file")
        .split("\n").map((s) => s.trim()).filter(Boolean);
    } catch { return []; }
  };

  /* An empty database: the ordinary case, and allowed. */
  const first = apply(["001"]);
  t("it applies the one it was given", () => first.code === 0
    && tables().includes("one"));
  t("and writes it down", () => ledger().join() === "001-first.sql");
  t("the rows come back as named fields, not as text",
    () => !/undefined/.test(first.out));

  const again = apply(["001"]);
  t("naming one already applied re-runs it rather than refusing",
    () => again.code === 0);

  const nothing = apply();
  t("with nothing outstanding before the broken one, it runs them in order",
    () => nothing.code !== 0 && /002-broken/.test(nothing.out));
  t("a file that fails leaves nothing of itself behind",
    () => !tables().includes("two"));
  t("and is not written down as applied",
    () => !ledger().includes("002-broken.sql"));
  t("and the ones after it are not tried",
    () => !tables().includes("three") && !/003-after … ok/.test(nothing.out));

  /* The dangerous first run: a database with a history and no ledger. */
  psql("t", "drop table schema_migrations");
  const dangerous = apply();
  t("a database with tables and no ledger is refused",
    () => dangerous.code !== 0 && /no record of which/.test(dangerous.out));
  t("and nothing was run by that refusal",
    () => !tables().includes("three"));

  const assumed = apply(["--assume", "002"]);
  t("--assume writes them down", () => assumed.code === 0
    && ledger().join() === "001-first.sql,002-broken.sql");
  t("and does not run them", () => !tables().includes("two"));

  const rest = apply();
  t("then the rest goes in", () => rest.code === 0 && tables().includes("three"));
  const done = apply();
  t("and a second time there is nothing to do",
    () => done.code === 0 && /Nothing to run/.test(done.out));

  /* Two projects, and no ref: picking one would be a guess. */
  setProjects([{ id: REF, name: "Larabee-inbox" }, { id: "second", name: "Other" }]);
  const ambiguous = apply([], { SUPABASE_PROJECT_REF: "" });
  t("it will not guess between two projects",
    () => ambiguous.code !== 0 && /which one is a guess/.test(ambiguous.out));
  setProjects([{ id: REF, name: "Larabee-inbox" }]);
  const single = apply(["--check"], { SUPABASE_PROJECT_REF: "" });
  t("but one project is an answer rather than a guess",
    () => single.code === 0 && single.out.includes(REF));

  /* A refusal from the service is reported, not swallowed. */
  const wrong = apply([], { SUPABASE_ACCESS_TOKEN: "sbp_wrong" });
  t("a 401 is reported with its status and what it said",
    () => wrong.code !== 0 && /401/.test(wrong.out) && /Unauthorized/.test(wrong.out));

  /* THE NETWORK-SECRET CASE: nothing in the environment, and the proxy adds
     the header on the way out. This is the way the token never enters the
     container at all, so it is the way it will actually be run. */
  writeFileSync(join(dir, "proxy"), "");
  const proxied = apply(["--check"], { SUPABASE_ACCESS_TOKEN: "" });
  t("it runs with no token here, for the proxy to add the header",
    () => proxied.code === 0);
  t("and sends no Authorization of its own for that one to collide with",
    () => readFileSync(join(dir, "lastauth"), "utf8") === "(none)");
  rmSync(join(dir, "proxy"));
  const unauthed = apply(["--check"], { SUPABASE_ACCESS_TOKEN: "" });
  t("and with no token and no secret either, the 401 says which is missing",
    () => unauthed.code !== 0 && /network secret/.test(unauthed.out));

  /* The output of every one of those comes back to whoever ran it. */
  const everything = [first, again, nothing, dangerous, assumed, rest, done,
    ambiguous, single, wrong, proxied, unauthed].map((r) => r.out).join("\n");
  t("the service echoed the token back, so there was something to scrub",
    () => /authorized as/.test(nothing.out));
  t("the token is never printed", () => !everything.includes(TOKEN));
} finally {
  try { server?.kill(); } catch { /* down */ }
  try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -m immediate stop`)); } catch { /* down */ }
  rmSync(dir, { recursive: true, force: true });
}

let bad = 0;
for (const [name, ok, why] of checks) {
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
console.log(bad
  ? `\n${bad} of ${checks.length} failed.`
  : "a migration goes in from here, or it goes in not at all");
process.exit(bad ? 1 : 0);
