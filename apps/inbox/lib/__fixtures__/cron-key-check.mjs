/**
 * The one rule that decides whether a machine may speak to this app.
 *
 *     node lib/__fixtures__/cron-key-check.mjs
 *
 * WHY IT IS ONE FILE NOW. The same twelve lines sat in two cron routes and
 * the setup check wanted them too. An authorization rule copied three times
 * is three places for it to drift, and the copy that drifts quietly is the
 * one that stops refusing -- which is not a failure anybody sees.
 *
 * WHY IT IS CHECKED RUNNABLY AND NOT BY READING. Two of the four things
 * below cannot be seen by reading the function at all:
 *
 *   `timingSafeEqual` THROWS when the two buffers are different lengths.
 *   So the length test in front of it is not an optimisation -- without it,
 *   a key of the wrong length is a 500 where a 401 belongs, and a 500 on an
 *   authorization path reads as the app being broken rather than as the
 *   caller being refused.
 *
 *   An empty token must never reach the database. Returning false either way
 *   makes that look like a no-op -- and it is not, because `report_key_ok('')`
 *   against a Vault secret that is somehow empty is a door standing open.
 *   So the check is that the database IS NOT ASKED, not that the answer is
 *   false. A fault that is a no-op proves nothing.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");
const app = join(lib, "..", "app");

/* The imports are replaced rather than merely stripped, because this file --
   unlike the pure ones -- genuinely uses both of them. The stand-in for
   `timingSafeEqual` throws on a length mismatch exactly as node's does; that
   is the whole point of having one. */
const stubs = `
let ASKED = [];
let ANSWER = { data: false, error: null };
export const __asked = () => ASKED;
export const __reset = (a) => { ASKED = []; ANSWER = a ?? { data: false, error: null }; };
const timingSafeEqual = (a, b) => {
  if (a.length !== b.length) throw new Error("Input buffers must have the same byte length");
  return Buffer.compare(a, b) === 0;
};
const supabaseAdmin = () => ({
  rpc: async (name, args) => { ASKED.push([name, args]); return ANSWER; },
});
`;

const raw = readFileSync(join(lib, "cron-key.ts"), "utf8");
writeFileSync(join(here, "cron-key.gen.mjs"), ts.transpileModule(
  stubs + raw.replace(/^import\b[\s\S]*?from\s*"[^"]*";/gm, ""),
  { compilerOptions: { target: 99, module: 99 } }).outputText);

const { cronKeyOk, __asked, __reset } =
  await import(join(here, "cron-key.gen.mjs"));

const checks = [];
const t = (name, fn, why) => checks.push([name, fn, why]);

/** A request carrying whatever Authorization header is given. */
const req = (auth) =>
  new Request("https://example.test/api/setup",
    { headers: auth === null ? {} : { authorization: auth } });

const SECRET = "a-cron-secret-of-some-length";

/* ------------------------------------------------- the key in the env */

t("the environment's secret is accepted", async () => {
  process.env.CRON_SECRET = SECRET;
  __reset();
  return await cronKeyOk(req(`Bearer ${SECRET}`), "report_key_ok") === true;
});

t("and accepting it does not cost a round trip to the database", async () => {
  process.env.CRON_SECRET = SECRET;
  __reset();
  await cronKeyOk(req(`Bearer ${SECRET}`), "report_key_ok");
  return __asked().length === 0;
}, "the schedule fires every five minutes; a database call per wake to "
 + "confirm a string this process already holds is work for nothing");

t("a key of a DIFFERENT LENGTH is refused, not thrown", async () => {
  process.env.CRON_SECRET = SECRET;
  __reset();
  return await cronKeyOk(req("Bearer short"), "report_key_ok") === false;
}, "THE ONE READING CANNOT FIND. timingSafeEqual throws on a length "
 + "mismatch, so without the length test in front of it this is a 500 "
 + "where a 401 belongs -- and a 500 on an authorization path reads as "
 + "the app being broken rather than as the caller being refused");

