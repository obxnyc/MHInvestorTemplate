/** Not everyone on the investors list is an investor.
 *
 *  Twenty of the fifty-nine names on that screen were never investors:
 *  nineteen residents who own their own home and rent the lot it stands
 *  on, and Hudson Yards LLC, which is one of our own companies. Every
 *  one of them was listed as somebody we sell homes to, and the only way
 *  to find out was for the owner to read them to me one at a time.
 *
 *  What can go wrong here is not arithmetic. It is a list that quietly
 *  shows everybody and looks filtered, and a column that is not there
 *  being reported as "they are all investors".
 *
 *      node apps/inbox/lib/__fixtures__/kinds-check.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const app = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = join(app, "..", "..");
const SQL = join(root, "docs", "shared-line",
  "050-not-everyone-on-this-list-is-an-investor.sql");

const checks = [];
const t = (name, fn) => {
  try { checks.push([name, fn() === true]); }
  catch (e) {
    checks.push([name, false,
      String(e.stderr ?? e.message ?? e).replace(/\s+/g, " ").slice(0, 200)]);
  }
};

/** The balanced {...} at a marker; a fixed window reads on into the next. */
function blockAt(src, marker, from = 0) {
  const at = src.indexOf(marker, from);
  if (at < 0) return "";
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

const board = readFileSync(join(app, "components", "OwnersBoard.tsx"), "utf8");
const api = readFileSync(join(app, "app", "api", "owners", "route.ts"), "utf8");

// ---- the list is actually filtered ----------------------------------
/* THE FAULT THIS EXISTS FOR. A tab strip that looks like a filter and
   shows everybody is the Unread tab again -- it matched no branch in the
   query at all and fell through to no filter. So the question is not
   "are there tabs", it is "does the tab decide what is listed". */
t("the tab decides who is listed", () => {
  const f = blockAt(board, "const inTab = useMemo(");
  return /r\.kind === tab/.test(f);
});
t("and the text search runs inside the tab, not across all of them", () => {
  const f = blockAt(board, "const shown = useMemo(");
  return /inTab\.filter/.test(f) && !/rows\.filter/.test(f);
});
t("the counts come from the rows, not from the tab", () => {
  const f = blockAt(board, "const tally = useMemo(");
  return /rows \?\? \[\]/.test(f) && /r\.kind/.test(f);
});

/* A column that is not there is not "everybody is an investor". The same
   pair as `holdings` and `papers`: a sentence about the database must
   not be written as though it were a fact about the business. */
t("a missing column is told apart from everyone being an investor", () =>
  /setKinds\(out\.kinds !== false\)/.test(board)
  && /!kinds && rows\.length > 0/.test(board)
  && /!kinds \|\| r\.kind === tab/.test(board));

/* And the list must not empty itself when the column is missing -- it
   worked yesterday and a migration nobody has run yet is not a reason
   for every investor to vanish. */
t("the api falls back rather than emptying the list", () => {
  const get = api.slice(api.indexOf("export async function GET"),
    api.indexOf("export async function POST"));
  return /const fell = error/.test(get)
    && /select\("id, name, legal_name"\)/.test(get)
    && /kind: o\.kind \?\? "investor"/.test(get);
});

// ---- moving somebody is a press -------------------------------------
t("somebody can be moved between the three from the screen", () =>
  /method: "PATCH"/.test(blockAt(board, "const setKind = async")));
/* The REFUSAL has to come before the reload, not merely after the parse.
   Measured against `await res.json()` this passed with the reload moved
   above the error check -- the parse was still first, and the pair being
   compared was not the pair that matters. */
t("and nothing on screen moves until the server says so", () => {
  const f = blockAt(board, "const setKind = async");
  const read = f.indexOf("await res.json()");
  const refuse = f.search(/if \(!res\.ok \|\| !out\.ok\)/);
  const reload = f.indexOf("await load()");
  return read > -1 && refuse > read && reload > refuse;
});

const patch = api.slice(api.indexOf("export async function PATCH"));
t("only the desk may move anybody", () =>
  /role !== "admin" && me\?\.role !== "office"/.test(patch));
t("and only to one of the three", () =>
  /\["investor", "resident", "ours"\]\.includes\(kind\)/.test(patch));

/* IT CHANGES A LABEL AND NOTHING ELSE. Checked as an exact key set, the
   way closeIssue is: a check that only asserts `kind` is present lets a
   second field be added to somebody's live records with nothing
   objecting. */
t("and writes the label and nothing else", () => {
  const upd = (patch.match(/\.update\(\{([^}]*)\}\)/) ?? [])[1] ?? "";
  const keys = upd.split(",").map((k) => k.split(":")[0].trim()).filter(Boolean);
  return keys.length === 1 && keys[0] === "kind";
});

/* A resident has no purchase agreement from us and never did, so the way
   in should not be called Papers. */
t("a resident's card does not offer to draw papers", () =>
  /r\.kind === "investor" \? "Papers" : "Open"/.test(board));

