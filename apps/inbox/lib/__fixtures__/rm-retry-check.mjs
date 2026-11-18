/**
 * A Rent Manager token that expired mid-run must not lose the whole run.
 *
 *     node lib/__fixtures__/rm-retry-check.mjs
 *
 * WHAT HAPPENED. The morning report of 17 November went out saying "Rent
 * Manager answered, but none of the ways of asking returned a balance", with
 * three 401s listed under it. The same credential, against the same
 * endpoint, built the full report -- 41 tenants owing $89,131.15 -- a few
 * minutes later when it was asked again by hand.
 *
 * Nothing was wrong with the password. The session is cached for 45 minutes,
 * which is short of the token's real lifetime ON PURPOSE and is still only a
 * guess: Rent Manager can retire a token early, and signing in from
 * elsewhere can invalidate this one. When that happened every call for the
 * rest of the run came back 401 and nothing re-authenticated.
 *
 * **An expired token is the one failure here that fixes itself, and it was
 * the one failure nothing tried to fix.**
 *
 * THE RULE IT MUST NOT BREAK. A wrong password returns 401 too. Retrying
 * that in a loop is how an API account gets locked out, which turns an
 * hour's outage into a phone call to Rent Manager support. So: once, only on
 * a 401, and only when signing in again actually produced a DIFFERENT token.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");

const gen = join(here, "rentmanager.gen.mjs");
writeFileSync(gen, ts.transpileModule(
  readFileSync(join(lib, "rentmanager.ts"), "utf8")
    .replace(/^import\b[\s\S]*?from\s*"[^"]*";/gm, ""),
  { compilerOptions: { target: 99, module: 99 } }).outputText);

process.env.RENTMANAGER_USERNAME = "api-user";
process.env.RENTMANAGER_PASSWORD = "a-password";
process.env.RENTMANAGER_BASE_URL = "https://larabee.api.rentmanager.com";
process.env.RENTMANAGER_COMPANY = "larabee";

const checks = [];
const t = (name, fn, why) => checks.push([name, fn, why]);

/**
 * A stand-in Rent Manager.
 *
 * `tokens` are handed out in order by the sign-in endpoint. `accepts` is the
 * set of tokens the data endpoints will honour; anything else gets a 401.
 * Every call is recorded, which is the whole point -- the questions here are
 * about HOW MANY times it signed in, not only about what came back.
 */
function server({ tokens, accepts, dataStatus = 200, signInStatus = 200 }) {
  const log = { auth: 0, data: [] };
  let next = 0;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/Authentication/AuthorizeUser")) {
      log.auth += 1;
      const tok = tokens[Math.min(next, tokens.length - 1)];
      next += 1;
      return reply(signInStatus, JSON.stringify(tok));
    }
    const given = Object.entries(init?.headers ?? {})
      .find(([k]) => /ApiToken/i.test(k))?.[1];

    /* `/Properties?pagesize=1` is not a data read: it is how sign-in works
       out which of three header spellings this server wants. Conflating the
       two made every scenario fail at sign-in rather than at the call under
       test -- the stand-in answering a different question than the one it
       was named for. */
    if (u.includes("/Properties?pagesize=1")) return reply(200, "[]");

    log.data.push({ path: u, token: given });
    if (!accepts.includes(given)) return reply(401, "Unauthorized");
    return reply(dataStatus, dataStatus === 200 ? JSON.stringify([{ TenantID: 1 }]) : "nope");
  };
  return log;
}

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status, statusText: String(status),
  text: async () => body,
});

/** A fresh copy of the module, so the cached session from one scenario
 *  cannot answer for the next. */
let n = 0;
const fresh = async () => await import(`${gen}?v=${n += 1}`);

/* ------------------------------------------------------ nothing to retry */

t("a 200 is returned without signing in again", async () => {
  const log = server({ tokens: ["token-one-1111"], accepts: ["token-one-1111"] });
  const rm = await fresh();
  const auth = await rm.rmAuthorize();
  const before = log.auth;
  const got = await rm.rmGet("/Tenants", auth.session);
  return got.ok && got.status === 200 && log.auth === before;
});

t("a 404 is an answer, not an expiry", async () => {
  const log = server({ tokens: ["token-one-1111"], accepts: ["token-one-1111"], dataStatus: 404 });
  const rm = await fresh();
  const auth = await rm.rmAuthorize();
  const before = log.auth;
  const got = await rm.rmGet("/Nonsense", auth.session);
  return got.status === 404 && log.auth === before;
}, "the probe makes a dozen of these on purpose; re-authenticating on each "
 + "one would turn a diagnosis into a sign-in storm");

