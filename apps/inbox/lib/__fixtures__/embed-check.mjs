/** An embed PostgREST cannot disambiguate fails the whole select.
 *  Run: node lib/__fixtures__/embed-check.mjs
 *
 *  `shifts` points at staff twice (staff_id, settled_by) and so does
 *  `shift_edits` (staff_id, decided_by). A select that says `staff(full_name)`
 *  on either is refused outright -- PGRST201, "more than one relationship" --
 *  and the code reading it sees `data: null`. The office's week grid read as
 *  nobody having worked, and the corrections queue said "run migration 039"
 *  to an office that had run it, so no correction ever reached anybody.
 *
 *  Nothing in a type, a test of the arithmetic, or a stand-in database that
 *  does not model foreign keys can see this. So the rule is read off the
 *  schema itself: every table the migrations give more than one foreign key
 *  to a target, and every query in the app that embeds that target from that
 *  table without naming the key. The table list is DERIVED, not written here
 *  -- a third table growing a second staff column is caught the day it does.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "..");
const sqlDir = join(app, "..", "..", "docs", "shared-line");

const checks = [];
const t = (name, ok, why = "") => checks.push([name, !!ok, why]);

/* --------------------------------------------- the schema: who points where */
const strip = (s) => s.replace(/--[^\n]*/g, "");
const fks = new Map(); // "table" -> Map(target -> Set(column))
const note = (table, col, target) => {
  const m = fks.get(table) ?? new Map();
  const s = m.get(target) ?? new Set();
  s.add(col); m.set(target, s); fks.set(table, m);
};
for (const f of readdirSync(sqlDir).filter((f) => f.endsWith(".sql"))) {
  const sql = strip(readFileSync(join(sqlDir, f), "utf8"));
  // create table T ( ... ) -- the body, cut out first, then columns inside it.
  for (const m of sql.matchAll(/create table(?: if not exists)?\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    for (const c of m[2].matchAll(/^\s*(\w+)\s+uuid[^,\n]*references\s+(?:public\.)?(\w+)/gim)) {
      note(m[1], c[1], c[2]);
    }
  }
  for (const m of sql.matchAll(/alter table(?: if exists)?\s+(?:public\.)?(\w+)\s+add column(?: if not exists)?\s+(\w+)\s+uuid[^;]*?references\s+(?:public\.)?(\w+)/gi)) {
    note(m[1], m[2], m[3]);
  }
}
const ambiguous = [];
for (const [table, targets] of fks) {
  for (const [target, cols] of targets) if (cols.size > 1) ambiguous.push({ table, target, cols: [...cols] });
}

t("the schema reader finds shifts' two links to staff",
  ambiguous.some((a) => a.table === "shifts" && a.target === "staff"));
t("and shift_edits' two",
  ambiguous.some((a) => a.table === "shift_edits" && a.target === "staff"));

/* ------------------------------------------------ the code: who asks for it */
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    if (n === "node_modules" || n === ".next" || n === "__fixtures__") continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(n)) files.push(p);
  }
};
for (const d of ["app", "lib", "components"]) walk(join(app, d));

// Cut each query out first -- from `.from("T")` to the end of its statement
// -- and only then look inside it. An anchor that runs on past its own block
// matches the next query's embed and passes the one at fault.
const bad = [];
let looked = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8").replace(/\/\/[^\n]*/g, "");
  for (const m of src.matchAll(/\.from\("(\w+)"\)/g)) {
    const table = m[1];
    const rest = src.slice(m.index);
    const end = rest.search(/;\s*(\n|$)/);
    const block = end > 0 ? rest.slice(0, end) : rest;
    const sel = block.match(/\.select\(\s*"([^"]*)"/);
    if (!sel) continue;
    for (const a of ambiguous.filter((x) => x.table === table)) {
      looked++;
      // `staff(` with nothing naming the key. `staff!fk(` and `alias:staff!fk(` are fine.
      if (new RegExp(`(^|[\\s,:])${a.target}\\s*\\(`).test(sel[1])) {
        bad.push(`${f.slice(app.length + 1)}: ${table} embeds ${a.target}(...) -- name one of `
          + a.cols.map((c) => `${table}_${c}_fkey`).join(" / "));
      }
    }
  }
}
t("the app's queries on those tables were found", looked > 0);
t("no ambiguous embed anywhere", bad.length === 0, bad.join("\n      "));

/* -------------------------------- and the rule has teeth: a known-bad case */
const fake = `db.from("shifts").select("id, staff(full_name)");`;
const fakeSel = fake.match(/\.select\(\s*"([^"]*)"/)[1];
t("an unnamed embed is caught", /(^|[\s,:])staff\s*\(/.test(fakeSel));
t("a named one is not", !/(^|[\s,:])staff\s*\(/.test("id, staff!shifts_staff_id_fkey(full_name)"));

for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && why ? `\n      ${why}` : ""}`);
const failed = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
