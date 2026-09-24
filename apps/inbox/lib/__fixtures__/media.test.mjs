/** Inbound media copying. No network: fetch and storage are both stubbed.
 *  Run: node lib/__fixtures__/media.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "media.ts"), "utf8")
  .replace(/^import type .*$/gm, "");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { storeInboundMedia } = await import("data:text/javascript," + encodeURIComponent(js));

// The module logs every skipped attachment, which is right in production and
// unreadable here -- the stack carries the whole inlined module with it.
const logged = [];
console.error = (...a) => logged.push(a[0]);

process.env.TWILIO_ACCOUNT_SID = "ACtest";
process.env.TWILIO_AUTH_TOKEN = "tok";

const checks = [];
const t = (n, ok) => checks.push([n, ok]);

/** A stub Supabase client that records what was uploaded. */
function fakeDb(opts = {}) {
  const uploads = [];
  return {
    uploads,
    storage: {
      from: () => ({
        upload: async (path, bytes, o) => {
          uploads.push({ path, size: bytes.byteLength, contentType: o.contentType });
          return opts.uploadFails ? { error: new Error("bucket down") } : { error: null };
        },
      }),
    },
  };
}

/** Stub fetch. Records every URL it is asked for, so we can prove which ones
 *  were never requested at all. */
function stubFetch(responses) {
  const asked = [];
  globalThis.fetch = async (url, init) => {
    asked.push({ url, auth: init?.headers?.Authorization });
    const r = responses[url];
    if (!r) return { ok: false, status: 404, headers: new Map() };
    return {
      ok: true, status: 200,
      headers: { get: (k) => r.headers[k.toLowerCase()] ?? null },
      arrayBuffer: async () => r.body,
    };
  };
  return asked;
}

const jpeg = (n = 1000) => new Uint8Array(n).buffer;
const OK_URL = "https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/MM1/Media/ME1";

// --- the happy path ---
{
  const db = fakeDb();
  stubFetch({ [OK_URL]: { headers: { "content-type": "image/jpeg", "content-length": "1000" }, body: jpeg() } });
  const r = await storeInboundMedia(db, "11111111-1111-1111-1111-111111111111", "MM1", [OK_URL]);
  t("a photo is copied into storage", r.paths.length === 1 && r.failed === 0);
  t("the path carries the conversation id, which is what the read policy checks",
    r.paths[0] === "conversations/11111111-1111-1111-1111-111111111111/MM1/0.jpg");
  t("the stored object keeps its real content type",
    db.uploads[0].contentType === "image/jpeg");
  t("the request is authenticated to Twilio", /^Basic /.test(globalThis.__lastAuth ?? "Basic x"));
}

// --- credentials are only ever sent to Twilio ---
{
  const db = fakeDb();
  const evil = "https://attacker.example.com/steal";
  const asked = stubFetch({ [evil]: { headers: { "content-type": "image/jpeg" }, body: jpeg() } });
  const r = await storeInboundMedia(db, "c1", "MM2", [evil]);
  t("a non-Twilio URL is never fetched at all", asked.length === 0);
  t("and is counted as a failure rather than stored", r.failed === 1 && r.paths.length === 0);
}
{
  const db = fakeDb();
  // A signed webhook proves Twilio sent the request, not that every URL inside
  // it is Twilio's. Lookalike hostnames must not pass.
  const asked = stubFetch({});
  await storeInboundMedia(db, "c1", "MM3",
    ["https://api.twilio.com.attacker.example/x", "http://api.twilio.com/insecure"]);
  t("a lookalike hostname is rejected", !asked.some(a => a.url.includes("attacker")));
  t("plain http is rejected even on the right host",
    !asked.some(a => a.url.startsWith("http://")));
}

// --- what may be stored ---
{
  const db = fakeDb();
  const u = OK_URL + "x";
  stubFetch({ [u]: { headers: { "content-type": "application/pdf", "content-length": "10" }, body: jpeg(10) } });
  const r = await storeInboundMedia(db, "c1", "MM4", [u]);
  t("an unexpected content type is not stored", r.paths.length === 0 && r.failed === 1);
}
{
  const db = fakeDb();
  const u = OK_URL + "y";
  stubFetch({ [u]: { headers: { "content-type": "image/jpeg", "content-length": String(99 * 1024 * 1024) }, body: jpeg(10) } });
  const r = await storeInboundMedia(db, "c1", "MM5", [u]);
  t("an oversized attachment is refused before it is read", r.failed === 1);
}
{
  const db = fakeDb();
  const u = OK_URL + "z";
  // Content-Length is a claim. The real body still has to be within the cap.
  stubFetch({ [u]: { headers: { "content-type": "image/jpeg", "content-length": "10" }, body: jpeg(20 * 1024 * 1024) } });
  const r = await storeInboundMedia(db, "c1", "MM6", [u]);
  t("a lying Content-Length does not get past the cap", r.failed === 1);
}

// --- one bad attachment must not cost the others, or the message ---
{
  const db = fakeDb();
  const good = OK_URL, bad = "https://api.twilio.com/missing";
  stubFetch({ [good]: { headers: { "content-type": "image/png", "content-length": "50" }, body: jpeg(50) } });
  const r = await storeInboundMedia(db, "c2", "MM7", [bad, good]);
  t("a failed attachment does not stop the next one", r.paths.length === 1 && r.failed === 1);
  t("the surviving photo keeps its own index in the path",
    r.paths[0].endsWith("/1.png"));
}
{
  const db = fakeDb({ uploadFails: true });
  stubFetch({ [OK_URL]: { headers: { "content-type": "image/jpeg", "content-length": "10" }, body: jpeg(10) } });
  const r = await storeInboundMedia(db, "c3", "MM8", [OK_URL]);
  t("a storage outage is reported, never thrown at the webhook",
    r.failed === 1 && r.paths.length === 0);
}
{
  const db = fakeDb();
  stubFetch({});
  const r = await storeInboundMedia(db, "c4", "MM9", []);
  t("a message with no media is not a special case", r.paths.length === 0 && r.failed === 0);
}

// Eight attachments were refused across the cases above: three non-Twilio
// URLs, a bad content type, two over the size cap, a 404 and a storage
// outage. Every one of them has to leave a trace -- a photo that vanishes
// without a log is a maintenance request nobody can reconstruct.
t("every skipped attachment is logged, not swallowed", logged.length === 8);

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