t("a key of the SAME length that is wrong falls through to the database",
  async () => {
    process.env.CRON_SECRET = SECRET;
    __reset();
    await cronKeyOk(req(`Bearer ${"x".repeat(SECRET.length)}`), "report_key_ok");
    return __asked().length === 1;
  },
  "the environment's secret is one of three ways in, not a gate in front "
  + "of the other two: the schedule's own key never equals it");

/* ------------------------------------------------------- nothing offered */

t("no Authorization header is refused", async () => {
  process.env.CRON_SECRET = SECRET;
  __reset({ data: true, error: null });
  return await cronKeyOk(req(null), "report_key_ok") === false;
}, "the database is told to say yes here, so this fails if the empty case "
 + "is allowed to reach it");

t("and an empty token is never offered to the database", async () => {
  delete process.env.CRON_SECRET;
  __reset();
  await cronKeyOk(req(""), "report_key_ok");
  return __asked().length === 0;
}, "THE CASE THAT IS NOT A NO-OP. Both ways round return false today, which "
 + "makes the early return look like it does nothing. It is not nothing: "
 + "report_key_ok('') against a Vault secret that is empty for any reason "
 + "is a door standing open, and the empty token must never get that far");

t("a bare token with no Bearer in front is still read", async () => {
  delete process.env.CRON_SECRET;
  __reset({ data: true, error: null });
  return await cronKeyOk(req("some-token"), "report_key_ok") === true;
}, "pg_net sends `Bearer <key>`; a person with curl often does not, and "
 + "refusing them would send somebody hunting a key that is correct");

/* -------------------------------------------- the two keys are two keys */

t("the reports key is asked of report_key_ok, by its own argument name",
  async () => {
    delete process.env.CRON_SECRET;
    __reset();
    await cronKeyOk(req("Bearer k1"), "report_key_ok");
    const [[name, args]] = __asked();
    return name === "report_key_ok" && args.k === "k1";
  },
  "the two functions in 051 take differently-named arguments, and handing "
  + "one the other's is a 401 with nothing on screen to explain it");

t("the clock's key is asked of clock_cron_ok, by ITS own argument name",
  async () => {
    delete process.env.CRON_SECRET;
    __reset();
    await cronKeyOk(req("Bearer k2"), "clock_cron_ok");
    const [[name, args]] = __asked();
    return name === "clock_cron_ok" && args.p_token === "k2";
  });

t("the two are not interchangeable", async () => {
  delete process.env.CRON_SECRET;
  __reset();
  await cronKeyOk(req("Bearer k"), "report_key_ok");
  await cronKeyOk(req("Bearer k"), "clock_cron_ok");
  const names = __asked().map(([n]) => n);
  return names[0] !== names[1];
}, "a fixture where both calls land on one function cannot tell a wired "
 + "rule from a hard-coded one");

/* ------------------------------------------------------------ failing shut */

t("a database that errors is a refusal, not an admission", async () => {
  delete process.env.CRON_SECRET;
  __reset({ data: null, error: { message: "boom" } });
  return await cronKeyOk(req("Bearer k"), "report_key_ok") === false;
});

t("an answer that is merely truthy is not a yes", async () => {
  delete process.env.CRON_SECRET;
  __reset({ data: "t", error: null });
  return await cronKeyOk(req("Bearer k"), "report_key_ok") === false;
}, "PostgREST has handed back a string for a boolean before; `=== true` is "
 + "the only comparison that cannot be talked into a yes");

/* ------------------------------- nobody may write this rule a second time */

const routeFiles = (function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, found);
    else if (name === "route.ts") found.push(p);
  }
  return found;
})(app);

