/** The investor signing, in a real browser, on the real page.
 *
 *  Run:  node lib/__fixtures__/sign-walk-check.mjs
 *  Needs the stand-in database and the app:
 *      node lib/__fixtures__/stub-supabase.mjs &
 *      npx next start -p 3100
 *
 *  The owner's words for the first version were "it only allows you to sign
 *  at the bottom and one blanket signature". The fix walks them to each
 *  place instead -- and NOTHING a type checker or a picture can see is
 *  changed by that. The page looks the same at rest. What changed is what
 *  happens when a hand touches it, which is why this drives it.
 *
 *  It loads the page the investor gets, adopts a signature the way they
 *  would, puts it in each place, and asks the questions the owner asked:
 *  does it start at the first signature rather than the bottom, is there a
 *  choice of typed or drawn, does it visit each one, can it be finished
 *  early, and does the date go in as typed rather than as today.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.PHONE_CHECK_BASE ?? "http://127.0.0.1:3100";
const STUB = process.env.STUB_BASE ?? "http://127.0.0.1:54321";
const TOKEN = "walkcheck";

let chromium;
for (const where of ["playwright", "playwright-core"]) {
  try {
    const m = await import(where);
    chromium = m.chromium ?? m.default?.chromium;
    if (chromium) break;
  } catch { /* next */ }
}
/* A global install is invisible to `import`; see card-picture.mjs. */
if (!chromium) {
  try {
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    for (const where of ["playwright", "playwright-core"]) {
      try {
        const m = req(where);
        chromium = m.chromium ?? m.default?.chromium;
        if (chromium) break;
      } catch { /* next */ }
    }
  } catch { /* neither */ }
}
if (!chromium) { console.log("skipped: no playwright here."); process.exit(0); }

/* A REFUSED CONNECTION IS A SKIP; ANYTHING ELSE IS A FAILURE. A server that
   is up and answering 500 to every request is not "no server", and reading
   it as one is how a harness reports success having looked at nothing. */
let probe;
try {
  probe = await fetch(`${BASE}/sign/${TOKEN}`, { redirect: "manual" });
} catch {
  console.log(`skipped: nothing is serving ${BASE}.`
    + " Start the stand-in and `npx next start -p 3100`.");
  process.exit(0);
}
try {
  const r = await fetch(`${STUB}/rest/v1/staff?select=id`);
  if (!r.ok) throw new Error(String(r.status));
} catch {
  console.log(`skipped: the stand-in database is not answering on ${STUB}.`);
  process.exit(0);
}
/* A SIGNED REQUEST STAYS SIGNED. This harness ends by actually signing, so
   the second run meets a row that is already done, the page renders the
   signed view, and the failures that follow are about the leftovers rather
   than about anything that changed. The stand-in reseeds on demand. */
await fetch(`${STUB}/__reset`).catch(() => null);

if (probe.status >= 500) {
  console.error(`${BASE}/sign/${TOKEN} answers ${probe.status}. The server is`
    + " up and failing, which is a result and not an absence.");
  process.exit(1);
}

const checks = [];
const t = (name, fn) => {
  try { checks.push([name, fn() === true]); }
  catch (e) {
    checks.push([name, false,
      String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 200)]);
  }
};

/* THE BROWSER IS ALREADY HERE, under a version that moves. Playwright's
   own guess is a path built from the version IT was installed at, so a
   container holding chromium-1243 while the package wants chromium-1140
   says "Executable doesn't exist" and reads like no browser at all. Both
   folder spellings, because chromium's archive renamed chrome-linux to
   chrome-linux64. */
const where = (() => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const plain = join(root, "chromium");
  if (existsSync(plain)) return plain;
  try {
    for (const d of readdirSync(root)) {
      if (!d.startsWith("chromium-")) continue;
      for (const dir of ["chrome-linux64", "chrome-linux"]) {
        const c = join(root, d, dir, "chrome");
        if (existsSync(c)) return c;
      }
    }
  } catch { /* playwright's own guess, then */ }
  return undefined;
})();

const browser = await chromium.launch({
  args: ["--no-sandbox"], ...(where ? { executablePath: where } : {}) });
