/** A crew member's phone never rings for a tenant call.
 *  Run: node lib/__fixtures__/crew-ring-check.mjs
 *
 *  "A crew member SHOULD NEVER GET AN OFFICE CALL." The owner, on reading his
 *  own setup page say "Calls to the shared line will ring" his number.
 *
 *  Two halves. `rings` in lib/voice.ts is the rule -- every call that becomes
 *  a phone ringing goes through it -- and is asked directly, including the
 *  case that matters: a crew row that DOES have a number in forward_to,
 *  because one already exists in the live data and the rule has to hold
 *  whatever got written.
 *
 *  The second half is the tidiness: every staff insert in the app that sets
 *  forward_to must decide it through isClockOnly. Each insert is cut out
 *  first and matched inside, because an anchor that runs on past its own
 *  block passes the one at fault.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "..");

const checks = [];
const t = (name, ok, why = "") => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok, why]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

/* ------------------------------------------------------------ the rule */
const tr = (f) => ts.transpileModule(readFileSync(join(app, "lib", f), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const rolesUrl = "data:text/javascript," + encodeURIComponent(tr("roles.ts"));
// Only `rings` is wanted, so voice.ts is cut down to it: the rest imports the
// database client, which has no business in a check of one rule.
const voice = readFileSync(join(app, "lib", "voice.ts"), "utf8");
const start = voice.indexOf("export function rings");
const body = voice.slice(start, voice.indexOf("\n}\n", start) + 2);
const js = ts.transpileModule(`import { isClockOnly } from "${rolesUrl}";\n${body}`, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { rings } = await import("data:text/javascript," + encodeURIComponent(js));

const NUM = "+12525550100";
t("crew with a number stored does NOT ring", () => rings({ role: "crew", active: true, forward_to: NUM }) === false);
t("office with a number rings", () => rings({ role: "office", active: true, forward_to: NUM }) === true);
t("admin with a number rings", () => rings({ role: "admin", active: true, forward_to: NUM }) === true);
t("nobody without a number rings", () => rings({ role: "office", active: true, forward_to: null }) === false);
t("nobody inactive rings", () => rings({ role: "office", active: false, forward_to: NUM }) === false);
t("a row with no role at all does not ring as if it were crew-safe",
  () => rings({ active: true, forward_to: NUM }) === true);

/* --------------------------------- every way in leaves crew off the list */
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    if (n === "node_modules" || n === ".next" || n === "__fixtures__") continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(n)) files.push(p);
  }
};
walk(join(app, "app"));
walk(join(app, "lib"));

const unguarded = [];
let inserts = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8").replace(/\/\/[^\n]*/g, "");
  for (const m of src.matchAll(/\.from\("staff"\)\s*\.(insert|upsert|update)\(\{/g)) {
    // Cut the object literal out by brace depth, then look inside it.
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth) { if (src[i] === "{") depth++; else if (src[i] === "}") depth--; i++; }
    const obj = src.slice(m.index, i);
    if (!/forward_to\s*:/.test(obj)) continue;
    inserts++;
    const line = obj.match(/forward_to\s*:[^\n]*/)[0];
    if (!/isClockOnly\(|\bcrew\s*\?/.test(line)) unguarded.push(`${f.slice(app.length + 1)}: ${line.trim()}`);
  }
}
t("the staff inserts that set forward_to were found", inserts >= 4, `found ${inserts}`);
t("every one of them leaves crew out", unguarded.length === 0, unguarded.join("\n      "));

const v = voice.replace(/\/\/[^\n]*/g, "");
t("ringGroup filters through rings", /ringGroup[\s\S]*?\.filter\(rings\)/.test(v.slice(v.indexOf("export async function ringGroup"),
  v.indexOf("export async function ringGroup") + 600)));
const stages = v.slice(v.indexOf("export async function ringStages"), v.indexOf("export async function groupIntro"));
t("ringStages filters through rings", /rings\(p\)/.test(stages));
t("ringStages reads the role it needs to decide", /staff:staff_id\([^)]*role/.test(stages));

/* ------------------------------------------- the setup page tells the truth */
const page = readFileSync(join(app, "app", "welcome", "[token]", "page.tsx"), "utf8");
t("the crew setup page says tenant calls never ring", /Tenant calls never ring your phone/.test(page));
t("and the 'will ring' sentence is only for non-crew", () => {
  const ringing = [...page.matchAll(/will ring/g)].length;
  const gated = [...page.matchAll(/known\.crew[\s\S]{0,200}?will ring|!known\.crew[\s\S]{0,200}?will ring/g)].length;
  return ringing > 0 && gated === ringing;
});

for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && why ? `\n      ${why}` : ""}`);
const failed = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
