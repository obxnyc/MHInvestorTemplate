/**
 * Whether this deployment can send an email, and whether anything asks.
 *
 *     node lib/__fixtures__/postmark-check.mjs
 *
 * WHAT THIS IS FOR. The setup page returned FIFTEEN CHECKS, every one green,
 * on a deployment where `POSTMARK_SERVER_TOKEN` was not set -- so the morning
 * delinquency report, every vendor invoice and every decline explanation were
 * being built correctly and sent nowhere.
 *
 * The report had already said so, twice, in `report_runs.detail`:
 * "POSTMARK_SERVER_TOKEN is not set, so nothing can be emailed." Eleven days,
 * written down at the moment it happened, in a column nobody reads -- because
 * the page people DO read said everything was fine.
 *
 * The bookkeeper check knew. Its own `fix` text said "POSTMARK_SERVER_TOKEN
 * has to be set as well, since it is what actually sends", and then it did
 * not test it. **A green line is worse than a missing one**, which this
 * repository has now learned four times: `source` counting zego on a database
 * with no email, `described` keyed on rows, the crew card saying "nobody is
 * on the clock" after a failed read, and this.
 *
 * THE FOUR STATES, and three of them look identical from outside:
 *
 *   no token      nothing is sent, silently
 *   wrong token   Postmark refuses; nothing is sent, silently
 *   sandbox       Postmark ACCEPTS every send and delivers none of it
 *   live          mail goes
 *
 * Sandbox is the cruel one: the send succeeds, the code is happy, the row is
 * stamped, and nobody receives anything.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");

const out = join(here, "postmark-health.gen.mjs");
writeFileSync(out, ts.transpileModule(
  readFileSync(join(lib, "postmark-health.ts"), "utf8"),
  { compilerOptions: { target: 99, module: 99 } }).outputText);
const { postmarkChecks } = await import(out);

const checks = [];
const t = (name, fn, why) => checks.push([name, fn, why]);

const TOKEN = "11111111-2222-3333-4444-555555555555";

/** Stand in for Postmark, recording what it was asked. */
function postmark(reply) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push([String(url), init?.headers ?? {}]);
    if (reply instanceof Error) throw reply;
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body ?? {},
    };
  };
  return seen;
}

const one = async (token, reply) => {
  if (token === null) delete process.env.POSTMARK_SERVER_TOKEN;
  else process.env.POSTMARK_SERVER_TOKEN = token;
  const seen = postmark(reply);
  return { out: (await postmarkChecks())[0], seen };
};

const LIVE = { status: 200, body: { Name: "larabee-inbox", DeliveryType: "Live" } };

/* ------------------------------------------------------- the four states */

t("no token is a failure, not a warning", async () => {
  const { out } = await one(null, LIVE);
  return out.level === "bad";
}, "a warning on a diagnostic page is something people scroll past; nothing "
 + "this application sends by email is being sent");

t("and it does not call Postmark to find that out", async () => {
  const { seen } = await one(null, LIVE);
  return seen.length === 0;
}, "asking a service about a credential you do not have is a round trip to "
 + "be told what you already knew");

t("a token Postmark refuses is a failure", async () => {
  const { out } = await one(TOKEN, { status: 401 });
  return out.level === "bad" && /401|wrong|refus/i.test(out.detail + (out.fix ?? ""));
}, "PRESENCE IS THE ONE THING A WRONG VALUE ALSO HAS. Postmark's account "
 + "token and server token look alike and are not interchangeable, so the "
 + "check has to be the service answering, not the variable existing");

t("SANDBOX is a failure, even though every send succeeds", async () => {
  const { out } = await one(TOKEN,
    { status: 200, body: { Name: "larabee-inbox", DeliveryType: "Sandbox" } });
  return out.level === "bad" && /sandbox/i.test(out.detail);
}, "THE CRUEL ONE. Postmark accepts the send, the code is happy, the row is "
 + "stamped emailed, and nobody receives anything. Indistinguishable from "
 + "working unless something asks");

t("a live server is the only good answer", async () => {
  const { out } = await one(TOKEN, LIVE);
  return out.level === "good" && out.detail.includes("larabee-inbox");
}, "naming the server, because an account with several has a token per "
 + "server and the wrong one is a thing that happens");

/* ------------------------------------------------- it asks the right way */

t("the token goes in Postmark's own header", async () => {
  const { seen } = await one(TOKEN, LIVE);
  const [[url, headers]] = seen;
  return /api\.postmarkapp\.com/.test(url)
      && headers["X-Postmark-Server-Token"] === TOKEN;
}, "Postmark does not read Authorization: Bearer, and a token sent the "
 + "wrong way is a 401 that reads as a bad token");

t("the token is never put in the message", async () => {
  const { out } = await one(TOKEN, { status: 401 });
  return !JSON.stringify(out).includes(TOKEN);
}, "this goes in an HTTP response a machine reads and a page a person "
 + "reads; the shape is reported, never the value");

t("a check that could not reach Postmark is not a report that sending is broken",
  async () => {
    const { out } = await one(TOKEN, new Error("getaddrinfo ENOTFOUND"));
    return out.level === "warn" && /could not|unable/i.test(out.name + out.detail);
  },
  "crying wolf is worse than no check: a network blip on the diagnostic "
  + "path must not read as a broken mail server");

/* ----------------------------------------------- and something runs it */

const setup = readFileSync(join(lib, "setup-check.ts"), "utf8");
const running = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

t("the setup page runs it", () =>
  /guardAsync\(\s*"Postmark"\s*,\s*postmarkChecks\s*\)/.test(running(setup)),
  "A CHECK NOTHING RUNS IS A CHECK THAT DOES NOT EXIST, which is exactly "
  + "how fifteen green lines sat on top of this for eleven days");

t("and it runs the one that asks whether the report actually went", () =>
  /guardAsync\(\s*"The morning report"\s*,\s*reportChecks\s*\)/.test(running(setup)),
  "the settings half asks whether sending COULD work; report_runs is the "
  + "only thing that knows whether it DID, and it is what found this");

/* ------------------------------------------- a send that failed, on a row */

const invoice = readFileSync(
  join(lib, "..", "app/api/jobs/link/[token]/invoice/route.ts"), "utf8");

t("the invoice is stamped emailed only when the send said so", () => {
  const src = running(invoice);
  const at = src.indexOf("emailed_at");
  if (at < 0) return false;
  /* Cut back to the enclosing condition rather than searching the file: an
     `if (sent.ok)` somewhere else would answer for this one. */
  const before = src.slice(Math.max(0, at - 220), at);
  return /if\s*\(\s*sent\.ok\s*\)/.test(before);
}, "`sendEmail` swallows every error, so the stamp went on whether or not "
 + "anything was sent -- and for eleven days nothing was. The row then "
 + "claims the bookkeeper was told, which is the single claim on it that "
 + "has to be true");

t("and the vendor is told what actually happened", () => {
  const src = running(invoice);
  return /emailed\s*,?\s*\}/.test(src) && !/emailed:\s*to\.length/.test(src);
}, "`emailed: to.length` reports the size of the LIST, which is a fact "
 + "about configuration and not about whether an email went");

t("the checked sender is the one used", () => {
  const src = running(invoice);
  return /sendEmailChecked\(/.test(src) && !/\bsendEmail\(/.test(src);
}, "the quiet one is for request paths that must not fail on a mail hiccup; "
 + "this path records a claim, so it needs the answer");

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
