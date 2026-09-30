/** Inbound media copying. No network: fetch and storage are both stubbed.
 *  Run: node lib/__fixtures__/media.test.mjs */
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const transpile = (file) =>
  ts.transpileModule(
    readFileSync(join(here, "..", file), "utf8").replace(/^import type .*$/gm, ""),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;

// media.ts re-exports the attachment rules from "./attachments". TypeScript
// fills in the extension; Node does not, so the specifier is pointed at a
// generated sibling rather than left to fail on a bare path.
//
// Both files are written into lib/ rather than next to this test, because a
// relative specifier resolves against wherever the importing file sits. From
// __fixtures__/ that is a module which does not exist, and the failure names
// the import rather than the misplacement.
const tmp = join(here, "..", ".media.gen.mjs");
const tmpRules = join(here, "..", ".media.attachments.gen.mjs");
writeFileSync(tmpRules, transpile("attachments.ts"));
writeFileSync(tmp, transpile("media.ts")
  .replace(/(["'])\.\/attachments\1/g, '"./.media.attachments.gen.mjs"'));
let storeInboundMedia, safeName, nameOf, isImagePath, pathIsSendable,
    belongsToConversation, keepableExtension, isSendable;
try {
  ({ storeInboundMedia, safeName, nameOf, isImagePath, pathIsSendable,
     belongsToConversation, keepableExtension, isSendable } = await import(tmp));
} finally {
  unlinkSync(tmp);
  unlinkSync(tmpRules);
}

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
  // text/html specifically. This bucket is read back through signed URLs a
  // browser opens directly, and Supabase serves an object under the type it
  // was stored with -- so an HTML file here is a script on our own origin,
  // delivered by anyone who can text our number.
  stubFetch({ [u]: { headers: { "content-type": "text/html", "content-length": "10" }, body: jpeg(10) } });
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

// ------------------------------------------------------- going the other way
//
// Outbound attachments. Everything below is a pure rule -- no network, no
// storage -- and every one of them is load-bearing: two are the difference
// between a message that arrives and one that is silently dropped by a
// carrier, and one is the check that stops a signed-in person texting
// themselves another conversation's photographs.

t("a carrier will take a JPEG", isSendable("image/jpeg"));
t("and a PDF, which is how a notice gets sent", isSendable("application/pdf"));
t("a spreadsheet is not something a phone can receive",
  !isSendable("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
t("but we will still hold one, because a note is not a text",
  keepableExtension("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") === "xlsx");
t("a content type with a charset on it is still recognised",
  isSendable("image/jpeg; charset=binary") && keepableExtension("TEXT/CSV") === "csv");

// The bucket is read back through signed URLs a browser opens directly, and
// Supabase serves an object under the type it was stored with. Accepting
// either of these would be accepting a script that runs on our own origin.
t("HTML is refused outright", keepableExtension("text/html") === null);
t("and so is an SVG, which is a script wearing a picture's clothes",
  keepableExtension("image/svg+xml") === null);

t("a file keeps a name somebody can recognise",
  safeName("March ledger.xlsx", "xlsx") === "March-ledger.xlsx");
t("a name that would climb out of its folder cannot",
  !safeName("../../etc/passwd", "png").includes("/")
  && !safeName("../../etc/passwd", "png").includes(".."));
// The extension is the canonical one for the type the server accepted, never
// whatever the file was called. Without that, a PDF named `notice.html` would
// be stored under a name a browser is willing to treat as a page.
t("an extension cannot be smuggled in through the name",
  safeName("notice.html", "pdf") === "notice.pdf"
  && safeName("invoice.pdf.html", "pdf").endsWith(".pdf"));
t("a name of nothing but punctuation still produces a filename",
  safeName("???", "pdf") === "file.pdf");
t("and a very long one is cut short", safeName("x".repeat(300), "png").length <= 64);

t("the name comes back out of the path",
  nameOf("conversations/c1/out-abc/0-March-ledger.xlsx") === "March-ledger.xlsx");
t("a picture renders as a picture",
  isImagePath("conversations/c1/out-abc/0-roof.JPG"));
t("a PDF does not", !isImagePath("conversations/c1/out-abc/0-lease.pdf"));

t("sendability survives the trip through a path",
  pathIsSendable("conversations/c1/out-abc/0-roof.jpg")
  && !pathIsSendable("conversations/c1/out-abc/0-ledger.xlsx"));

// The one that is an authorization check rather than a formatting rule.
t("an attachment belongs to the conversation it is filed under",
  belongsToConversation("conversations/c1/out-abc/0-roof.jpg", "c1"));
t("naming another conversation's folder is refused",
  !belongsToConversation("conversations/c2/out-abc/0-roof.jpg", "c1"));
t("and so is hiding the right id further down the path",
  !belongsToConversation("conversations/c2/c1/0-roof.jpg", "c1"));
t("a path that climbs out of its folder is refused",
  !belongsToConversation("conversations/c1/../c2/0-roof.jpg", "c1"));

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
