/**
 * The application on a database that is behind.
 *
 * Migrations are run by hand, so there is always a window where the code
 * is ahead of the schema -- and PostgREST refuses the WHOLE select when
 * one column in it is missing. Naming a new column without a way back
 * does not degrade a feature, it takes the screen out: `place_hint` was
 * added to the conversation query and every conversation in the
 * application answered 404, with "Couldn't open that conversation" on
 * screen. The same fault as migration 015, in the same query, twenty
 * lines above the comment warning about it.
 *
 *     node lib/__fixtures__/tolerant-check.mjs
 *
 * The stand-in database is the fixture on purpose: its conversations have
 * every column the real one has EXCEPT the ones from migrations it is
 * pretending have not been run.
 */
const BASE = process.env.PHONE_CHECK_BASE ?? "http://127.0.0.1:3100";
const STUB = "http://127.0.0.1:54321";

const up = async (u) => fetch(u).then((r) => r.status).catch(() => 0);
if (!(await up(`${BASE}/report`))) {
  console.log(`skipped: nothing is answering on ${BASE}.`);
  process.exit(0);
}
if (!(await up(`${STUB}/rest/v1/staff`))) {
  console.error(` ✗ ${STUB} is not answering. Start stub-supabase.mjs.`);
  process.exit(1);
}
await fetch(`${STUB}/__reset`).catch(() => null);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const who = "22222222-2222-2222-2222-222222222222";
const exp = Math.floor(Date.now() / 1e3) + 3600;
const jwt = [b64({ alg: "HS256", typ: "JWT" }),
  b64({ sub: who, aud: "authenticated", role: "authenticated",
        email: "2222@larabeehomesllc.com", exp, iat: exp - 3600,
        iss: `${STUB}/auth/v1` }), "c3R1Yg"].join(".");
const cookie = "sb-127-auth-token=base64-" + Buffer.from(JSON.stringify({
  access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp,
  refresh_token: "stub-refresh",
  user: { id: who, aud: "authenticated", role: "authenticated",
          email: "2222@larabeehomesllc.com", app_metadata: {},
          user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
})).toString("base64url");

const asStaff = (path) => fetch(`${BASE}${path}`, { headers: { cookie } });

const results = [];
const t = (name, run) => results.push([name, run]);
const checks = [];

/* THE STAND-IN HAS TO BE STRICT, or none of this means anything. It used
   to ignore a column it had never heard of, which is why it watched the
   live site break without a word. */
checks.push(["the stand-in refuses a column it does not have", async () => {
  const r = await fetch(`${STUB}/rest/v1/conversations?select=id,no_such_column`);
  const b = await r.json().catch(() => ({}));
  return r.status === 400 && b.code === "42703";
}]);
checks.push(["and its conversations really are missing place_hint", async () => {
  const r = await fetch(`${STUB}/rest/v1/conversations?select=id,place_hint`);
  return r.status === 400;
}]);
checks.push(["while having the columns a conversation does have", async () => {
  const r = await fetch(`${STUB}/rest/v1/conversations?select=id,unit_id,subject`);
  return r.ok;
}]);

/* THE SCREENS THAT MUST STILL WORK. The thread is asked through its own
   route, because that is the query that broke and a route says which one
   it was. The rest are asked as pages, because that is how they are
   loaded -- a conversation list is rendered on the server and has no
   route to ask. */
checks.push(["a conversation opens on a database that is behind", async () => {
  const r = await asStaff("/api/conversations/cv1/thread");
  if (!r.ok) {
    throw new Error(`the thread answered ${r.status}: `
      + (await r.text()).slice(0, 140));
  }
  const b2 = await r.json();
  return b2?.convo?.id === "cv1";
}]);

for (const [what, path] of [
  ["the messages queue", "/"],
  ["that conversation's own page", "/c/cv1"],
  ["the home screen", "/home"],
  ["properties", "/properties"],
]) {
  checks.push([`${what} still draws`, async () => {
    const r = await asStaff(path);
    if (!r.ok) throw new Error(`${path} answered ${r.status}`);
    const html = await r.text();
    /* A page that loaded and says it could not do the thing is not a
       page that works. This is the sentence the owner photographed. */
    for (const bad2 of ["Couldn't open that conversation",
                        "Application error", "could not be loaded"]) {
      if (html.includes(bad2)) throw new Error(`${path} says "${bad2}"`);
    }
    return true;
  }]);
}

let bad = 0;
for (const [name, run] of checks) {
  let ok = false, why = null;
  try { ok = (await run()) === true; }
  catch (e) { why = String(e && e.message || e); }
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
void results; void t;
if (bad) { console.error(` ✗ ${bad} of ${checks.length}`); process.exit(1); }
console.log("the application still works on a database that is behind");
