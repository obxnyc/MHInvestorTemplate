/** A remembered Rent Manager sign-in that has stopped working.
 *  Run: node lib/__fixtures__/stale-token-check.mjs
 *
 *  17 November's report said "answered 401" three times over and went out
 *  with no balances, on a token remembered from an earlier call, while a
 *  fresh sign-in minutes later read every one. The pull must sign in again
 *  on a 401 and ask once more -- and must NOT keep signing in when the
 *  token was fresh, because then a 401 means something else.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = (name) => ts.transpileModule(readFileSync(join(here, "..", `${name}.ts`), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const url = (src) => "data:text/javascript," + encodeURIComponent(src);

/* The stand-ins. rmAuthorize hands out a stale remembered token unless
   forced; the database knows nobody. */
const rmStub = `
  export let calls = [];
  export async function rmAuthorize(force = false) {
    calls.push(force);
    const token = force ? "fresh" : globalThis.__firstToken;
    return { ok: true, cached: !force, attempts: [],
             session: { base: "https://rm.test", token, header: "X-RM12Api-ApiToken" } };
  }`;
const dbStub = `export function supabaseAdmin() { return { from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }) }; }`;

const rm = url(rmStub);
let src = tsx("delinquency-pull")
  .replaceAll('"./rentmanager"', `"${rm}"`)
  .replaceAll('"./supabase-admin"', `"${url(dbStub)}"`)
  .replaceAll('"./delinquency"', `"${url(tsx("delinquency"))}"`);
const { pullDelinquency } = await import(url(src));
const rmMod = await import(rm);

const tenants = [{ TenantID: 7, Name: "Doe, Jane", Status: "Current",
  OpenReceivables: [{ AmountDue: 500, TransactionDate: "2026-11-01T00:00:00" }] }];
let seen = [];
globalThis.fetch = async (u, init) => {
  const tok = init.headers["X-RM12Api-ApiToken"];
  seen.push(tok);
  if (tok !== "fresh") return new Response("Unauthorized", { status: 401 });
  return new Response(JSON.stringify(tenants), { status: 200 });
};

const checks = [];
const t = (name, fn) => { try { checks.push([name, !!fn()]); } catch (e) { checks.push([name, false, e.message]); } };

globalThis.__firstToken = "stale";
rmMod.calls.length = 0; seen = [];
const r = await pullDelinquency("2026-11-17", 10);
t("a stale remembered token: the report still reads the balances", () => r.ok && r.debtors.length === 1);
t("by signing in afresh exactly once", () => rmMod.calls.filter(Boolean).length === 1);
t("and the fresh token is what read them", () => seen.at(-1) === "fresh");

/* The other side: a token that was not remembered and still 401s is not
   stale, and signing in again in a loop would hide the real fault. */
globalThis.__firstToken = "fresh";
globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
rmMod.calls.length = 0;
const fresh = { ...(await import(rm)) };
const r2 = await pullDelinquency("2026-11-17", 10);
t("a 401 on a token just issued is reported, not retried forever",
  () => !r2.ok && /401/.test(r2.error ?? "") && rmMod.calls.filter(Boolean).length <= 1);

let bad = 0;
for (const [name, ok, why] of checks) { console.log(`${ok ? "ok  " : "FAIL"}  ${name}${why ? `  (${why})` : ""}`); if (!ok) bad++; }
console.log(`\n${checks.length - bad}/${checks.length} passed`);
process.exit(bad ? 1 : 0);