/* The fixture has to carry more than one kind, or "the tab filters" and
   "the tab shows everybody" are the same list. */
t("the stand-in has all three kinds in it", () => {
  const stub = readFileSync(
    join(app, "lib", "__fixtures__", "stub-supabase.mjs"), "utf8");
  /* The owners array only -- `blockAt` counts braces and this is a
     bracket, and reading the whole file would find these words in the
     comments that explain them. */
  const at = stub.indexOf("owners: [");
  const owners = at < 0 ? "" : stub.slice(at, stub.indexOf("\n  ],", at));
  return owners.length > 50 && ["investor", "resident", "ours"]
    .every((k) => owners.includes(`kind: "${k}"`));
});

// -------------------------------------------- the migration, run not read
const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin",
  "/usr/lib/postgresql/17/bin", "/usr/local/pgsql/bin"]
  .find((d) => existsSync(join(d, "initdb")));

if (!BIN) {
  checks.push(["the migration was run against a real postgres", false,
    "no postgres on this machine — the SQL has NOT been checked"]);
} else {
  const PORT = "55471";
  const dir = mkdtempSync(join(tmpdir(), "kinds-check-"));
  const run = (cmd, args, opts = {}) =>
    execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
  const asPg = (line) => {
    try { run("id", ["postgres"]); return ["su", ["postgres", "-c", line]]; }
    catch { return ["sh", ["-c", line]]; }
  };
  try {
    run("chmod", ["777", dir]);
    run(...asPg(`${BIN}/initdb -D ${dir}/d -A trust -U postgres`));
    run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -o '-p ${PORT} -k /tmp' -l ${dir}/log start`));
    await new Promise((r) => setTimeout(r, 1500));
    const psql = (sql) => run("psql",
      ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t", "-tAc", sql])
      .split("\n")[0].trim();
    const refuses = (sql) => { try { psql(sql); return false; } catch { return true; } };

    run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "postgres",
      "-c", "create database t"]);
    psql(`create table owners (
            id uuid primary key default gen_random_uuid(),
            name text, legal_name text, active boolean default true);
          insert into owners (name) values
            ('Earl McGraw'), ('Lori Cooke'), ('Hudson Yards LLC'),
            ('Andrew Habberstad'), ('SHB INVESTMENTS');`);

    let applied = true, why = "";
    try {
      run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
        "-v", "ON_ERROR_STOP=1", "-f", SQL]);
    } catch (e) {
      applied = false;
      why = String(e.stderr ?? e.message).replace(/\s+/g, " ").trim().slice(0, 240);
    }
    checks.push(["the migration applies", applied, why]);
    if (!applied) throw new Error("stopping: nothing below can be true");

    t("and applies again, because it will be pasted twice", () => {
      run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
        "-v", "ON_ERROR_STOP=1", "-f", SQL]);
      return true;
    });

    /* EVERY EXISTING ROW KEEPS THE MEANING IT HAD. The distinction is
       not derivable -- "no sale recorded" describes a resident AND the
       eighty-four Northside lots whose sales an import destroyed -- so
       nothing here may guess. */
    t("an owner nobody named is still an investor", () =>
      psql("select kind from owners where name = 'Andrew Habberstad'") === "investor"
      && psql("select kind from owners where name = 'SHB INVESTMENTS'") === "investor");

    t("the six named residents are residents", () =>
      psql("select kind from owners where name = 'Earl McGraw'") === "resident"
      && psql("select kind from owners where name = 'Lori Cooke'") === "resident");

    t("and our own company is ours", () =>
      psql("select kind from owners where name = 'Hudson Yards LLC'") === "ours");

    /* `Lori cook` was how it was typed and `Lori Cooke` is the row, so
       the match is case-insensitive -- but it must stay an EXACT name
       match, because `like` would make SHB Investments and SHB
       INVESTMENTS the same row by accident. */
    t("the match is on the whole name, not a prefix", () => {
      psql(`insert into owners (name) values ('Earl McGrawson')`);
      run("psql", ["-h", "/tmp", "-p", PORT, "-U", "postgres", "-d", "t",
        "-v", "ON_ERROR_STOP=1", "-f", SQL]);
      return psql("select kind from owners where name = 'Earl McGrawson'")
        === "investor";
    });

    t("a kind nobody has heard of is refused", () =>
      refuses("update owners set kind = 'tenant' where name = 'Earl McGraw'"));

    t("and a new owner starts as an investor", () =>
      psql("insert into owners (name) values ('Someone New') returning kind")
        === "investor");

  } catch (e) {
    const why2 = String(e && e.message || e).replace(/\s+/g, " ").trim();
    if (!/^stopping:/.test(why2)) checks.push(["the harness ran to the end", false, why2]);
  } finally {
    try { run(...asPg(`${BIN}/pg_ctl -D ${dir}/d -m immediate stop`)); } catch { /* down */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

let bad = 0;
for (const [name, ok, note] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${!ok && note ? ` — ${note}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${checks.length}`); process.exit(1); }
console.log("three kinds of owner, and the list shows one of them at a time");