let sent = null;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  /* What the page sends when it finishes, caught on the way out: the date
     is the whole point of one of these checks and it is invisible on
     screen. */
  await page.route(`**/api/sign/${TOKEN}`, async (route) => {
    if (route.request().method() === "POST") {
      try { sent = JSON.parse(route.request().postData() ?? "{}"); }
      catch { sent = { unparseable: true }; }
    }
    await route.continue();
  });

  await page.goto(`${BASE}/sign/${TOKEN}`, { waitUntil: "networkidle" });

  /* THE PAGE ITSELF LOADED, not an error page wearing its shape. A Next
     error page has nothing off screen and nothing too small to tap, so a
     harness that does not ask this measures the error page happily. */
  const heading = (await page.textContent("h1").catch(() => "")) ?? "";
  t("the investor's page is what loaded",
    () => /Purchase Agreement/i.test(heading));

  const slots = page.locator(".paper span.signslot");
  const howMany = await slots.count();
  t("every signature slot in the pack is on the page", () => howMany === 3);

  /* Nothing is signable before a signature has been chosen. Each of these
     is a value read off the live page, not a thunk that returns true --
     a check that cannot fail is the thing this file exists to avoid. */
  const finish = page.getByRole("button", { name: /Sign these documents/i });
  const offAtStart = await finish.isDisabled();
  t("the finish button is off before anything is signed",
    () => offAtStart === true);

  /* THE FIRST THING ASKED FOR IS THE SIGNATURE, not a scroll to the bottom. */
  const startBtn = page.getByRole("button", { name: /^Sign$/ });
  const haveStart = await startBtn.count();
  t("there is a Sign button before any slot is filled", () => haveStart === 1);
  await startBtn.click();

  /* Typed or drawn, which is what the owner asked for in those words. */
  const typed = page.getByRole("button", { name: /^Type it$/i });
  const drawn = page.getByRole("button", { name: /^Draw it$/i });
  const bothOffered = (await typed.count()) > 0 && (await drawn.count()) > 0;
  t("it offers a typed signature and a drawn one", () => bothOffered);

  /* Adopt a typed one, the way somebody on a phone would. */
  await typed.click();
  await page.getByRole("button", { name: /Keep this signature/i })
    .click({ timeout: 15_000 });
  await page.waitForTimeout(800);

  const adopted = await page.locator("img.walkink").count();
  t("the adopted signature is shown in the bar", () => adopted === 1);

  /* IT WALKS, AND IT DOES NOT FILL EVERYTHING AT ONCE. After adopting, the
     slots must still be waiting -- the whole complaint was that one
     signature filled all of them with nobody taken anywhere. */
  const inkedAfterAdopt = await page.locator(".paper .signslot.inked").count();
  t("adopting a signature does not fill every slot by itself",
    () => inkedAfterAdopt === 0);

  const aimed = await page.locator(".paper .signslot.here").count();
  t("the first place is marked as the one being asked for", () => aimed === 1);

  /* Put it in each one, and watch the count climb. */
  const counts = [];
  let partWayOff = null;
  for (let i = 0; i < howMany; i++) {
    await page.locator(".paper span.signslot:not(.inked)").first()
      .click({ timeout: 10_000 });
    await page.waitForTimeout(250);
    counts.push(await page.locator(".paper .signslot.inked").count());
    /* PART WAY THROUGH, with everything else filled in: the only thing
       still missing is the rest of the signatures. The server fills every
       slot from the one signature, so a screen that let somebody stop at
       one of three would be promising a document that cannot exist. */
    if (i === 0) {
      await page.getByLabel(/Your full name/i).fill("Oak Ridge Holdings LLC");
      await page.locator(".papertickone input[type=checkbox]").check();
      await page.waitForTimeout(200);
      partWayOff = await finish.isDisabled();
    }
  }
  t("each place takes the signature, one at a time",
    () => counts.join(",") === "1,2,3");
  t("it cannot be finished with places still waiting",
    () => partWayOff === true);

  await page.getByLabel(/Your full name/i).fill("Oak Ridge Holdings LLC");
  await page.getByLabel(/Date of signature/i).fill("2026-10-12");
  await page.locator(".papertickone input[type=checkbox]").check();
  await page.waitForTimeout(200);
  const readyNow = await finish.isEnabled();
  t("the finish button is on once all of it is done", () => readyNow === true);

  await finish.click();
  await page.waitForTimeout(2500);

  /* THE DATE GOES AS TYPED. This is the one the owner asked for and the one
     nothing on screen would show: the server used to stamp its own today,
     and a pack dated the day the server felt like is not the deal. */
  t("the date the signer typed is what gets sent",
    () => sent?.on === "2026-10-12");
  t("and the signature and intent go with it",
    () => typeof sent?.png === "string"
      && sent.png.startsWith("data:image/png;base64,")
      && sent.agreed === true);
} catch (e) {
  /* A HARNESS THAT DIES READS AS A HARNESS THAT IS BROKEN. Everything above
     runs outside a thunk, so a timeout here would take the run down with a
     stack trace instead of saying which step stopped -- and a picture of
     the page at that moment is worth more than the trace. */
  const why = String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 300);
  checks.push(["the walkthrough runs to the end", false, why]);
  try {
    const pages = browser.contexts().flatMap((c) => c.pages());
    if (pages[0]) {
      await pages[0].screenshot({ path: "/tmp/sign-walk-stuck.png",
                                  fullPage: true });
      console.log("  (where it stopped: /tmp/sign-walk-stuck.png)");
    }
  } catch { /* the picture is a bonus */ }
} finally {
  await browser.close();
}

let bad = 0;
for (const [name, ok, why] of checks) {
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
console.log(bad
  ? `\n${bad} of ${checks.length} failed.`
  : "they are walked to every signature, and the date is theirs");
process.exit(bad ? 1 : 0);
