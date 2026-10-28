/**
 * What comes out of the printer.
 *
 * The owner printed a purchase agreement and got the app: the brand mark,
 * the avatar and the Command Launch box across the top of page one, the
 * alerts prompt under them -- and then ONE PAGE, with the document cut off
 * mid-sentence and the three that follow it missing entirely. The screen
 * looked right the whole time. `.shell` is `height:100dvh;overflow:hidden`,
 * so the browser printed the window.
 *
 * Nothing already here could see any of that. A picture harness measures
 * the screen; a type checker cannot see a stylesheet; and the papers
 * harness compares the generator's sentences, which were all present and
 * correct in a document nobody could print.
 *
 *     node lib/__fixtures__/print-check.mjs
 *
 * So this prints the real page to a real PDF through Chromium and reads
 * the text back with pdftotext. It needs the app on 3100 and the stand-in
 * database on 54321, the way phone-check does, and skips with a reason
 * when either is missing rather than passing.
 */
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = process.env.PHONE_CHECK_BASE ?? "http://127.0.0.1:3100";
const STUB = "http://127.0.0.1:54321";
/* Oak Ridge holds two homes, so "both documents" is FOUR -- a one-home
   fixture cannot tell a pack that printed from a pack that was clipped
   after the first document, because one page is the right answer for a
   single short agreement. */
const WHO = "/owners/ow1";

const up = async (url) => fetch(url).then((r) => r.status).catch(() => 0);
const appCode = await up(`${BASE}/report`);
if (!appCode) {
  console.log(`skipped: nothing is answering on ${BASE}.`
    + " Build and `next start -p 3100` against the stub, then run this again.");
  process.exit(0);
}
if (appCode >= 500) {
  console.error(` ✗ ${BASE} answers ${appCode}. The server is up and erroring,`
    + " which is not the same as no server -- most likely no database env.");
  process.exit(1);
}
if (!(await up(`${STUB}/rest/v1/staff`))) {
  console.error(` ✗ ${STUB} is not answering, so the signed-in page cannot be`
    + " reached. Start lib/__fixtures__/stub-supabase.mjs.");
  process.exit(1);
}
await fetch(`${STUB}/__reset`).catch(() => null);

let pdftotext = true;
try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); } catch { pdftotext = false; }
if (!pdftotext) {
  console.log("skipped: no pdftotext here (poppler-utils), so the printed"
    + " pages cannot be read back.");
  process.exit(0);
}

let chromium;
for (const where of ["playwright", "playwright-core"]) {
  try {
    const mod = await import(where);
    chromium = mod.chromium ?? mod.default?.chromium;
    if (chromium) break;
  } catch { /* next */ }
}
if (!chromium) { console.log("skipped: no playwright here."); process.exit(0); }

const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
let exe = process.env.CHROMIUM_PATH;
if (!exe || !existsSync(exe)) {
  exe = undefined;
  try {
    for (const d of readdirSync(browsers)) {
      if (!d.startsWith("chromium")) continue;
      for (const dir of ["chrome-linux", "chrome-linux64"]) {
        const c = `${browsers}/${d}/${dir}/chrome`;
        if (existsSync(c)) { exe = c; break; }
      }
      if (exe) break;
    }
  } catch { /* playwright's own guess */ }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sessionFor = (id) => {
  const exp = Math.floor(Date.now() / 1e3) + 3600;
  const email = `${id.slice(0, 1).repeat(4)}@larabeehomesllc.com`;
  const jwt = [b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub: id, aud: "authenticated", role: "authenticated", email,
          exp, iat: exp - 3600, iss: `${STUB}/auth/v1` }), "c3R1Yg"].join(".");
  return "base64-" + Buffer.from(JSON.stringify({
    access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp,
    refresh_token: "stub-refresh",
    user: { id, aud: "authenticated", role: "authenticated", email,
            app_metadata: {}, user_metadata: {},
            created_at: "2026-01-01T00:00:00Z" },
  })).toString("base64url");
};

mkdirSync("/tmp/print", { recursive: true });
const out = "/tmp/print/pack.pdf";
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "sb-127-auth-token",
  value: sessionFor("22222222-2222-2222-2222-222222222222"),
  domain: "127.0.0.1", path: "/" }]);
const p = await ctx.newPage();
await p.goto(`${BASE}${WHO}`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Sale papers" }).click();
await p.waitForTimeout(500);
/* How many documents the screen says it is about to print. Read rather
   than written down, so a fixture with a third home does not quietly
   start comparing four against four. */
const onScreen = await p.$$eval(".paper .doc-sec", (n) => n.length);
await p.pdf({ path: out, format: "Letter", printBackground: true,
              margin: { top: "0.8in", bottom: "0.8in",
                        left: "0.8in", right: "0.8in" } });
await browser.close();

const text = execFileSync("pdftotext", ["-layout", out, "-"], { encoding: "utf8" });
const pages = text.split("\f").filter((x) => x.trim()).length;

const results = [];
const t = (name, run) => {
  let ok = false, why = null;
  try { ok = run() === true; } catch (e) { why = String(e && e.message || e); }
  results.push([name, ok, why]);
};

t(`the screen is drawing more than one document (${onScreen})`,
  () => onScreen > 1);

// ---- nothing but the documents ---------------------------------------

/* The first three are the app's header, which is what printed: they are
   hidden by the shell rule and by nothing else, so they are the ones with
   teeth. The rest are carried by `.noprint` today and so are no-ops --
   kept because the next control added to this panel without `.noprint` is
   exactly how the chrome got onto a contract the first time.

   NOT the brand: "Larabee Homes LLC" is the Seller on every agreement. */
const CHROME = ["Command Launch", "Timesheets", "On the clock",
  "Turn on alerts", "Get alerted",
  "Sale papers", "Homes on this deal", "Print / save as PDF",
  "Investor-friendly", "Template", "ticked"];
for (const word of CHROME) {
  t(`the app's “${word}” is not on the printed page`, () => !text.includes(word));
}

// ---- and all of them -------------------------------------------------

t(`every document reached the printer (${pages} pages for ${onScreen} documents)`,
  () => pages >= onScreen);
t("the first document is there",
  () => /PURCHASE\s+AGREEMENT/.test(text));
t("the last one is too, which is the half that was being cut off",
  () => (text.match(/IN WITNESS WHEREOF/g) ?? []).length === onScreen);
t("and so is the sentence the clipping stopped at",
  () => /Insurance & Taxes|Insurance &amp; Taxes/.test(text));
// Each document begins its own page, not halfway down the one before.
t("each document starts on a fresh page", () => {
  const starts = text.split("\f")
    .filter((x) => /PURCHASE\s+AGREEMENT|LAND LEASE AGREEMENT/.test(
      x.split("\n").slice(0, 6).join("\n")));
  return starts.length === onScreen;
});

let bad = 0;
for (const [name, ok, why] of results) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
console.log(`wrote ${out}`);
if (bad) { console.error(` ✗ ${bad} of ${results.length}`); process.exit(1); }
console.log("what prints is the documents, and all of them");
