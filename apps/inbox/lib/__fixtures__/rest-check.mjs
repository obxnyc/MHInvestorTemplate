/** A column named in a hand-written PostgREST URL has to exist.
 *
 *  The setup page asked for `conversations?...&channel=neq.sms`. There is no
 *  `channel` on conversations -- that column is on `messages` -- so PostgREST
 *  answered 400, the check returned an empty list, and the whole thing
 *  VANISHED FROM THE PAGE. It had never once appeared since it was written.
 *  The owner opened that page looking for exactly that line and found a gap
 *  where it should have been.
 *
 *  Nothing could have caught it. A supabase-js call gets some help from the
 *  select string, but a URL built by hand is a string: the type checker has
 *  no opinion, the query only fails at runtime, and the failure was swallowed.
 *
 *  So the columns are read out of the migrations and checked against the
 *  ones these URLs name. Same idea as reading the property kinds out of
 *  property.ts rather than trusting a list written beside them.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "..");
const sqlDir = join(app, "..", "..", "docs", "shared-line");

/* ---------------------------------------------- what the database actually has */

const columns = new Map();            // table -> Set(column)
const add = (table, col) => {
  if (!columns.has(table)) columns.set(table, new Set());
  columns.get(table).add(col);
};

const sql = readdirSync(sqlDir).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(sqlDir, f), "utf8")).join("\n")
  .replace(/--[^\n]*/g, "");

for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\)\s*;/gi)) {
  const table = m[1].toLowerCase();
  for (const line of m[2].split("\n")) {
    const name = /^\s*([a-z_][a-z0-9_]*)\s+/i.exec(line)?.[1]?.toLowerCase();
    // Table-level constraints start with these words, not with a column name.
    if (!name || ["primary", "unique", "foreign", "check", "constraint",
                  "exclude", "like"].includes(name)) continue;
    add(table, name);
  }
}
for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
  add(m[1].toLowerCase(), m[2].toLowerCase());
}
/* A view is a table as far as a query is concerned, and its columns are
   whatever it selects -- too loose to parse, so a view is simply not checked
   rather than being reported as a table with no columns. */
const views = new Set([...sql.matchAll(
  /create\s+(?:or\s+replace\s+)?view\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()));

/* ------------------------------------------------- what the code asks for */

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "__fixtures__"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
};

const wrong = [];
const checked = [];
for (const file of [...walk(join(app, "app")), ...walk(join(app, "lib")),
                    ...walk(join(app, "components"))]) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/\/rest\/v1\/([a-z_][a-z0-9_]*)`?\s*\n?\s*\+?\s*`?\?([^`"']*)/gi)) {
    const table = m[1].toLowerCase();
    if (table === "rpc" || views.has(table)) continue;
    const known = columns.get(table);
    // A table this scan never saw defined is not evidence of a wrong column.
    if (!known || !known.size) continue;
    for (const part of m[2].split("&")) {
      const name = /^([a-z_][a-z0-9_]*)=/.exec(part.trim())?.[1];
      if (!name) continue;
      if (["select", "order", "limit", "offset", "or", "and", "not"].includes(name)) continue;
      checked.push(`${table}.${name}`);
      if (!known.has(name)) {
        wrong.push(`${file.slice(app.length + 1)} asks ${table} for a column`
          + ` called "${name}", which it does not have`);
      }
    }
  }
}

if (!checked.length) {
  console.error(" ✗ this check found no hand-written PostgREST filters at all,"
    + " which means the scan is broken rather than the code being clean");
  process.exit(1);
}
if (wrong.length) {
  for (const w of wrong) console.error(" ✗ " + w);
  process.exit(1);
}
console.log(`every column in ${checked.length} hand-written filters exists`
  + ` (${columns.size} tables read from the migrations)`);
