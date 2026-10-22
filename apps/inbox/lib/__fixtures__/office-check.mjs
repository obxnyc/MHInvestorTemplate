/** The crew's line to the office.  Run: node lib/__fixtures__/office-check.mjs
 *
 *  Two things here, and neither is arithmetic.
 *
 *  ONE THREAD, NOT A NEW ONE EACH TIME. Two threads with the same people in
 *  them means half the history is in the one nobody is looking at -- the same
 *  reason `oneToOneThread` reuses rather than creates. The thread is found by
 *  its TITLE rather than by its membership, because membership changes:
 *  somebody joins the office and a thread matched on "exactly these people"
 *  silently stops matching.
 *
 *  AND THE LINE ABOVE THE MESSAGE IS THE SERVER'S. The office's first reply to
 *  "I need a part" is "where are you?", and the screen the message was sent
 *  from already knows. What it must never be is something the browser said --
 *  a claim about which job somebody is on is worth nothing if the person
 *  sending it chose the words.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => ts.transpileModule(
  readFileSync(join(here, "..", `${name}.ts`), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const dep = (name) => "data:text/javascript," + encodeURIComponent(load(name));
let src = load("office");
src = src.replaceAll('"@/lib/roles"', `"${dep("roles")}"`);
src = src.replaceAll('"@/lib/zone"', `"${dep("zone")}"`);
const { officeThread, withWhere, OFFICE_THREAD } =
  await import("data:text/javascript," + encodeURIComponent(src));

const said = [];
const t = (name, fn) => {
  let ok = false;
  try { ok = fn(); } catch (e) { said.push(` ✗ ${name} -- threw: ${e.message}`); return; }
  said.push(ok ? ` ok ${name}` : ` ✗ ${name}`);
};
const ta = async (name, fn) => {
  let ok = false;
  try { ok = await fn(); } catch (e) { said.push(` ✗ ${name} -- threw: ${e.message}`); return; }
  said.push(ok ? ` ok ${name}` : ` ✗ ${name}`);
};

/* A stand-in for the bits of the client `officeThread` touches. Enough to be
   wrong in the ways that matter, and no more. */
const makeDb = (seed) => {
  const tables = {
    staff: seed.staff ?? [],
    dm_threads: seed.dm_threads ?? [],
    dm_members: seed.dm_members ?? [],
  };
  let made = 0;
  const api = (name) => {
    let rows = tables[name].slice();
    const self = {
      /* PostgREST embeds a joined row under the alias asked for, and the
         lookup for an existing thread reads `row.thread.title`. A stand-in
         that returns the flat row leaves `thread` undefined, so no thread is
         ever found again and every call makes a new one -- which is the
         FAULT this file exists to catch, reported as a pass of the fixture's
         own making. Model the embed. */
      select(cols = "") {
        if (/thread:thread_id\(/.test(cols)) {
          rows = rows.map((r) => ({
            ...r,
            thread: tables.dm_threads.find((x) => x.id === r.thread_id) ?? null,
          }));
        }
        return self;
      },
      eq(k, v) { rows = rows.filter((r) => r[k] === v); return self; },
      in(k, vs) { rows = rows.filter((r) => vs.includes(r[k])); return self; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null }); },
      single() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      insert(v) {
        const list = Array.isArray(v) ? v : [v];
        for (const row of list) {
          if (name === "dm_threads") {
            made++;
            row.id = `made${made}`;
          }
          tables[name].push({ ...row });
        }
        const inserted = tables[name].slice(-list.length);
        return {
          select() {
            return { single: () => Promise.resolve({ data: inserted[0], error: null }) };
          },
          then(res) { return Promise.resolve({ data: inserted, error: null }).then(res); },
        };
      },
      then(res) { return Promise.resolve({ data: rows, error: null }).then(res); },
    };
    return self;
  };
  return { from: api, tables, threadsMade: () => made };
};

const ME = "crew-1";
/* THREE desk people, and one of them joins AFTER the thread exists. With one
   desk person the "catch the thread up" step has nothing to do, and a version
   that never did it would pass. */
const STAFF = [
  { id: ME, role: "crew", active: true },
  { id: "desk-1", role: "admin", active: true },
  { id: "desk-2", role: "office", active: true },
  { id: "desk-3", role: "office", active: true },
  { id: "tech-1", role: "tech", active: true },
  { id: "desk-old", role: "office", active: false },
];

await ta("a crew member with no thread gets one, with every desk in it", async () => {
  const db = makeDb({ staff: STAFF });
  const got = await officeThread(db, ME);
  const members = db.tables.dm_members.filter((m) => m.thread_id === got.id)
    .map((m) => m.staff_id).sort();
  return got && db.threadsMade() === 1
    && JSON.stringify(members) === JSON.stringify([ME, "desk-1", "desk-2", "desk-3"].sort());
});

await ta("a tech is not the office, and neither is somebody who has left", async () => {
  const db = makeDb({ staff: STAFF });
  const got = await officeThread(db, ME);
  const members = db.tables.dm_members.filter((m) => m.thread_id === got.id)
    .map((m) => m.staff_id);
  return !members.includes("tech-1") && !members.includes("desk-old");
});

await ta("asking twice does NOT make a second thread", async () => {
  const db = makeDb({ staff: STAFF });
  const a = await officeThread(db, ME);
  const b = await officeThread(db, ME);
  return a.id === b.id && db.threadsMade() === 1;
});

