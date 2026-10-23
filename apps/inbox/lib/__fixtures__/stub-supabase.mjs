/** A stand-in Supabase, so the SIGNED-IN screens can be looked at.
 *
 *  phone-check.mjs loads the real pages, and until this existed it could only
 *  load the five public ones -- so the screen the owner actually complains
 *  about, the crew clock, was the one thing it could not see. Every finding
 *  about it came from a photograph of a phone.
 *
 *  Auth answers for whichever token asked; the REST side answers with just
 *  enough rows for a page to render, and honours `eq` filters. Everything it
 *  does not know about comes back as an empty list, which is what a real
 *  database with nothing in it would say.
 *
 *  Two identities, because one cannot tell the screens apart -- see STAFF.
 *
 *  Start it with `node lib/__fixtures__/stub-supabase.mjs`, point
 *  NEXT_PUBLIC_SUPABASE_URL at http://127.0.0.1:54321, build, and start the
 *  app. phone-check.mjs mints its own cookies against the ids below.
 */
import { createServer } from "node:http";

const WHO = "11111111-1111-1111-1111-111111111111";
const USER = { id: WHO, aud: "authenticated", role: "authenticated",
               email: "cade@larabeehomesllc.com", app_metadata: {},
               user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

/* TWO identities, because one cannot tell the screens apart. `crew` is
   CLOCK_ONLY, so a crew cookie is redirected away from every office screen --
   which is correct, and means a single crew fixture silently checks nothing
   on /home, /jobs, /timesheets or the inbox. */
const DESK = "22222222-2222-2222-2222-222222222222";
const GUEST = "33333333-3333-3333-3333-333333333333";
const STAFF = [
  { id: WHO, full_name: "Cade Barrow", role: "crew",
    forward_to: null, client_identity: null, active: true,
    created_at: "2026-01-01T00:00:00Z" },
  { id: DESK, full_name: "Dana Reese", role: "admin",
    forward_to: null, client_identity: null, active: true,
    created_at: "2026-01-01T00:00:00Z" },
  // Somebody looking round and saying what they think. Reads everything,
  // changes nothing.
  { id: GUEST, full_name: "Robin Vale", role: "viewer",
    forward_to: null, client_identity: null, active: true,
    created_at: "2026-01-01T00:00:00Z" },
];

const PROPERTIES = [
  { id: "p1", name: "The Retreat", address: "3100 Lady Viola Dr, Fayetteville NC",
    kind: "mhp", lat: 35.1, lng: -78.96, fence_m: 250 },
  { id: "p2", name: "1140 Northside Road Mobile Home Community",
    address: "1140 Northside Rd, Elizabeth City NC", kind: "mhp",
    lat: 36.3, lng: -76.2, fence_m: 250 },
  { id: "p3", name: "1012 Chason St", address: "1012 Chason St", kind: "sfh",
    lat: 35.11, lng: -78.97, fence_m: null },
];

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const SHIFTS = [
  { id: "s1", staff_id: WHO, property_id: "p1", property_from: "fence",
    started_at: iso(now - 7 * 3600e3), ended_at: iso(now - 2 * 3600e3),
    signed_off_at: null, start_fence: "inside", end_fence: "inside",
    shift_breaks: [{ started_at: iso(now - 5 * 3600e3),
                     ended_at: iso(now - 4.5 * 3600e3) }] },
  { id: "s2", staff_id: WHO, property_id: null, property_from: null,
    started_at: iso(now - 1.5 * 3600e3), ended_at: null, signed_off_at: null,
    start_fence: "unsure", end_fence: null, shift_breaks: [] },
];

const TABLES = {
  staff: STAFF,
  properties: PROPERTIES,
  shifts: SHIFTS,
  clock_rules: [{ id: true, daily_cap: 10, break_after: 6, break_minutes: 30,
                  abandoned_after: 14, ping_minutes: 10 }],
  shift_edits: [],
  units: [], work_orders: [], owners: [], inquiries: [],
  /* THE OWNER'S OWN SCREENSHOT, as rows: a colleague's thread from twenty
     hours ago, and a text that arrived just now. They were rendered as two
     stacked lists, so the twenty-hour-old one sat on top. A fixture where
     both are the same age cannot tell the merged order from the stacked one. */
  contacts: [
    { id: "ct1", phone: "+12526422995", full_name: null, party: "unknown",
      language: null, unit_id: null, units: null },
    { id: "ct2", phone: "+19105550114", full_name: "Michelle Griffin",
      party: "tenant", language: null, unit_id: null, units: null },
  ],
  conversations: [
    { id: "cv1", category: "general", source: "sms", status: "open",
      assigned_to: null, closure_prompts: 0, category_confidence: 0.4,
      last_message_at: iso(now - 30e3),
      last_message_preview: "Hello my pipes are overflowing with water",
      subject: null, units: null, staff: null, team_id: null,
      contacts: { id: "ct1", phone: "+12526422995", full_name: null,
        party: "unknown", language: null, unit_id: null, units: null } },
    { id: "cv2", category: "maintenance", source: "sms", status: "open",
      assigned_to: null, closure_prompts: 0, category_confidence: 0.95,
      last_message_at: iso(now - 20 * 24 * 3600e3),
      last_message_preview: "Hey Michelle, received your maintenance request.",
      subject: null, units: null, staff: null, team_id: null,
      contacts: { id: "ct2", phone: "+19105550114", full_name: "Michelle Griffin",
        party: "tenant", language: null, unit_id: null, units: null } },
  ],
  messages: [
    // cv1's newest is INBOUND: it is unread.
    { id: "m1", conversation_id: "cv1", direction: "inbound",
      body: "Hello my pipes are overflowing with water", created_at: iso(now - 30e3) },
    // cv2's newest is OUTBOUND -- we answered. Not unread, however long ago
    // anyone last opened it.
    { id: "m2", conversation_id: "cv2", direction: "inbound",
      body: "My sink is leaking", created_at: iso(now - 21 * 24 * 3600e3) },
  ],
  /* Michelle's thread, as the timings that tell the two rules apart:
       - her message came in      21 days ago
       - somebody read it         21 days ago
       - WE replied               20 days ago  (so last_message_at is ours)
     The naive rule, `last_message_at > last_read_at`, calls that unread. The
     right one, "is the newest message FROM OUTSIDE newer than my last read",
     does not. With the read time set to the REPLY the two agree, and the
     check cannot tell which one is running -- which is how it was written the
     first time. */
  conversation_reads: [
    { conversation_id: "cv2", staff_id: WHO, last_read_at: iso(now - 21 * 24 * 3600e3) },
    { conversation_id: "cv2", staff_id: DESK, last_read_at: iso(now - 21 * 24 * 3600e3) },
  ],
  open_category_counts: [
    { category: "general", total: 1, unclaimed: 1 },
    { category: "maintenance", total: 1, unclaimed: 1 },
  ],
  /* Alex Prieto, twenty hours ago -- the row that was sitting on top. */
  dm_members: [
    { staff_id: WHO, last_read_at: null, thread: { id: "dm1", title: "Alex Prieto",
      last_at: iso(now - 20 * 3600e3),
      dm_members: [{ staff: { id: "s9", full_name: "Alex Prieto" } }],
      dm_messages: [{ body: "Did the plumber ever call you back?",
                      created_at: iso(now - 20 * 3600e3), author_id: "s9" }] } },
    { staff_id: DESK, last_read_at: null, thread: { id: "dm1", title: "Alex Prieto",
      last_at: iso(now - 20 * 3600e3),
      dm_members: [{ staff: { id: "s9", full_name: "Alex Prieto" } }],
      dm_messages: [{ body: "Did the plumber ever call you back?",
                      created_at: iso(now - 20 * 3600e3), author_id: "s9" }] } },
  ],
  /* A setup link that has been used. The row survives; it is the LINK that
     is finished -- which is the whole reason the dead screen can still offer
     to ask for another on this person's behalf. */
  staff_invites: [
    // Live, for field staff: the setup screen should offer a PIN, not an email.
    { id: "iv0", token: "L".repeat(40), full_name: "Tomás Herrera",
      phone: "+19105550133", role: "crew",
      expires_at: iso(now + 5 * 24 * 3600e3), used_at: null, reasked_at: null },
    { id: "iv1", token: "s".repeat(40), full_name: "Abel Moreno",
      phone: "+19105550199", role: "crew",
      expires_at: iso(now + 7 * 24 * 3600e3), used_at: iso(now - 3600e3),
      reasked_at: null },
  ],
  notes: [], teams: [], markets: [],
};

/* The seed, kept, so a run can put the tables back.
   Anything that WRITES changes what the next check reads: two end-to-end
   posts left an Office thread behind, a fourth row appeared in the inbox, and
   order-check.mjs failed on "three rows are listed" -- which is the check
   doing its job about the wrong thing. A harness that depends on accumulated
   state fails for reasons that have nothing to do with the code. */
const SEED = structuredClone(TABLES);

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => {
    res.writeHead(code, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    });
    res.end(JSON.stringify(body));
  };
  if (req.method === "OPTIONS") return send(204, {});
  // Put the tables back the way they started. Checks call this first.
  if (url.pathname === "/__reset") {
    for (const k of Object.keys(TABLES)) delete TABLES[k];
    Object.assign(TABLES, structuredClone(SEED));
    return send(200, { reset: true });
  }

  /* Answer for WHICHEVER token asked. Returning the one user whatever the
     bearer said made the office cookie come back as the crew member, so every
     office screen redirected and the run looked like a pass. */
  if (url.pathname.startsWith("/auth/v1/user")) {
    const tok = (req.headers.authorization || "").replace(/^Bearer /i, "");
    let sub = WHO;
    try {
      sub = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()).sub || WHO;
    } catch { /* not a jwt: fall back to the crew member */ }
    const who = STAFF.find((m) => m.id === sub);
    return send(200, { ...USER, id: sub,
      email: who ? `${who.full_name.split(" ")[0].toLowerCase()}@larabeehomesllc.com`
                 : USER.email });
  }
  if (url.pathname.startsWith("/auth/v1/token")) {
    return send(200, { access_token: "stub", token_type: "bearer",
                       expires_in: 3600, refresh_token: "stub", user: USER });
  }

  /* INSERTS, so a feature that WRITES can be exercised end to end rather than
     only up to the point where it tries. Without this the crew's line to the
     office could only ever be checked as far as "could not open a thread",
     which is the stand-in's answer and not the code's. */
  /* RPC. Without this a call to `rpc("claim_issue_pull", …)` fell into the
     insert branch below and was answered with a created ROW -- truthy, not
     `true`, so the caller skipped every time and the feature looked like it
     was working by doing nothing. A stand-in that answers the wrong shape is
     as misleading as one that answers the wrong value. */
  if (req.method === "POST" && url.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = url.pathname.slice("/rest/v1/rpc/".length);
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let args = {};
      try { args = JSON.parse(raw || "{}"); } catch { args = {}; }
      if (fn === "claim_issue_pull") {
        // The real one is a single atomic statement; this is a stand-in for
        // the SHAPE of the answer, not for the locking.
        const row = (TABLES.rm_issue_pulls ??= [{ id: true, started_at: null,
          finished_at: null, ok: null, filed: 0, error: null }])[0];
        const stale = (args.p_stale ?? 5) * 60e3;
        const dead = (args.p_dead ?? 3) * 60e3;
        const t = (v) => (v ? Date.parse(v) : 0);
        const may = !row.started_at
          || (row.finished_at && Date.now() - t(row.finished_at) > stale)
          || (!row.finished_at && Date.now() - t(row.started_at) > dead);
        if (may) { row.started_at = new Date().toISOString(); row.finished_at = null; }
        return send(200, may);
      }
      if (fn === "finish_issue_pull") {
        const row = (TABLES.rm_issue_pulls ??= [{ id: true }])[0];
        row.finished_at = new Date().toISOString();
        row.ok = args.p_ok; row.filed = args.p_filed; row.error = args.p_error;
        return send(200, null);
      }
      return send(200, null);
    });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length).split("?")[0];
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body = [];
      try { body = JSON.parse(raw || "[]"); } catch { body = []; }
      const list = Array.isArray(body) ? body : [body];
      /* `created_at` the way Postgres would, with its default.
         Without it an inserted row has none, and `row.created_at > seen` is
         `undefined > seen` -- false. So a crew member's own message was
         excluded from "has the office replied" by the DATE comparison before
         the author comparison could matter, and deleting the author filter
         altogether still passed. A guard standing behind a second guard is a
         guard nobody has tested. */
      const made = list.map((row, i) => ({
        id: row.id ?? `${table}-${(TABLES[table] ?? []).length + i + 1}`,
        created_at: new Date().toISOString(),
        ...row,
      }));
      TABLES[table] = (TABLES[table] ?? []).concat(made);
      const accept = req.headers.accept ?? "";
      return send(201, accept.includes("vnd.pgrst.object") ? made[0] : made);
    });
    return;
  }
  /* PATCH ACTUALLY WRITES.
     It used to answer 200 and change nothing, which made every check of a
     feature that UPDATES hollow: the screen said "the office has been told"
     and the row was untouched, and the check passed on both. A stand-in that
     accepts a write it does not perform tells you the thing you were trying
     to find out is fine. */
  if (req.method === "PATCH" && url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length).split("?")[0];
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let patch = {};
      try { patch = JSON.parse(raw || "{}"); } catch { patch = {}; }
      const hit = [];
      for (const row of TABLES[table] ?? []) {
        let match = true;
        for (const [k, v] of url.searchParams) {
          if (["select", "order", "limit", "offset"].includes(k)) continue;
          const m = /^eq\.(.*)$/.exec(v);
          if (m && String(row[k]) !== m[1]) { match = false; break; }
          if (/^is\.null$/.test(v) && row[k] !== null && row[k] !== undefined) {
            match = false; break;
          }
        }
        if (match) { Object.assign(row, patch); hit.push(row); }
      }
      const accept = req.headers.accept ?? "";
      return send(200, accept.includes("vnd.pgrst.object") ? (hit[0] ?? null) : hit);
    });
    return;
  }

  if (url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length).split("?")[0];
    let rows = TABLES[table] ?? [];
    /* HONOUR eq FILTERS. Returning every row whatever was asked made
       `staff?id=eq.<office uuid>` answer with the crew member -- so the office
       cookie was read as crew, every office screen redirected, and the run
       read as a pass. A stand-in that ignores the question answers the wrong
       one confidently. */
    for (const [k, v] of url.searchParams) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      /* `is.null` as well as `eq.`. Without it, "the shift that has not ended"
         matched every shift, the first one came back -- a shift that ended
         hours ago -- and the context line the whole feature exists for was
         never exercised. */
      const isNull = /^is\.null$/.test(v);
      const isNotNull = /^not\.is\.null$/.test(v);
      if (isNull || isNotNull) {
        rows = rows.filter((r) => {
          const got = r[k];
          const empty = got === null || got === undefined;
          return isNull ? empty : !empty;
        });
        continue;
      }
      const m = /^eq\.(.*)$/.exec(v);
      if (!m) continue;
      const want = m[1] === "null" ? null : m[1];
      rows = rows.filter((r) => {
        const got = r[k];
        if (want === null) return got === null || got === undefined;
        return String(got) === want
          || (got === true && want === "true") || (got === false && want === "false");
      });
    }
    // PostgREST answers a `.single()` with an object; supabase-js asks for it
    // with this header, so honouring it is what stops pages throwing.
    /* EMBEDS. PostgREST returns a joined row under the alias asked for, and
       code reads `row.thread.title` or `row.properties.name`. A stand-in that
       returns the flat row leaves those undefined -- which does not throw, it
       just makes every lookup MISS. The crew's line to the office then made a
       fresh thread on every message, and the end-to-end check reported the
       stand-in's behaviour as the route's.

       Named explicitly rather than guessed from the column: `thread_id` does
       not spell `dm_threads`, and a stand-in that guesses wrong is a stand-in
       that lies in a new place. */
    const EMBEDS = {
      dm_members: { thread: ["thread_id", "dm_threads"] },
      shifts: { properties: ["property_id", "properties"] },
    };
    const want = url.searchParams.get("select") ?? "";
    for (const [alias, [fk, target]] of Object.entries(EMBEDS[table] ?? {})) {
      if (!new RegExp(`(^|,)\\s*${alias}\\s*[:(]`).test(want)) continue;
      rows = rows.map((r) => (alias in r ? r : {
        ...r, [alias]: (TABLES[target] ?? []).find((x) => x.id === r[fk]) ?? null,
      }));
    }

    const accept = req.headers.accept ?? "";
    if (accept.includes("vnd.pgrst.object")) {
      return rows.length ? send(200, rows[0])
        : send(406, { message: "no rows" });
    }
    return send(200, rows);
  }
  return send(200, []);
}).listen(54321, "127.0.0.1", () => console.log("stub supabase on 54321"));
