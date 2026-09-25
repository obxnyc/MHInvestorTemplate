/** Twilio webhook signature checking — the thing that decides whether an
 *  inbound text becomes a message or a 403. Run: node lib/__fixtures__/signature.test.mjs
 *
 *  Signatures are generated here the way Twilio generates them (HMAC-SHA1 over
 *  the called URL with the POST parameters appended in sorted order), so these
 *  are real signatures being checked, not a stubbed-out validator. */
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createHmac } from "crypto";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(readFileSync(join(here, "..", "twilio.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Written to a real file rather than a data: URL because this module imports
// the twilio package by name, and a data: URL has no node_modules to resolve
// bare specifiers against.
const tmp = join(here, ".signature.gen.mjs");
writeFileSync(tmp, js);
let checkTwilioSignature, publicBase;
try {
  ({ checkTwilioSignature, publicBase } = await import(tmp));
} finally {
  unlinkSync(tmp);
}

/* Shaped like a real one: 32 hex characters. */
const TOKEN = "3f9c1ad27be04e6588b0c7d41ea9527f";
process.env.TWILIO_AUTH_TOKEN = TOKEN;

const checks = [];
const t = (n, ok) => checks.push([n, ok]);

/** Exactly what Twilio does to produce X-Twilio-Signature. */
function sign(url, params, token = TOKEN) {
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  return createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}

const BODY = { MessageSid: "SM1", From: "+12526420000", Body: "My kitchen sink is leaking" };
const PATH = "/api/twilio/sms";

/** A request as Vercel presents it: the proxy headers carry the real host. */
function req(headers, arrivedAt = PATH) {
  return new Request("https://internal.invalid" + arrivedAt, {
    method: "POST",
    headers: new Headers(headers),
  });
}

const VERCEL = {
  host: "mh-investor-template.vercel.app",
  "x-forwarded-host": "mh-investor-template.vercel.app",
  "x-forwarded-proto": "https",
};
const LIVE = "https://mh-investor-template.vercel.app" + PATH;

// 1. The ordinary case.
{
  process.env.PUBLIC_BASE_URL = "https://mh-investor-template.vercel.app";
  const r = checkTwilioSignature(
    req({ ...VERCEL, "x-twilio-signature": sign(LIVE, BODY) }), PATH, BODY);
  t("a correctly signed request is accepted", r.ok === true);
}

// 2. The bug this replaced. Twilio calls the deployment host; the configured
//    origin says something else, or says nothing. Either way the message must
//    still land -- the signature is what proves it came from Twilio, and it
//    does prove that against the host the request actually arrived on.
for (const [name, base] of [
  ["unset", undefined],
  ["a trailing slash", "https://mh-investor-template.vercel.app/"],
  ["http instead of https", "http://mh-investor-template.vercel.app"],
  ["a different custom domain", "https://inbox.larabeehomesllc.com"],
  ["stray whitespace", "  https://mh-investor-template.vercel.app  "],
]) {
  if (base === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = base;
  const r = checkTwilioSignature(
    req({ ...VERCEL, "x-twilio-signature": sign(LIVE, BODY) }), PATH, BODY);
  t(`PUBLIC_BASE_URL ${name} no longer costs the message`, r.ok === true);
}

// 3. And the reverse: a proxy that rewrites Host, where only the configured
//    origin is right.
{
  process.env.PUBLIC_BASE_URL = "https://inbox.larabeehomesllc.com";
  const url = "https://inbox.larabeehomesllc.com" + PATH;
  const r = checkTwilioSignature(
    req({ host: "some-internal-name", "x-twilio-signature": sign(url, BODY) }), PATH, BODY);
  t("PUBLIC_BASE_URL still works when the host header is wrong", r.ok === true);
}

process.env.PUBLIC_BASE_URL = "https://mh-investor-template.vercel.app";

// 3b. The two shapes a console entry takes that the route never sees.
{
  process.env.PUBLIC_BASE_URL = "https://mh-investor-template.vercel.app";

  // Configured with a trailing slash. Next redirects it away, but the
  // signature was fixed before the redirect.
  const slashed = checkTwilioSignature(
    req({ ...VERCEL, "x-twilio-signature": sign(LIVE + "/", BODY) }), PATH, BODY);
  t("a webhook URL configured with a trailing slash still verifies", slashed.ok === true);

  // Configured with a query string, which arrives on the request.
  const q = "?src=console";
  const withQuery = checkTwilioSignature(
    req({ ...VERCEL, "x-twilio-signature": sign(LIVE + q, BODY) }, PATH + q), PATH, BODY);
  t("a webhook URL configured with a query string still verifies", withQuery.ok === true);
}

// 4. None of that may loosen what the check is for.
{
  const forged = checkTwilioSignature(
    req({ ...VERCEL, "x-twilio-signature": sign(LIVE, BODY, "not-the-token") }), PATH, BODY);
  t("a signature made with the wrong token is refused", forged.ok === false && forged.status === 403);

  const tampered = checkTwilioSignature(
    req({ ...VERCEL, "x-twilio-signature": sign(LIVE, BODY) }), PATH,
    { ...BODY, Body: "Please send the deposit to this account" });
  t("an edited body is refused", tampered.ok === false);

  const none = checkTwilioSignature(req(VERCEL), PATH, BODY);
  t("no signature header is refused", none.ok === false && none.status === 403);
}

// 5. The Host header is attacker-controlled, so accepting it must not let a
//    request signed for some other endpoint be replayed into this one. It
//    cannot: the path comes from the route file, never from the request.
{
  const elsewhere = "https://mh-investor-template.vercel.app/api/twilio/voice";
  const r = checkTwilioSignature(
    req({ ...VERCEL, "x-twilio-signature": sign(elsewhere, BODY) }), PATH, BODY);
  t("a signature for another endpoint cannot be replayed here", r.ok === false);

  const attacker = "https://attacker.example.com" + PATH;
  const r2 = checkTwilioSignature(
    req({ host: "attacker.example.com", "x-twilio-signature": sign(attacker, BODY) }),
    PATH, BODY);
  t("signing for a host you control proves nothing without the token", r2.ok === true);
  // ^ true only because this test knows the token. The point of the check is
  //   that an attacker does not; the line above is here so that if someone ever
  //   adds a host allowlist, they see this is not what defends the endpoint.
}

// 6. A malformed Host must fail to match, not throw. An exception here is a
//    500 on every inbound text.
{
  delete process.env.PUBLIC_BASE_URL;   // so the host is the only candidate
  for (const bad of ["https://evil.com/x", "host with spaces", ""]) {
    let threw = false, r;
    try {
      r = checkTwilioSignature(
        req({ host: bad, "x-twilio-signature": sign(LIVE, BODY) }), PATH, BODY);
    } catch { threw = true; }
    t(`a malformed host (${bad || "empty"}) fails to match instead of throwing`,
      !threw && r.ok === false);
  }
  process.env.PUBLIC_BASE_URL = "https://mh-investor-template.vercel.app";
}

// 7. When it does refuse, it has to say why. This is the whole difference
//    between a five-minute fix and an afternoon: Twilio records the response
//    body against the error in its console.
{
  const r = checkTwilioSignature(
    req({ ...VERCEL, "x-twilio-signature": "bogus" }), PATH, BODY);
  t("a refusal names the URL it validated against",
    r.ok === false && r.reason.includes("https://mh-investor-template.vercel.app/api/twilio/sms"));

  delete process.env.TWILIO_AUTH_TOKEN;
  const noToken = checkTwilioSignature(
    req({ ...VERCEL, "x-twilio-signature": "bogus" }), PATH, BODY);
  t("a missing auth token says so, as a 500 rather than a 403",
    noToken.ok === false && noToken.status === 500 && noToken.reason.includes("TWILIO_AUTH_TOKEN"));
  process.env.TWILIO_AUTH_TOKEN = TOKEN;

  t("a refusal never echoes the auth token",
    !JSON.stringify(checkTwilioSignature(
      req({ ...VERCEL, "x-twilio-signature": "bogus" }), PATH, BODY)).includes(TOKEN));
}

// 8. Callback URLs handed back inside TwiML.
{
  process.env.PUBLIC_BASE_URL = "https://inbox.larabeehomesllc.com/";
  t("publicBase prefers the canonical origin, without a trailing slash",
    publicBase(req(VERCEL)) === "https://inbox.larabeehomesllc.com");

  delete process.env.PUBLIC_BASE_URL;
  t("publicBase falls back to the request host rather than 'undefined'",
    publicBase(req(VERCEL)) === "https://mh-investor-template.vercel.app");

  t("publicBase returns empty, not garbage, when it has nothing to go on",
    publicBase(req({ host: "no spaces allowed" })) === "");
}

// 9. The box in the hosting dashboard is write-only, so when the wrong string
//    is pasted into it nobody can look and see. The refusal says what shape it
//    found, and never what it was.
{
  const bogus = req({ ...VERCEL, "x-twilio-signature": "bogus" });

  process.env.TWILIO_AUTH_TOKEN = "AC" + "0".repeat(32);
  let r = checkTwilioSignature(bogus, PATH, BODY);
  t("pasting the Account SID into the token box is named as such",
    r.reason.includes("Account SID"));

  process.env.TWILIO_AUTH_TOKEN = "SK" + "0".repeat(32);
  r = checkTwilioSignature(bogus, PATH, BODY);
  t("pasting an API key SID is named as such", r.reason.includes("API key SID"));

  process.env.TWILIO_AUTH_TOKEN = "hunter2";
  r = checkTwilioSignature(bogus, PATH, BODY);
  t("anything else is reported by length only",
    r.reason.includes("7 characters") && !r.reason.includes("hunter2"));

  // A correctly shaped token is not commented on -- the note is a lead, and a
  // lead that fires on the healthy case is noise.
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  r = checkTwilioSignature(bogus, PATH, BODY);
  t("a correctly shaped token draws no comment",
    !r.reason.includes("not shaped like") && !r.reason.includes("whitespace"));

  // The one that actually costs people an afternoon: a trailing newline picked
  // up on paste. It now both works and says it happened.
  process.env.TWILIO_AUTH_TOKEN = `  ${TOKEN}\n`;
  const good = checkTwilioSignature(
    req({ ...VERCEL, "x-twilio-signature": sign(LIVE, BODY) }), PATH, BODY);
  t("a token pasted with whitespace around it still verifies", good.ok === true);

  r = checkTwilioSignature(bogus, PATH, BODY);
  t("...and the whitespace is mentioned when something else fails",
    r.reason.includes("whitespace"));

  t("none of these ever print the token",
    !JSON.stringify(r).includes(TOKEN));
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
}

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
