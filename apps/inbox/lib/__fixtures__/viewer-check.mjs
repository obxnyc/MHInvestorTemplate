/** A read-only account can look at everything and change nothing.
 *
 *  Somebody wants to hand an account to a person who will look round the
 *  application and say what they think of it. The wrong way to do that is an
 *  admin password: a stranger poking at buttons on a live system can close a
 *  tenant's thread, reassign a job or turn somebody's access off, and none of
 *  it is obviously undoable.
 *
 *  WHERE IT IS ENFORCED IS THE WHOLE POINT. Not in the screens -- a hidden
 *  button is a suggestion, and every route behind one is a URL and a fetch
 *  away. It is refused in the proxy, by HTTP method, so there is nothing to
 *  remember when the next route is written.
 *
 *  Which also means the thing most worth checking is not the refusal. It is
 *  everything the refusal could have broken on its way in: webhooks that
 *  carry a signature and no session, sign-in routes used by people who are
 *  by definition not signed in yet, and ordinary staff still being able to
 *  work.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "..");
const code = (p) => readFileSync(join(app, p), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const said = [];
const t = (name, fn) => {
  try { said.push([name, Boolean(fn())]); }
  catch (e) { said.push([name, false, String(e.message ?? e).slice(0, 120)]); }
};
const ta = async (name, fn) => {
  try { said.push([name, Boolean(await fn())]); }
  catch (e) { said.push([name, false, String(e.message ?? e).slice(0, 120)]); }
};

/* ------------------------------------------------------------- the source */

const proxy = code("proxy.ts");

/* The matcher used to exclude `api`, which would have made all of this
   theatre: the screens are reads, and every change in this application is an
   API call. */
t("the proxy sees API routes at all", () => {
  const m = /matcher:\s*\[([^\]]*)\]/.exec(proxy)?.[1] ?? "";
  return m.length > 0 && !/\(\?!api\|/.test(m);
});

/* Written as the methods ALLOWED. A list of refused verbs is one somebody
   adds PATCH to and forgets, and the failure is silent. */
t("read-only is decided by a list of what may be read, not what may not", () => {
  const set = /READS\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(proxy)?.[1] ?? "";
  return /"GET"/.test(set) && /"HEAD"/.test(set)
    && !/"POST"|"PATCH"|"PUT"|"DELETE"/.test(set);
});

t("it fails closed: no staff row behind a session means no writing", () =>
  /!me \|\| me\.active === false \|\| me\.role === "viewer"/.test(proxy));

/* The one that would have broken every inbound text. */
t("an API request with no session is never bounced to the sign-in page", () => {
  const i = proxy.indexOf("if (!user)");
  const j = proxy.indexOf("}", proxy.indexOf("redirect", i));
  return /if \(api\) return response;/.test(proxy.slice(i, j + 1));
});

const roles = code("lib/roles.ts");
t("a viewer is not treated as desk staff or as field staff", () =>
  !/DESK[^=]*=\s*\[[^\]]*viewer/.test(roles)
  && !/FIELD[^=]*=\s*\[[^\]]*viewer/.test(roles));
t("and the office screens share one rule rather than four copies", () =>
  /canSeeOffice/.test(roles));

/* --------------------------------------------------------- the running app */

const BASE = process.env.PHONE_CHECK_BASE ?? "http://127.0.0.1:3100";
const STUB = "http://127.0.0.1:54321";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const cookie = (id) => {
  const exp = Math.floor(Date.now() / 1e3) + 3600;
  const jwt = [b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub: id, aud: "authenticated", role: "authenticated",
          email: "x@larabeehomesllc.com", exp, iat: exp - 3600,
          iss: `${STUB}/auth/v1` }), "c3R1Yg"].join(".");
  return "sb-127-auth-token=base64-" + Buffer.from(JSON.stringify({
    access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp,
    refresh_token: "s",
    user: { id, aud: "authenticated", role: "authenticated",
            email: "x@larabeehomesllc.com", app_metadata: {}, user_metadata: {},
            created_at: "2026-01-01T00:00:00Z" },
  })).toString("base64url");
};
const GUEST = cookie("33333333-3333-3333-3333-333333333333");
const ADMIN = cookie("22222222-2222-2222-2222-222222222222");

