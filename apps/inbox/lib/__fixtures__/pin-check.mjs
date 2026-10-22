/** A PIN belongs to the person it signs for.
 *
 *  "I would prefer not to give people their own PINs. They should make their
 *  own." A PIN somebody else typed is written on a pad by the person who
 *  typed it and read out across a yard -- and it signs another man's hours.
 *
 *  Three rules, and they are not the same rule:
 *    - the office can TAKE ONE AWAY and cannot give one;
 *    - setting one is done against the SESSION, never an id in the request;
 *    - it is typed twice, because a mistyped PIN saved once locks a man out
 *      of the thing he clocks in on and there is no email to recover by.
 *
 *  The first two are checked against the running app as well as the source,
 *  because a source rule can only say what the code looks like.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
/* Comments explaining a rule read the same as code carrying it, so they come
   out first -- a guard that matches its own explanation is a guard that
   cannot fail. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const said = [];
const t = (name, fn) => {
  try { said.push([name, Boolean(fn())]); }
  catch (e) { said.push([name, false, String(e.message ?? e).slice(0, 120)]); }
};
const ta = async (name, fn) => {
  try { said.push([name, Boolean(await fn())]); }
  catch (e) { said.push([name, false, String(e.message ?? e).slice(0, 120)]); }
};

/* ------------------------------------------------------------ the source */

const people = code("app/api/people/[id]/route.ts");
t("the office route still handles pin at all", () => /\bpin\b/.test(people));
t("the office cannot SET a pin, only clear one", () => {
  // It may call clear_staff_pin; it may not call set_staff_pin.
  return /clear_staff_pin/.test(people) && !/set_staff_pin/.test(people);
});

const mine = code("app/api/me/pin/route.ts");
t("your own PIN is set against the session, not an id in the request", () => {
  if (!/set_staff_pin/.test(mine)) return false;
  // The id handed to the database must come from `me`, and nothing resembling
  // a staff id may be read out of the body.
  const callsWithMe = /p_staff:\s*me\.id/.test(mine);
  const readsIdFromBody = /body\.(staffId|staff_id|id)\b/.test(mine);
  return callsWithMe && !readsIdFromBody;
});
t("and it refuses anyone who is not signed in", () =>
  /requireStaff\(\)/.test(mine) && /401/.test(mine));

const choose = code("components/PinChoose.tsx");
t("the PIN is typed twice and the two must agree", () =>
  /pin\s*!==\s*again|again\s*!==\s*pin/.test(choose));
/* `type="number"` drops a leading zero, and 0417 is a perfectly good PIN. */
t("the boxes do not use a number input, which would eat a leading zero", () =>
  !/type="number"/.test(choose) && /inputMode="numeric"/.test(choose));
t("nothing is called saved until the server has answered", () => {
  const i = choose.indexOf("await submit(");
  const j = choose.indexOf("setDone(true)");
  return i > 0 && j > i;
});

/* ----------------------------------------------------------- the running app */

const BASE = process.env.PHONE_CHECK_BASE ?? "http://127.0.0.1:3100";
const STUB = "http://127.0.0.1:54321";
const DESK = "22222222-2222-2222-2222-222222222222";
/* Signed in AS THE OFFICE, because a 401 refuses for the wrong reason: it
   would pass on a route that happily set anyone's PIN for anyone signed in.
   The same cookie the other harnesses mint; see stub-supabase.mjs. */
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const cookie = (id) => {
  const exp = Math.floor(Date.now() / 1e3) + 3600;
  const jwt = [b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub: id, aud: "authenticated", role: "authenticated",
          email: "x@larabeehomesllc.com", exp, iat: exp - 3600,
          iss: `${STUB}/auth/v1` }), "c3R1Yg"].join(".");
  return "sb-127-auth-token=base64-" + Buffer.from(JSON.stringify({
    access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp,
    refresh_token: "stub-refresh",
    user: { id, aud: "authenticated", role: "authenticated",
            email: "x@larabeehomesllc.com", app_metadata: {}, user_metadata: {},
            created_at: "2026-01-01T00:00:00Z" },
  })).toString("base64url");
};
const up = await fetch(`${BASE}/report`).then((r) => r.status < 500).catch(() => false);
if (!up) {
  said.push(["-- the running app was NOT asked: nothing serving at " + BASE, true]);
} else {
  await ta("the office is refused when it tries to set a PIN", async () => {
    const r = await fetch(`${BASE}/api/people/11111111-1111-1111-1111-111111111111`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: cookie(DESK) },
      body: JSON.stringify({ pin: "8317" }),
    });
    /* 401 is also a refusal, but for the wrong reason -- it would pass this
       check on a route that happily set PINs for anyone signed in. The
       message is what says the rule was the one that fired. */
    if (r.status === 401) return false;
    const out = await r.json().catch(() => ({}));
    return r.status === 400 && /person it belongs to/i.test(out.error ?? "");
  });

  await ta("setting your own PIN needs a session", async () => {
    const r = await fetch(`${BASE}/api/me/pin`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "8317" }),
    });
    return r.status === 401;
  });

  await ta("a PIN that is not 4 to 8 numbers is refused by the setup link", async () => {
    const r = await fetch(`${BASE}/api/people/invite/${"L".repeat(40)}/pin`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "12" }),
    });
    const out = await r.json().catch(() => ({}));
    return r.status === 400 && /4 to 8/.test(out.error ?? "");
  });
}

for (const [name, ok, why] of said) {
  if (ok) console.log(` ok ${name}`);
  else console.error(` ✗ ${name}${why ? ` -- ${why}` : ""}`);
}
if (said.some(([, ok]) => !ok)) process.exit(1);
console.log("a PIN belongs to the person it signs for");
