/** The roles the app knows about.  Run: node lib/__fixtures__/roles.test.mjs
 *
 *  Two lists that must agree -- the TypeScript one and the Postgres enum --
 *  and no one place that says so. They are checked against each other here
 *  rather than either being trusted, the same way the fence radii are checked
 *  against the property kinds.
 *
 *  What this would have caught: migration 038 added `crew` to the enum and
 *  nothing in the app could set it, because the list was hardcoded in six
 *  files. The role existed and no screen would offer it.
 */
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "..");
const sqlDir = join(app, "..", "..", "docs", "shared-line");

const src = readFileSync(join(here, "..", "roles.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { ROLES, ROLE_LABEL, ROLE_BLURB, FIELD, DESK, CLOCK_ONLY,
        isRole, isField, isClockOnly, isDesk, labelOf } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

/* ------------------------------------------------- the enum, read out of SQL
 * The base enum plus every `add value` any migration has made, which is the
 * only honest way to know what the database will accept.
 */
const sql = readdirSync(sqlDir).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(sqlDir, f), "utf8")).join("\n");

const base = /create type staff_role\s+as enum \(([^)]+)\)/.exec(sql);
const added = [...sql.matchAll(/alter type staff_role add value(?: if not exists)? '([a-z_]+)'/g)]
  .map((m) => m[1]);
const inDb = [...new Set([
  ...[...(base?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
  ...added,
])];

t("the enum was found in the migrations at all", () => inDb.length >= 4);
t("and at least one migration adds to it", () => added.length >= 1);
t("every role the database accepts is one the app knows",
  () => inDb.every((r) => ROLES.includes(r)));
t("and the app knows no role the database would refuse",
  () => ROLES.every((r) => inDb.includes(r)));

/* ------------------------------------------------------------ the labels */
t("every role has a label", () => ROLES.every((r) => ROLE_LABEL[r]));
t("and no label is for a role that does not exist",
  () => Object.keys(ROLE_LABEL).every((r) => ROLES.includes(r)));
t("every role has a sentence on the picker", () => ROLES.every((r) => ROLE_BLURB[r]));
t("and no sentence is for a role that does not exist",
  () => Object.keys(ROLE_BLURB).every((r) => ROLES.includes(r)));
t("no two roles share a label",
  () => new Set(Object.values(ROLE_LABEL)).size === ROLES.length);

/* -------------------------------------------------------- the subsets fit */
t("field staff are real roles", () => FIELD.every((r) => ROLES.includes(r)));
t("the desk are real roles", () => DESK.every((r) => ROLES.includes(r)));
t("nobody is both at a desk and in the field",
  () => !DESK.some((r) => FIELD.includes(r)));
t("isDesk agrees with the list", () => isDesk("office") && !isDesk("crew"));
// A role the migrations add ahead of the code shows its own word rather than
// a blank, which is the only honest thing a screen can do with it.
t("a role the app has never heard of still has something to show",
  () => labelOf("foreman") === "foreman");
t("clock-only staff are real roles", () => CLOCK_ONLY.every((r) => ROLES.includes(r)));
t("crew are field staff", () => FIELD.includes("crew"));
t("and admins are not", () => !FIELD.includes("admin") && !FIELD.includes("office"));
// Somebody who is only ever here to clock in has to be able to sign in, and
// the keypad is the only way field staff sign in.
t("every clock-only role is also a field role, or they cannot sign in",
  () => CLOCK_ONLY.every((r) => FIELD.includes(r)));

t("isRole knows a role", () => isRole("crew") && isRole("admin"));
t("and refuses one it has never heard of",
  () => !isRole("labourer") && !isRole("") && !isRole(null) && !isRole(undefined));
t("isField and isClockOnly agree with the lists",
  () => isField("crew") && !isField("admin")
     && isClockOnly("crew") && !isClockOnly("tech"));

/* ---------------------------------------------- nobody keeps their own copy
 * The point of this file is that there is one list. A route carrying its own
 * `new Set(["admin", ...])` is the bug coming back, and it comes back quietly.
 */
const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__fixtures__" || e.name === ".next") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && p !== join(app, "lib", "roles.ts")) files.push(p);
  }
};
for (const d of ["app", "lib", "components"]) walk(join(app, d));

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ownLists = files.filter((f) => {
  const code = strip(readFileSync(f, "utf8"));
  // A list naming two or more roles, written out by hand.
  return /\[\s*"(admin|office|tech|shower|crew)"\s*,\s*"(admin|office|tech|shower|crew)"/.test(code);
});
t("no file keeps its own list of roles",
  () => ownLists.length === 0 || (console.log("   " + ownLists.map((f) =>
    f.slice(app.length + 1)).join("\n   ")), false));

t("a throwing check is named, not fatal", () => { throw new Error("on purpose"); });
if (checks.pop()[0] !== "a throwing check is named, not fatal") {
  console.log("FAIL  the harness does not catch a throwing check");
  process.exit(1);
}

let failed = 0;
for (const [n, ok, note] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${n}${note ? ` (${note})` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
