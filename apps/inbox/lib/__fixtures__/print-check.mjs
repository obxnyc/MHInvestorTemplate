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
import { existsSync, readdirSync, mkdirSync, statSync } from "node:fs";
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
/* WHAT THE PAGE SAYS WENT WRONG. The PDF is built in the tab, and when
   pdfkit could not find its font metrics it threw inside its own worker:
   nothing on screen, no file, no error -- a button that did nothing. */
const noise = [];
p.on("pageerror", (e) => noise.push(String(e)));
p.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
await p.goto(`${BASE}${WHO}`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Sale papers" }).click();
await p.waitForTimeout(500);
/* How many documents the screen says it is about to print. Read rather
   than written down, so a fixture with a third home does not quietly
   start comparing four against four. */
const onScreen = await p.$$eval(".paper .doc-sec", (n) => n.length);
/* SIGNING, FOR REAL, IN A BROWSER.
   The typed signature is a name drawn into a canvas in a webfont, and the
   whole of what can go wrong is invisible from Node: a canvas asked to
   draw in a family the browser has not fetched yet does not fail, it
   quietly draws in the default serif, and a contract goes out signed in
   Times New Roman. So the faces are compared against the fallback, and
   the pad is driven the way a person drives it. */
const typed = { steps: [] };
try {
  /* The same name in a cursive face and in the browser's serif. If the
     face did not load these are the same picture, which is exactly the
     failure that leaves no trace. */
  /* Compared against a family that DOES NOT EXIST, not against "serif".
     A font that loaded but has none of these letters in it -- which is
     what a Vietnamese subset is, and what was shipped here first -- falls
     back glyph by glyph to the browser's default. That default is not
     "serif" on every machine, but it IS exactly what a bogus family name
     produces, so the two bitmaps are identical when the face is not
     really being used. Comparing to "serif" let the broken subset pass. */
  typed.faces = await p.evaluate(async () => {
    const WORDS = "Benjamin Cade Larabee";
    const draw = async (family) => {
      const spec = `60px "${family}"`;
      try { await document.fonts.load(spec, WORDS); } catch { /* bogus one */ }
      const c = document.createElement("canvas");
      c.width = 760; c.height = 110;
      const g = c.getContext("2d");
      g.font = spec; g.fillStyle = "#000"; g.textBaseline = "alphabetic";
      g.fillText(WORDS, 4, 80);
      return { png: c.toDataURL("image/png"), width: g.measureText(WORDS).width };
    };
    const out = {};
    for (const f of ["SignFlowing", "SignFormal", "SignPenned",
                     "NoSuchFamilyAnywhere"]) {
      out[f] = await draw(f);
      /* AND EACH LETTER ON ITS OWN. A font file that loaded but is
         missing some of these letters falls back GLYPH BY GLYPH, so the
         whole name comes out part cursive and part default -- which
         differs from the full fallback and sails past a check on the
         whole string. It did: the Vietnamese subset of one of these was
         shipped and looked like a serif on screen while the harness
         said it was fine. */
      out[f].letters = {};
      for (const ch of ["B", "e", "L", "C", "d"]) {
        const c = document.createElement("canvas");
        c.width = 90; c.height = 110;
        const g = c.getContext("2d");
        g.font = `60px "${f}"`;
        g.fillStyle = "#000"; g.textBaseline = "alphabetic";
        g.fillText(ch, 4, 80);
        out[f].letters[ch] = c.toDataURL("image/png");
      }
    }
    return out;
  });

  await p.getByRole("button", { name: "Type it" }).click();
  await p.locator(".signname input").fill("Benjamin Cade Larabee");
  await p.locator(".signface").nth(1).click();
  await p.getByRole("button", { name: "Keep this signature" }).click();
  await p.waitForTimeout(1200);
  typed.kept = await p.locator(".signtiny").count();
  typed.ticked = await p.locator('.signrow input[type="checkbox"]').first().isChecked();
  typed.inDoc = await p.locator(".paper img.sigink").count();
  typed.rules = await p.locator(".paper .sig-block .line").count();
  /* Choose, untick one, and the document it names loses its mark. */
  await p.getByRole("button", { name: "Choose" }).click();
  await p.locator(".signpick input").first().uncheck();
  await p.waitForTimeout(400);
  typed.afterUntick = await p.locator(".paper img.sigink").count();
} catch (e) {
  typed.failed = String(e && e.message || e).split("\n")[0];
}

/* THE TWO BUTTONS THAT HAND OVER A FILE, pressed. Both are built in the
   browser, so nothing short of a browser can tell whether they work --
   the Node harnesses build the same definitions and would have been
   perfectly happy with a page that downloaded nothing at all. */
const got = {};
for (const [label, ext] of [["Download PDF", ".pdf"], ["Download Word", ".docx"]]) {
  try {
    const wait = p.waitForEvent("download", { timeout: 90000 });
    await p.getByRole("button", { name: label }).click();
    const file = await wait;
    const where = `/tmp/print/${file.suggestedFilename()}`;
    await file.saveAs(where);
    got[label] = { name: file.suggestedFilename(), ext, where };
  } catch (e) {
    got[label] = { failed: String(e && e.message || e).split("\n")[0] };
  }
}
const onScreenErr = await p.$$eval(".paperacts .err", (n) => n.map((x) => x.textContent));

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

// ---- signing it here rather than in DocuSign --------------------------

t("the signature pad could be driven",
  () => { if (typed.failed) throw new Error(typed.failed); return true; });
for (const face of ["SignFlowing", "SignFormal", "SignPenned"]) {
  t(`the ${face} hand really drew the name`, () => {
    const f = typed.faces?.[face], none = typed.faces?.NoSuchFamilyAnywhere;
    if (!f || !none) throw new Error("the faces were never measured");
    if (f.png === none.png) {
      throw new Error("drawn exactly as an unknown family is drawn, so the"
        + " face did not load or has none of these letters in it");
    }
    if (Math.abs(f.width - none.width) < 1) {
      throw new Error(`the name is ${f.width.toFixed(1)}px wide in this face`
        + " and the same in no face at all");
    }
    const missing = Object.keys(f.letters)
      .filter((ch) => f.letters[ch] === none.letters[ch]);
    if (missing.length) {
      throw new Error(`the face has no ${missing.join(", ")} in it --`
        + " those letters fall back to the browser's own font, so a name"
        + " comes out part cursive and part not. Wrong subset?");
    }
    return true;
  });
}
t("the three hands are three different hands",
  () => typed.faces
    && new Set(["SignFlowing", "SignFormal", "SignPenned"]
      .map((f) => typed.faces[f].png)).size === 3);
t("a typed name is kept as a signature", () => typed.kept === 1);
t("and signing is switched on once there is one", () => typed.ticked === true);
t(`it lands on our line of every document (${typed.inDoc})`,
  () => typed.inDoc === onScreen);
t("and no line is ruled under a signature",
  () => typed.rules === onScreen);
t("unticking one document takes the mark off that one only",
  () => typed.afterUntick === onScreen - 1);

// ---- the files the owner actually leaves with -------------------------

for (const [label, ext] of [["Download PDF", ".pdf"], ["Download Word", ".docx"]]) {
  const r = got[label];
  t(`${label} hands over a file`,
    () => { if (r.failed) throw new Error(r.failed); return !r.failed; });
  t(`and it is named for the documents, ending ${ext}`,
    () => !r.failed && r.name.endsWith(ext)
       && /Purchase Agreement and Park Land Lease/.test(r.name));
  t(`and it is not empty`,
    () => !r.failed && statSync(r.where).size > 5000);
}
t("nothing on the page reported a failure",
  () => onScreenErr.length === 0);
t("and the tab threw nothing",
  () => { if (noise.length) throw new Error(noise.join(" | ")); return true; });

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
