/** The REAL pages, in a real browser, at phone size.
 *
 *  Run:  node lib/__fixtures__/phone-check.mjs
 *
 *  Every other picture harness here renders a FIXTURE -- markup written by
 *  hand beside the stylesheet. That catches a lot and it has one blind spot
 *  that matters: the fixture is my idea of the page, and the day its nav had
 *  six of the seven real destinations it stopped reproducing the bug it
 *  existed for.
 *
 *  This one loads the pages themselves, out of the actual build. It can only
 *  see the PUBLIC ones -- a tenant reporting a repair, an applicant, a
 *  contractor, the sign-in screen -- because everything else needs a session
 *  and there are no credentials on this machine. Those four are also the ones
 *  read on a phone by somebody who does not work here, which is the worst
 *  place to be wrong.
 *
 *  Start the server first:  npx next start -p 3100
 */
import { existsSync, readdirSync, mkdirSync } from "node:fs";

const BASE = process.env.PHONE_CHECK_BASE ?? "http://127.0.0.1:3100";
const PAGES = ["/report", "/login", "/apply", "/criteria", "/trades/apply"];
// A phone, a small phone, and a phone held sideways.
const SIZES = [[390, 844], [320, 568], [844, 390]];

let chromium;
for (const where of ["playwright", "/tmp/node_modules/playwright/index.js",
                     "playwright-core"]) {
  try {
    const m = await import(where);
    chromium = m.chromium ?? m.default?.chromium;
    if (chromium) break;
  } catch { /* next */ }
}
if (!chromium) {
  console.log("skipped: no playwright here.");
  process.exit(0);
}

const up = await fetch(`${BASE}/login`).then((r) => r.ok).catch(() => false);
if (!up) {
  console.log(`skipped: nothing serving at ${BASE}.`
    + " Build, then `npx next start -p 3100`, then run this.");
  process.exit(0);
}

const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
let exe = process.env.CHROMIUM_PATH;
if (!exe || !existsSync(exe)) {
  exe = readdirSync(root).filter((d) => d.startsWith("chromium"))
    .map((d) => `${root}/${d}/chrome-linux/chrome`).find(existsSync);
}

mkdirSync("/tmp/phone", { recursive: true });
const browser = await chromium.launch({ executablePath: exe });
const wrong = [];

for (const path of PAGES) {
  for (const [width, height] of SIZES) {
    const p = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
    await p.waitForTimeout(250);

    const said = await p.evaluate(() => {
      const gone = [], thin = [], small = [], over = [];
      const scrolls = (el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ov = getComputedStyle(a).overflowX;
          if (ov === "auto" || ov === "scroll") return true;
        }
        return false;
      };
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const st = getComputedStyle(el);
        if (st.visibility === "hidden" || st.opacity === "0") continue;
        const name = `${el.tagName.toLowerCase()}.${el.className || "-"}`.slice(0, 48);
        if (!scrolls(el) && (r.left < -1 || r.right > window.innerWidth + 1)) {
          gone.push(`${name} ${Math.round(r.left)}..${Math.round(r.right)}`);
        }
        const tag = el.tagName.toLowerCase();
        // A field nobody can type into, and a target nobody can hit. 30px is
        // under Apple's 44 and over a fingertip's worth of slop.
        if (/^(input|select|textarea)$/.test(tag)) {
          const tick = el.type === "checkbox" || el.type === "radio";
          if (!tick && r.width < 56) thin.push(`${name} ${Math.round(r.width)}px`);
          if (tick && r.width > 40) over.push(`${name} ${Math.round(r.width)}px`);
        }
        if (/^(button|a)$/.test(tag) && el.textContent.trim()
            && (r.height < 30 || r.width < 30)) {
          small.push(`${name} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return {
        gone: [...new Set(gone)], thin: [...new Set(thin)],
        small: [...new Set(small)], over: [...new Set(over)],
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
        // A page that needs pinching is a page somebody gives up on.
        zoomable: !/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1/.test(
          document.querySelector('meta[name="viewport"]')?.content ?? ""),
      };
    });

    const tag = `${path.replace(/\//g, "_") || "_root"}-${width}x${height}`;
    await p.screenshot({ path: `/tmp/phone/${tag}.png`, fullPage: true });
    await p.close();

    const at = `${path} at ${width}x${height}`;
    if (said.gone.length) wrong.push(`${at}: off the screen -- ${said.gone.join(", ")}`);
    if (said.sideways) wrong.push(`${at}: the page scrolls sideways`);
    if (said.thin.length) wrong.push(`${at}: too narrow to type into -- ${said.thin.join(", ")}`);
    if (said.over.length) wrong.push(`${at}: a tick box stretched -- ${said.over.join(", ")}`);
    if (said.small.length) wrong.push(`${at}: too small to tap -- ${said.small.join(", ")}`);
    if (!said.zoomable) wrong.push(`${at}: pinch-zoom is switched off`);
  }
}

await browser.close();
console.log(`looked at ${PAGES.length} pages at ${SIZES.length} sizes; `
  + `screenshots in /tmp/phone`);
if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