await ta("somebody who joined the office after the thread was made is added", async () => {
  const db = makeDb({
    staff: STAFF,
    dm_threads: [{ id: "t1", title: OFFICE_THREAD }],
    // desk-3 is NOT in it: they joined later.
    dm_members: [
      { thread_id: "t1", staff_id: ME }, { thread_id: "t1", staff_id: "desk-1" },
      { thread_id: "t1", staff_id: "desk-2" },
    ],
  });
  const got = await officeThread(db, ME);
  const members = db.tables.dm_members.filter((m) => m.thread_id === "t1")
    .map((m) => m.staff_id);
  return got.id === "t1" && db.threadsMade() === 0 && members.includes("desk-3")
    // and not added twice
    && members.filter((m) => m === "desk-1").length === 1;
});

await ta("an UNTITLED thread with the same people is not mistaken for this one",
  async () => {
    /* A one-to-one with a colleague who happens to be in the office is a
       private thread. Dropping a crew request into it would put it somewhere
       nobody expects, and is exactly what matching on membership would do. */
    const db = makeDb({
      staff: STAFF,
      dm_threads: [{ id: "priv", title: null }],
      dm_members: [{ thread_id: "priv", staff_id: ME },
                   { thread_id: "priv", staff_id: "desk-1" }],
    });
    const got = await officeThread(db, ME);
    return got.id !== "priv" && db.threadsMade() === 1;
  });

/* ------------------------------------------------- what the office is told */

t("off the clock says so", () =>
  withWhere("Need a key", null).startsWith("[off the clock]"));

/* THE ZONE. A shift that began at 8:08pm Eastern was written as "since
   12:08 AM", because the server formats in UTC and nothing said otherwise --
   wrong by four hours in the one line the office reads to decide whether to
   drive out. Checked with an instant whose UTC time and Eastern time fall on
   different SIDES of midnight, because a fixture an hour either way of noon
   cannot tell a wrong zone from a right one. */
t("the time is the time where the work is, not where the server is", () => {
  const out = withWhere("Need a key",
    // 2026-10-22T00:08Z is 8:08 PM on the 21st in New York.
    { property: "The Retreat", startedAt: "2026-10-22T00:08:00Z" });
  return /since 8:08 PM/.test(out) && !/12:08 AM/.test(out);
});

t("and a different zone is a different time", () => {
  const out = withWhere("Need a key",
    { property: "The Retreat", startedAt: "2026-10-22T00:08:00Z" }, "UTC");
  return /since 12:08 AM/.test(out);
});

t("on the clock names the job", () => {
  const out = withWhere("Need a key",
    { property: "The Retreat", startedAt: "2026-10-21T13:00:00Z" });
  return /^\[on the clock, on The Retreat, since /.test(out);
});

/* The case the whole line exists for. "No job recorded" is not the same claim
   as "on The Retreat", and a version that printed the property name when it
   had none -- or left the bracket off -- would read as a job nobody can find. */
t("on the clock with no job recorded says THAT, rather than nothing", () => {
  const out = withWhere("Need a key", { property: null, startedAt: null });
  return out.startsWith("[on the clock, no job recorded]");
});

t("the message itself is kept, under the line", () =>
  withWhere("  Need a key  ", null).endsWith("\nNeed a key"));

/* ------------------------------------------- and the answer coming back
 *
 * Against the running app, because this half lives in the route rather than
 * in a pure function. Skips when nothing is serving -- but says so, because a
 * silent skip is the fault this whole round was about.
 */
const BASE = process.env.PHONE_CHECK_BASE ?? "http://127.0.0.1:3100";
const STUB = "http://127.0.0.1:54321";
const CREW = "11111111-1111-1111-1111-111111111111";
const DESKID = "22222222-2222-2222-2222-222222222222";
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

const live = await fetch(`${STUB}/__reset`).then((r) => r.ok).catch(() => false);
if (!live) {
  said.push(" -- the round trip was NOT checked: no stand-in at " + STUB
    + ". Start lib/__fixtures__/stub-supabase.mjs, build against it, serve it.");
} else {
  const ask = (init) => fetch(`${BASE}/api/clock/ask`,
    { headers: { cookie: cookie(CREW) }, ...init })
    .then((r) => r.text()).then((t) => { try { return JSON.parse(t); } catch { return null; } })
    .catch(() => null);

  const before = await ask();
  await ta("nothing asked yet means no thread and nothing waiting",
    async () => before?.threadId === null && before?.unread === 0);

  const sent = await ask({ method: "POST",
    headers: { cookie: cookie(CREW), "content-type": "application/json" },
    body: JSON.stringify({ body: "Need a P-trap for 3124" }) });
  await ta("asking reaches somebody and says who",
    async () => sent?.ok === true && sent?.desks >= 1);

  /* THE ONE THAT MATTERS. Without the author filter this reads 1, and the
     screen tells a crew member the office replied when the only thing in the
     thread is their own message. Exactly what the inbox list did for months. */
  const mine = await ask();
  await ta("MY OWN message does not come back as the office replying",
    async () => mine?.unread === 0 && mine?.last === null);

  const say = (body, at) => fetch(`${STUB}/rest/v1/dm_messages`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify([{ thread_id: sent.threadId, author_id: DESKID, body,
                            created_at: at }]),
  }).catch(() => null);

  await say("Picking one up now, be there by 3.", new Date().toISOString());
  const answered = await ask();
  await ta("the office answering shows up, with their words",
    async () => answered?.unread === 1
      && /Picking one up now/.test(answered?.last?.body ?? ""));

  /* A reply from BEFORE this person last opened the thread is not news.
     Without the read-receipt comparison this reads 2, and a badge that counts
     things already seen is a badge nobody looks at. */
  await say("This was said before they last looked.", "2020-01-01T00:00:00Z");
  const older = await ask();
  await ta("a message older than the last read is not counted as new",
    async () => older?.unread === 1);
}

for (const l of said) (l.startsWith(" ✗") ? console.error : console.log)(l);
if (said.some((l) => l.startsWith(" ✗"))) process.exit(1);
console.log("one thread to the office, and it says where you were");