const live = await fetch(`${BASE}/report`).then((r) => r.status < 500).catch(() => false);
if (!live) {
  said.push([`-- the running app was NOT asked: nothing serving at ${BASE}`, true]);
} else {
  const code_of = (path, init) => fetch(`${BASE}${path}`, init)
    .then((r) => r.status).catch(() => 0);

  await ta("the guest can read the inbox", async () =>
    await code_of("/", { headers: { cookie: GUEST } }) === 200);
  await ta("and the jobs board, which used to be office-only", async () =>
    await code_of("/jobs", { headers: { cookie: GUEST } }) === 200);

  await ta("the guest is refused a write", async () =>
    await code_of("/api/clock/ask", {
      method: "POST", headers: { cookie: GUEST, "content-type": "application/json" },
      body: "{}",
    }) === 403);
  await ta("and refused on another verb entirely", async () =>
    await code_of("/api/me/pin", {
      method: "PATCH", headers: { cookie: GUEST, "content-type": "application/json" },
      body: JSON.stringify({ pin: "8317" }),
    }) === 403);

  /* A refusal everybody gets is not read-only, it is a broken application. */
  await ta("an admin can still write", async () =>
    await code_of("/api/people/11111111-1111-1111-1111-111111111111", {
      method: "PATCH", headers: { cookie: ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ pin: null }),
    }) === 200);

  /* These carry a signature or a token and no session. If the proxy ever
     starts bouncing them, every inbound text stops arriving and nothing says
     so -- the webhook gets an HTML sign-in page and calls it a day. */
  await ta("a webhook with no session reaches its route", async () => {
    const s = await code_of("/api/twilio/sms", {
      method: "POST", body: "From=%2B15555550100&Body=t",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    // 403 from the ROUTE's own signature check is fine; a redirect is not.
    return s !== 302 && s !== 307 && s !== 0;
  });
  await ta("and so does the PIN sign-in, used by people not yet signed in",
    async () => {
      const s = await code_of("/api/auth/pin", {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      return s === 400;
    });
}

/* ------------------------------------- a password, for a guest and nobody else
 *
 * The one route in this application where somebody else types your secret.
 * It is allowed BECAUSE the account cannot change anything -- so what has to
 * hold is exactly that it refuses every other kind of account.
 */
if (live) {
  const pw = (id, password, cookie) => fetch(`${BASE}/api/people/${id}/password`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ password }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
    .catch(() => ({ status: 0, body: {} }));

  const GUEST_ID = "33333333-3333-3333-3333-333333333333";
  const CREW_ID = "11111111-1111-1111-1111-111111111111";
  const ADMIN_ID = "22222222-2222-2222-2222-222222222222";

  await ta("an admin can set a guest's password", async () =>
    (await pw(GUEST_ID, "a-long-enough-one", ADMIN)).status === 200);

  /* The restriction this route exists under. Without it, one admin could take
     another's account, and an office password would be a credential that can
     close a tenant's thread. */
  await ta("but NOT another admin's", async () => {
    const r = await pw(ADMIN_ID, "a-long-enough-one", ADMIN);
    return r.status === 400 && /read-only/i.test(r.body.error ?? "");
  });
  await ta("and NOT a crew member's, who has a PIN of their own", async () => {
    const r = await pw(CREW_ID, "a-long-enough-one", ADMIN);
    return r.status === 400 && /read-only/i.test(r.body.error ?? "");
  });

  await ta("something too short is refused", async () =>
    (await pw(GUEST_ID, "short", ADMIN)).status === 400);

  /* And the guest cannot do it to itself -- which the proxy refuses before
     the route is even reached, by method. */
  await ta("a guest cannot set its own password", async () =>
    (await pw(GUEST_ID, "a-long-enough-one", GUEST)).status === 403);
}

for (const [name, ok, why] of said) {
  if (ok) console.log(` ok ${name}`);
  else console.error(` ✗ ${name}${why ? ` -- ${why}` : ""}`);
}
if (said.some(([, ok]) => !ok)) process.exit(1);
console.log("a guest looks at everything and changes nothing");