/* ------------------------------------------------------- the real case */

t("a token retired early is replaced and the call succeeds", async () => {
  /* Signed in as t1, and the server has already moved on to t2 -- which is
     exactly what an early retirement looks like from this side. */
  const log = server({ tokens: ["token-one-1111", "token-two-2222"], accepts: ["token-two-2222"] });
  const rm = await fresh();
  const auth = await rm.rmAuthorize();
  auth.session.token = "token-one-1111";                 // the stale one in hand
  const got = await rm.rmGet("/Tenants", auth.session);
  return got.ok && got.status === 200 && log.auth === 2;
}, "THE 17 NOVEMBER REPORT. Three 401s, no retry, and a credential that was "
 + "working perfectly a few minutes later");

t("and it says the token had expired, rather than succeeding silently",
  async () => {
    server({ tokens: ["token-one-1111", "token-two-2222"], accepts: ["token-two-2222"] });
    const rm = await fresh();
    const auth = await rm.rmAuthorize();
    auth.session.token = "token-one-1111";
    const got = await rm.rmGet("/Tenants", auth.session);
    return /expired|signed in again/i.test(got.detail ?? "");
  },
  "a run that quietly recovers teaches nobody that the 45-minute guess is "
  + "wrong");

t("the new token is written into the caller's session", async () => {
  const log = server({ tokens: ["token-one-1111", "token-two-2222"], accepts: ["token-two-2222"] });
  const rm = await fresh();
  const auth = await rm.rmAuthorize();
  auth.session.token = "token-one-1111";
  await rm.rmGet("/Tenants", auth.session);
  const after = log.auth;
  await rm.rmGet("/Units", auth.session);     // the next call in the run
  return auth.session.token === "token-two-2222" && log.auth === after;
}, "THE ONE THAT IS NOT A NO-OP. Without writing it back the call still "
 + "succeeds -- it just signs in again for every one of three hundred "
 + "tenants, which is a sign-in storm that reads as working");

/* ----------------------------------------------- and it does not loop */

t("a refused credential is not retried into a lockout", async () => {
  /* Signing in works and keeps handing back the same token, which the data
     endpoints keep refusing. That is a refusal, not an expiry. */
  const log = server({ tokens: ["token-same-0000"], accepts: ["token-none-9999"] });
  const rm = await fresh();
  const auth = await rm.rmAuthorize();
  const got = await rm.rmGet("/Tenants", auth.session);
  /* EXACTLY ONE data call. `<= 2` passed with the same-token guard deleted,
     because one wasted retry is still two -- a bound loose enough to admit
     the fault it was written to catch. */
  return got.status === 401 && log.data.length === 1 && log.auth === 2;
}, "a wrong password answers 401 exactly like an expired token. Retrying it "
 + "in a loop is how an API account gets locked, which turns an hour's "
 + "outage into a phone call to Rent Manager support");

t("and says which of the two it was", async () => {
  server({ tokens: ["token-same-0000"], accepts: ["token-none-9999"] });
  const rm = await fresh();
  const auth = await rm.rmAuthorize();
  const got = await rm.rmGet("/Tenants", auth.session);
  return /refusal and not an expiry/i.test(got.detail ?? "");
}, "'401' on its own sends somebody to check a password that is correct");

t("a sign-in that fails leaves the original 401 standing", async () => {
  const log = server({ tokens: ["token-one-1111"], accepts: ["token-one-1111"] });
  const rm = await fresh();
  const auth = await rm.rmAuthorize();
  auth.session.token = "token-stale-xxxx";
  server({ tokens: ["token-one-1111"], accepts: ["token-one-1111"], signInStatus: 500 });
  const got = await rm.rmGet("/Tenants", auth.session);
  return got.status === 401 && /credential itself is being refused/i.test(got.detail ?? "");
});

t("the retry can be turned off", async () => {
  const log = server({ tokens: ["token-one-1111", "token-two-2222"], accepts: ["token-two-2222"] });
  const rm = await fresh();
  const auth = await rm.rmAuthorize();
  auth.session.token = "token-one-1111";
  const before = log.auth;
  const got = await rm.rmGet("/Tenants", auth.session, false);
  return got.status === 401 && log.auth === before;
}, "the probe exists to report what the server said; a diagnostic that "
 + "silently fixes what it is diagnosing is not one");

/* ---------------------------------------------------------------- report */

let failed = 0;
for (const [name, fn, why] of checks) {
  let ok = false, blew = null;
  try { ok = (await fn()) === true; } catch (e) { blew = e.message; }
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${blew ? `threw: ${blew}` : why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : `\nnothing obviously wrong (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
