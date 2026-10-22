/** The inbox is ONE list, newest first, and says what has not been seen.
 *
 *  Both halves of this were reported from a screenshot rather than by any
 *  check here. A text that had arrived "just now" sat UNDER a colleague's
 *  message from twenty hours ago, because staff threads and conversations
 *  were two correctly-sorted lists rendered one after the other -- and
 *  neither carried any mark to say a new message had come in.
 *
 *  The fixture's three rows are deliberately INTERLEAVED in time: the text is
 *  newer than the staff thread, which is newer than the old conversation. A
 *  fixture where the staff thread is oldest or newest cannot tell a merged
 *  list from a stacked one -- both orders would look the same, and the check
 *  would pass on the fault.
 *
 *  Needs the stand-in database and a build pointed at it:
 *    node lib/__fixtures__/stub-supabase.mjs
 *    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 npx next build
 *    npx next start -p 3100
 */
const BASE = process.env.PHONE_CHECK_BASE ?? "http://127.0.0.1:3100";
const STUB = "http://127.0.0.1:54321";
const DESK = "22222222-2222-2222-2222-222222222222";

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

const reach = await fetch(`${STUB}/rest/v1/staff`).then((r) => r.ok).catch(() => false);
if (!reach) {
  console.log(`skipped: ${STUB} is not answering.`
    + " Start lib/__fixtures__/stub-supabase.mjs, build against it, then run this.");
  process.exit(0);
}
/* Put the stand-in back first. Anything that wrote to it -- a run of the
   crew's line to the office, somebody poking it by hand -- leaves rows
   behind, and a fourth row in the list fails "three rows are listed" for a
   reason that has nothing to do with the ordering this file is about. */
await fetch(`${STUB}/__reset`).catch(() => null);

const res = await fetch(`${BASE}/`, { headers: { cookie: cookie(DESK) } })
  .catch(() => null);
if (!res) {
  console.log(`skipped: nothing serving at ${BASE}.`);
  process.exit(0);
}
/* Up and erroring is NOT a reason to skip -- that read as "no server" in
   phone-check.mjs for as long as it existed, and reported a pass. */
if (res.status >= 500) {
  console.error(` ✗ ${BASE}/ answers ${res.status}; nothing was checked.`);
  process.exit(1);
}
const html = await res.text();

const said = [];
const t = (name, fn) => {
  let ok = false;
  try { ok = fn(); } catch (e) { said.push(` ✗ ${name} -- threw: ${e.message}`); return; }
  said.push(ok ? ` ok ${name}` : ` ✗ ${name}`);
};

/* The space after "row" matters: `class="row([^"]*)"` also matches the
   `class="rows"` on the <ul> that holds them, which shifted every row by one
   and reported the first one as unmarked. Same family as anchoring on the
   call rather than the words, which cost a round in inside-check.mjs. */
const rows = [...html.matchAll(
  /class="row ([^"]*)"[\s\S]*?class="rname">([\s\S]*?)<\/span>[\s\S]*?class="rtime">([\s\S]*?)<\/span>/g)]
  .map((m) => ({ cls: m[1].trim(), name: m[2].replace(/<[^>]+>/g, "").trim(),
                 when: m[3].replace(/<[^>]+>/g, "").trim() }));

t("three rows are listed", () => rows.length === 3);
t("the text that arrived just now is FIRST, above the staff thread",
  () => /642-2995/.test(rows[0]?.name ?? ""));
t("the staff thread from 20h ago is second, not on top",
  () => /Alex Prieto/.test(rows[1]?.name ?? ""));
t("the twenty-day-old conversation is last",
  () => /Michelle Griffin/.test(rows[2]?.name ?? ""));

t("the new text is marked unread", () => /\bunread\b/.test(rows[0]?.cls ?? ""));
t("the unseen staff thread is marked unread", () => /\bunread\b/.test(rows[1]?.cls ?? ""));
/* The one that proves the mark is not just "is it old". The newest message on
   Michelle's thread is one WE sent, so there is nothing there to see -- a
   queue that lights up for our own replies is a queue nobody believes. */
t("a thread whose newest message is OURS is not marked unread",
  () => !/\bunread\b/.test(rows[2]?.cls ?? ""));
t("exactly two rows say new", () => (html.match(/>new<\/span>/g) ?? []).length === 2);

for (const l of said) (l.startsWith(" ✗") ? console.error : console.log)(l);
if (said.some((l) => l.startsWith(" ✗"))) process.exit(1);
console.log("the inbox is one list, newest first, and says what is new");
