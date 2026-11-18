/**
 * What a stranger sees when they ask what we have to rent.
 *
 *   node lib/__fixtures__/stub-supabase.mjs &
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x \
 *     npx next start -p 3100 &
 *   node lib/__fixtures__/homes-picture.mjs
 *
 * This page is the whole top of the leasing funnel, and three of the four
 * things that have gone wrong with it were invisible to a type checker and
 * to any test of what the data says:
 *
 *   IT WAS BEHIND THE SIGN-IN WALL. `/homes` was not in the public list in
 *   proxy.ts, so the one page a stranger is sent to answered 307 to /login.
 *   Caught by opening it, not by reading it.
 *
 *   IT LISTED THE WRONG HOMES. `is_vacant` is Rent Manager's "no lease on
 *   it"; `listing` is what the office is advertising. On 17 November those
 *   were one unit and six, with no overlap.
 *
 *   THE PILL SAT ON THE NAME. "Coming up" is positioned, so it is out of
 *   flow, and "1140 Northside Road Mobile Home Community" wraps to two
 *   full-width lines underneath it.
 *
 * Both themes, both widths, because the stylesheet redefines every colour
 * under prefers-color-scheme: dark and a page that is right by day can be
 * white on white at night.
 */
import { createRequire } from "node:module";

/* Node resolves a bare ESM specifier against node_modules up the tree and
   never against the global prefix, so `await import("playwright")` throws in
   a cloud session where it is installed globally -- and the harness then
   reports "no playwright here" and exits 0, which reads exactly like a pass.
   `require` does search those places. Four harnesses skipped silently for
   months before anybody read the skip instead of the exit code. */
let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { /* below */ }
if (!chromium) {
  console.error("playwright is not reachable from here, so this checked"
    + " NOTHING. That is a failure, not a skip.");
  process.exit(1);
}

const BASE = process.env.HOMES_CHECK_BASE ?? "http://127.0.0.1:3100";

const probe = await fetch(`${BASE}/homes`, { redirect: "manual" })
  .then((r) => r.status).catch(() => null);
if (probe === null) {
  console.log(`skipped: nothing serving at ${BASE}.`);
  process.exit(0);
}
/* A redirect is the failure this page had, so it is named rather than
   followed. Following it would measure the sign-in page and pass. */
if (probe >= 300 && probe < 400) {
  console.error(` ✗ ${BASE}/homes answers ${probe} — it is behind the sign-in`
    + " wall. Add it to PUBLIC in proxy.ts.");
  process.exit(1);
}
if (probe >= 400) {
  console.error(` ✗ ${BASE}/homes answers ${probe}.`);
  process.exit(1);
}

const findings = [];
const browser = await chromium.launch();

for (const [name, width, height, colorScheme] of [
  ["phone-light", 390, 844, "light"],
  ["phone-dark", 390, 844, "dark"],
  ["desktop-light", 1280, 900, "light"],
  ["desktop-dark", 1280, 900, "dark"],
]) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme });
  await page.goto(`${BASE}/homes`, { waitUntil: "networkidle" });

  const bad = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;

    if (document.documentElement.scrollWidth > vw + 1) out.push("the page scrolls sideways");

    for (const el of document.querySelectorAll(".listings h1, .listings .lede, .homecard, .homecard *")) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.left < -1 || r.right > vw + 1) {
        out.push(`off the side: ${el.className || el.tagName}`);
      }
    }

    /* The pill is out of flow, so overlap is the only way to see it.
     *
     * MEASURED ON THE WORDS, NOT ON THE BOX. The fix for this reserves room
     * with `padding-right`, which shrinks the text and leaves the heading's
     * own rectangle running the full width of the card -- so a box-to-box
     * test reports an overlap on a card where the words are plainly clear,
     * on every width, after the bug is fixed. A check that cries wolf is
     * worse than no check, because the real finding goes out with the noise.
     *
     * A Range over the text node gives what is actually painted. */
    for (const card of document.querySelectorAll(".homecard")) {
      const pill = card.querySelector(".soon");
      const title = card.querySelector("h2");
      if (!pill || !title) continue;
      const range = document.createRange();
      range.selectNodeContents(title);
      const p = pill.getBoundingClientRect();
      const hit = [...range.getClientRects()].some((t) =>
        p.left < t.right && p.right > t.left && p.top < t.bottom && p.bottom > t.top);
      if (hit) out.push(`"Coming up" sits on top of "${title.textContent.trim()}"`);
    }

    /* A tap target somebody has to aim at is a target they will miss. */
    for (const b of document.querySelectorAll(".homecard .btn")) {
      const r = b.getBoundingClientRect();
      if (r.height < 36) out.push(`apply button only ${Math.round(r.height)}px tall`);
    }

    // Words the same colour as the thing behind them, compositing the layers
    // the way the browser paints them.
    const lum = (c) => {
      const n = (c.match(/[\d.]+/g) ?? []).map(Number);
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(n[0] ?? 255) + 0.7152 * f(n[1] ?? 255) + 0.0722 * f(n[2] ?? 255);
    };
    const ground = (el) => {
      let n = el;
      while (n) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !/rgba?\([^)]*,\s*0\)$/.test(bg)) return bg;
        n = n.parentElement;
      }
      return "rgb(255,255,255)";
    };
    for (const el of document.querySelectorAll(
      ".listings h1, .listings .lede, .homecard h2, .homecard p, .homecard .btn, .homecard .soon")) {
      if (!el.textContent.trim()) continue;
      const a = lum(getComputedStyle(el).color), b = lum(ground(el));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 1.6) out.push(`these words are not there: ${el.className || el.tagName} (${ratio.toFixed(2)}:1)`);
    }
    return out;
  });

  /* The office's list, not Rent Manager's. The stand-in carries a unit that
     is vacant and NOT advertised for exactly this -- with every unit
     advertised, "shows what we are renting" and "shows everything" are the
     same page. */
  const text = await page.textContent("body");
  if (text.includes("9 Nowhere")) {
    findings.push(`${name}: a home nobody is advertising is on the page`);
  }
  if (!text.includes("Coming up")) {
    findings.push(`${name}: an upcoming home is not marked as one`);
  }

  bad.forEach((b) => findings.push(`${name}: ${b}`));
  await page.close();
}

await browser.close();
findings.forEach((f) => console.log(`  ✗ ${f}`));
console.log(findings.length
  ? `\n${findings.length} findings`
  : "\nnothing obviously wrong (4 renders)");
process.exit(findings.length ? 1 : 0);