/* NAMED BY ITS KEY, NOT BY ITS MACHINERY.
 *
 * The first version of this banned `timingSafeEqual` outright and failed on
 * five routes, three of which were right: Cal.com checks an HMAC with
 * CALCOM_WEBHOOK_SECRET, and the two intake routes check INTAKE_SECRET,
 * which Postmark puts in the query string. Those are different rules about
 * different keys and they share only a comparison function.
 *
 * A guard that fires on three correct files to catch two wrong ones is the
 * check that cries wolf, and the real finding goes out with the noise. The
 * rule is about ONE SECRET, so it asks about that secret. */
t("no route compares CRON_SECRET itself", () => {
  const guilty = routeFiles.filter((f) => {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    return /process\.env\.CRON_SECRET/.test(src);
  });
  if (guilty.length) console.log(`        ${guilty.join("\n        ")}`);
  return guilty.length === 0;
}, "the comments are stripped first, because a file explaining the rule "
 + "reads the same as a file re-implementing it -- and a whitelist in a "
 + "guard is a hole in the guard");

t("every route that guards itself does it through the one file", () => {
  const using = routeFiles.filter((f) =>
    /cronKeyOk\s*\(/.test(readFileSync(f, "utf8")));
  return using.length >= 5;
}, "four crons and the setup check; fewer than five means one of them grew "
 + "its own rule again");

/* THE FAULT TYPESCRIPT CANNOT SEE, AND IT WAS REAL FOR A MINUTE HERE.
 *
 * `authorized` was a plain boolean in four of these routes and is a promise
 * now. `if (!authorized(req))` still compiles -- a promise is an object, an
 * object is truthy, `!` of it is `false` -- so the guard goes from refusing
 * strangers to admitting everybody, silently, with the types green and the
 * route reading exactly as it did before.
 *
 * Asked of every call rather than of the four that exist today: the next
 * route to be written is the one that gets it wrong. */
t("every authorization is awaited", () => {
  const guilty = [];
  for (const f of routeFiles) {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    for (const m of src.matchAll(/(await\s+)?authorized\s*\(/g)) {
      if (!m[1]) guilty.push(`${f}  (character ${m.index})`);
    }
  }
  if (guilty.length) console.log(`        ${guilty.join("\n        ")}`);
  return guilty.length === 0;
}, "a promise is truthy, so an un-awaited guard refuses nobody and compiles "
 + "perfectly");

/* ------------------------------------------------ what the setup route does */

const setup = readFileSync(join(app, "api/setup/route.ts"), "utf8");

/** The body of the `if (!machine)` block, and nothing after it.
 *
 *  Matching across the whole file would let the 403 of some later block
 *  answer for this one -- the same fault that let a sign-off reaching every
 *  person's shifts pass a check anchored on a `.eq` six hundred characters
 *  downstream. */
function unlessMachine(src) {
  const at = src.indexOf("if (!machine) {");
  if (at < 0) return null;
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}

t("a caller without the key must be a signed-in admin", () => {
  const block = unlessMachine(setup);
  return block !== null
      && /requireStaff\(/.test(block)
      && /role !== "admin"/.test(block)
      && /status:\s*403/.test(block);
}, "cut to the block first: a 403 anywhere else in the file would answer "
 + "for this one and the rule would pass with the check deleted");

t("the key it accepts is the reports key", () => {
  return /cronKeyOk\(\s*req\s*,\s*"report_key_ok"\s*\)/.test(setup);
}, "the clock's token belongs to the crew texts and should not open a "
 + "diagnostic that reports on every integration in the building");

t("a machine is NOT asked the visibility checks", () => {
  const call = /runSetupChecks\(([\s\S]{0,200}?)\)/.exec(setup);
  return call !== null && /machine\s*\?\s*undefined\s*:/.test(call[1]);
}, "THE SHAPE THIS WHOLE FILE IS ABOUT. Those checks ask what THIS PERSON "
 + "can see. Answered as the service role -- which sees everything -- they "
 + "all pass and say nothing, which is a narrower question answered "
 + "confidently. Anchored on the call rather than on the words, because a "
 + "sentence explaining the rule matches a search for the rule");

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
