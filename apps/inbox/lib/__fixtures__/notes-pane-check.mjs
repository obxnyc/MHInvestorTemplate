/**
 * Can you read a note while you are typing a reply?
 *
 *     node lib/__fixtures__/notes-pane-check.mjs
 *
 * "Didn't we talk about not having notes as a running list in the messages
 * portion but something easily referenceable? It should be in the right hand
 * pane ... you should be able to reference the notes easily while typing back
 * to the tenant or vendor."
 *
 * He asked twice. What existed was a dropdown off the thread header, and the
 * reason it did not answer him is not visible in any test this repo had: the
 * notes were all there, correctly sorted, with the right authors on them. The
 * fault was that they could not be ON SCREEN AT THE SAME TIME as the box you
 * type in. That is a question about two rectangles, so it needs a browser.
 *
 * It writes /tmp/notes-<width>-<theme>.png either way. Look at them.
 *
 * WHAT IT ASKS, and each is a question only that check can answer:
 *
 *  - At 1280 the rail and the text box are both in the viewport AND the rail
 *    is beside the messages, not under them. Either one alone passes on a
 *    layout that is wrong: a rail stacked under the messages is still "both
 *    visible" on a tall screen, and a rail beside the messages that has been
 *    pushed below the fold is still "beside".
 *  - At 390 the band sits between the messages and the box, and OPENING IT
 *    leaves the box on screen. The closed case passes on a band that covers
 *    the composer the moment it is used, which is the dropdown's own bug in
 *    a new place.
 *  - A note's text wraps. `.notepeek` is deliberately one clipped line, and a
 *    body that inherited that would show every note as its first forty
 *    characters -- present, sorted, and useless.
 *  - Both themes, because this ground is `--sunk` and this ink is `--ink-2`,
 *    and six times now a colour in this stylesheet has been invisible at
 *    night while passing every daytime check.
 *
 * EVERY CHECK HERE WAS BROKEN IN TURN AND SEEN TO FAIL. Three of the first
 * faults tried were no-ops, and what they taught is worth more than the
 * checks:
 *
 *  - Taking `max-height` off the band does NOT push the composer off a phone,
 *    and neither does taking the height constraint off the row. `.threadbody`
 *    is a flex column whose `.msgs` is `flex:1 1 0`, so the messages give way
 *    and the composer physically cannot be pushed out of the column. The 45vh
 *    is a taste, not a correctness rule, and anybody testing it against those
 *    faults will conclude the check is asleep when it is not.
 *  - The fault "phone: opening the notes leaves the box on screen" is actually
 *    for is the rail LEAVING THE FLOW -- `position:absolute` on it, which is
 *    the old `.notesheet` returning. That is also the realistic regression:
 *    the thing this change removes is exactly what somebody would re-add.
 *  - A `flex:0 0 17rem` rail does not push a 390px page sideways, because in
 *    a column that basis is a height. It takes `min-width:30rem` to make the
 *    overflow the sideways check is for.
 *
 * And two source rules, because the layout cannot see them:
 *  - the timeline is built from the messages alone, so notes are not a
 *    running list in the scroll; and
 *  - the composer is OUTSIDE the row holding the rail, which is the single
 *    fact that puts a note and a half-written reply on screen together.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../../app/globals.css"), "utf8");
const pane = readFileSync(join(here, "../../components/ThreadPane.tsx"), "utf8");
const rail = readFileSync(join(here, "../../components/NotesRail.tsx"), "utf8");

const checks = [];
const t = (name, fn, why) => checks.push([name, fn, why]);

/* ------------------------------------------------------- the source rules */

/** Comments say anything; this repo has been caught twice by a guard that
 *  matched its own explanation. Strip them and read what runs. */
const running = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const paneCode = running(pane);

t("the timeline is built from the messages alone", () => {
  const m = paneCode.match(/const timeline\s*=([\s\S]*?);\n/);
  if (!m) return false;
  return !/data\.notes/.test(m[1]);
}, "THE ASK ITSELF: notes interleaved into the scroll are the running list he "
 + "objected to. Anchored on the timeline's own initialiser rather than on a "
 + "search for the word `note`, because the word appears all over this file");

/**
 * The contents of the <div> that starts at `marker`, up to ITS OWN closing
 * tag.
 *
 * A lazy match to the next `</div>` stops at the first nested one -- here the
 * messages list, which closes at the same indentation -- so the rail read as
 * being outside the row it is plainly inside. That is the anchor-runs-past-
 * its-own-block fault this repo already has a name for, in the other
 * direction: it ends too early rather than too late. Both are fixed the same
 * way, by cutting the block out properly before matching in it.
 */
const divBlock = (src, marker) => {
  const start = src.indexOf(marker);
  if (start < 0) return null;
  let depth = 0, i = start;
  const tag = /<\/?div\b/g;
  tag.lastIndex = start;
  for (let m; (m = tag.exec(src)); ) {
    depth += m[0] === "<div" ? 1 : -1;
    i = m.index;
    if (depth === 0) return src.slice(start, i);
  }
  return null;
};

t("the rail is inside the row and the composer is outside it", () => {
  const inside = divBlock(paneCode, '<div className="threadbody">');
  if (!inside) return false;
  return /<NotesRail\b/.test(inside) && !/<Composer\b/.test(inside)
      && /<Composer\b/.test(paneCode);
}, "the one fact that makes this work. A composer inside the row sits BESIDE "
 + "the notes and the messages instead of under them, and on a phone it ends "
 + "up under the band -- which is where it cannot be reached");

t("the band's preview is the notes, not the logged actions", () => {
  const m = running(rail).match(/const peek\s*=([^;]*);/);
  return Boolean(m) && /newestFirst\(written\)/.test(m[1]);
}, "the one line a phone shows must not be \"Moved from Maintenance to "
 + "Leasing\". A fixture cannot see this: both are notes rows and both render");

/* ----------------------------------------------------------- the pictures */

let chromium;
for (const where of ["playwright", "/tmp/node_modules/playwright/index.js",
                     "playwright-core"]) {
  try {
    const m = await import(where);
    chromium = m.chromium ?? m.default?.chromium;
    if (chromium) break;
  } catch { /* next */ }
}
/* A GLOBAL INSTALL IS INVISIBLE TO `import` -- node resolves a bare ESM
   specifier against node_modules up the tree and never against the global
   prefix. Four harnesses here skipped in every cloud session for that reason,
   and a skip reads exactly like a pass. `createRequire` does search those
   places. */
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

/** A long note, so "does it wrap" has something to answer with. */
const NOTE = "The owner will not pay for a new heater on this lot, so do not "
  + "promise one — offer the loaner and tell them the part is ordered.";

/* The thread as ThreadPane builds it: header, then the row holding the
   messages and the rail, then the composer under the row. */
const page = (dark) => `<!doctype html><html${dark ? ' data-theme="dark"' : ''}>
<head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style>
<style>html,body{margin:0;height:100%}</style></head>
<body><div class="split split-open" style="height:100vh">
  <!-- THE LIST COLUMN HAS TO BE HERE.
       Without it the thread is the grid's FIRST child and lands in the
       column sized for the list -- 27rem at this width. The first version of
       this fixture did that: every check passed, on a thread pane 432px wide
       with the messages crushed to one word a line, which is a shape nobody
       will ever see. A fixture that is not the real shape hides the bugs
       that matter, and a rail is exactly the kind of thing that is fine in a
       pane of one width and ruinous in another. Its contents do not matter
       -- the columns are defined on .split -- but its presence does. -->
  <div class="listcol"
       style="border-right:1px solid var(--hair);background:var(--card)"></div>
<div class="chatcol" style="min-height:0">
  <div class="chead"><span class="cwho"><span class="nm">Tiffany Jernigan</span>
    <span class="sub"><span class="dim">Tenant</span>
    <span class="dim">1140 Northside · Lot 46</span></span></span></div>
  <div class="threadbody">
    <div class="msgs">
      ${Array.from({ length: 14 }, (_, i) => `
      <div class="mrow"><div class="${i % 3 ? "in" : "out"} last">
        <div class="bwrap"><div class="bub">Message number ${i + 1} about the
        water heater in the back bedroom.</div></div>
        <span class="delivered">2:1${i % 10} pm</span></div></div>`).join("")}
    </div>
    <aside class="noterail" aria-label="Notes on this conversation">
      <span class="notetitle">Notes<span class="notecount">2</span></span>
      <button type="button" class="noteband" aria-expanded="false">
        <span class="nbt">Notes<span class="notecount">2</span></span>
        <span class="notepeek">${NOTE}</span>
        <span class="nbc">&#8963;</span>
      </button>
      <div class="notesbody">
        <ul class="noteslist">
          <li><span class="nwho">Sam Larabee<span class="nwhen">Today · 2:14 pm</span></span>
            <p>${NOTE}</p></li>
          <li><span class="nwho">Alex Prieto<span class="nwhen">Monday · 9:02 am</span></span>
            <p>Rent is current to the 1st.</p></li>
        </ul>
      </div>
    </aside>
  </div>
  <form class="composer">
    <div class="modes"><button type="button" class="on">Text</button>
      <button type="button">Note</button></div>
    <div class="inputrow"><textarea rows="1" placeholder="Message"></textarea>
      <button type="submit" class="sendbtn">&uarr;</button></div>
  </form>
</div></div></body></html>`;

/** Measured once per width/theme, then every check reads these. */
const seen = {};

if (chromium) {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const { readdirSync } = await import("node:fs");
  let exe = process.env.CHROMIUM_PATH;
  if (!exe || !existsSync(exe)) {
    exe = (() => {
      try {
        for (const d of readdirSync(root)) {
          if (!d.startsWith("chromium-")) continue;
          for (const dir of ["chrome-linux", "chrome-linux64"]) {
            const c = join(root, d, dir, "chrome");
            if (existsSync(c)) return c;
          }
        }
      } catch { /* playwright's own guess */ }
      return undefined;
    })();
  }

  const browser = await chromium.launch(exe ? { executablePath: exe } : {});

  for (const [w, h] of [[1280, 860], [390, 740]]) {
    for (const dark of [false, true]) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        colorScheme: dark ? "dark" : "light",
        deviceScaleFactor: 1,
      });
      const p = await ctx.newPage();
      await p.setContent(page(dark), { waitUntil: "load" });

      // The band is a phone control; opening it is what a thumb does, and the
      // open state is the one that can cover the box.
      const measure = async () => p.evaluate(() => {
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return {
            top: r.top, left: r.left, right: r.right, bottom: r.bottom,
            w: r.width, h: r.height,
            shown: s.display !== "none" && s.visibility !== "hidden" && r.height > 0,
            display: s.display, whiteSpace: s.whiteSpace, color: s.color,
          };
        };
        return {
          vw: document.documentElement.clientWidth,
          vh: document.documentElement.clientHeight,
          scrollW: document.documentElement.scrollWidth,
          rail: box(".noterail"), msgs: box(".msgs"), body: box(".notesbody"),
          band: box(".noteband"), title: box(".notetitle"),
          composer: box(".composer"), textarea: box(".inputrow textarea"),
          notep: box(".noteslist p"),
        };
      });

      const shut = await measure();
      /* Opened the way the component opens: the class goes on AND the
         one-line preview goes away. Without the second half the picture
         shows a peek above an open list, which is a state NotesRail cannot
         produce -- a fixture drawing something the app never draws is a
         fixture answering a question nobody asked. */
      await p.evaluate(() => {
        const r = document.querySelector(".noterail");
        r?.classList.add("open");
        r?.querySelector(".notepeek")?.remove();
        const c = r?.querySelector(".nbc");
        if (c) c.textContent = "\u2304";
      });
      const open = await measure();

      seen[`${w}:${dark ? "dark" : "light"}`] = { shut, open };
      await p.screenshot({
        path: `/tmp/notes-${w}-${dark ? "dark" : "light"}.png`,
        fullPage: false,
      });
      await ctx.close();
    }
  }
  await browser.close();
}

/* --------------------------------------------------------------- the rules */

const at = (w, theme = "light") => seen[`${w}:${theme}`];
/** Fully inside the viewport, which is what "you can read it" means. */
const onScreen = (b, v) => Boolean(b?.shown) && b.top >= -1 && b.bottom <= v.vh + 1;

if (!chromium) {
  console.log("  --  no playwright here, so the three source rules below ran "
    + "and the pictures did not.");
  console.log("      npm i -g playwright, then run this again. A SKIP IS NOT "
    + "A PASS: the thing this harness exists for is two rectangles, and "
    + "nothing above measured them.");
} else {
  t("desktop: the notes and the typing box are on screen together", () => {
    const { shut } = at(1280);
    return onScreen(shut.body, shut) && onScreen(shut.textarea, shut);
  }, "THE ASK. A note you must open something to see, or scroll to, is not "
   + "referenceable while typing");

  t("desktop: the rail is beside the messages, not under them", () => {
    const { shut } = at(1280);
    return shut.rail.left >= shut.msgs.right - 1
        && shut.rail.top < shut.msgs.bottom;
  }, "asked separately because 'both on screen' passes on a rail stacked "
   + "under the messages whenever the screen is tall enough -- the two "
   + "checks cannot be satisfied by the same wrong layout");

  t("desktop: no band, because there is nothing for it to do", () => {
    const { shut } = at(1280);
    return !shut.band.shown && shut.title.shown;
  }, "a control that cannot change anything is its own small lie");

  t("phone: the band sits between the messages and the box", () => {
    const { shut } = at(390);
    return shut.band.shown && !shut.title.shown
        && shut.band.top >= shut.msgs.bottom - 1
        && shut.band.bottom <= shut.composer.top + 1;
  }, "a band under the composer is a band behind the keyboard");

  t("phone: opening the notes leaves the box on screen", () => {
    const { open } = at(390);
    return onScreen(open.body, open) && onScreen(open.textarea, open)
        && open.body.bottom <= open.composer.top + 1;
  }, "THE DROPDOWN'S OWN BUG IN A NEW PLACE. The closed band passes whatever "
   + "opening it does, and opening it is the only time it is any use");

  t("phone: the collapsed line is one line and the note itself is not", () => {
    const { shut, open } = at(390);
    return shut.band.shown
        && getNowrap(shut.notep) === false
        && open.notep.h > open.notep.w / 40;
  }, "`.notepeek` is deliberately clipped to one line. A body that inherited "
   + "that shows every note as its first forty characters -- there, sorted, "
   + "and useless");

  for (const w of [1280, 390]) {
    t(`${w}: nothing pushes the page sideways`, () => {
      const s = at(w).open;
      return s.scrollW <= s.vw + 1;
    }, "a rail with a fixed width inside a flex row is exactly how a pane "
     + "ends up wider than the phone it is on");
  }

  t("the notes are readable at night", () => {
    const d = at(390, "dark").open;
    const l = at(390, "light").open;
    // Not a contrast audit -- the stylesheet uses a deliberately quiet grey
    // for small labels. The question is only whether the ink moved at all
    // when the ground did: a colour that is the same in both themes was
    // never given a dark value.
    return Boolean(d.notep?.color) && d.notep.color !== l.notep.color;
  }, "this ground is --sunk and this ink is --ink-2. Six times a colour here "
   + "has been invisible at night while every daytime check passed");
}

function getNowrap(b) {
  return b ? /nowrap/.test(b.whiteSpace) : null;
}

/* ---------------------------------------------------------------- report */

let failed = 0;
for (const [name, fn, why] of checks) {
  let ok = false, blew = null;
  try { ok = fn() === true; } catch (e) { blew = e.message; }
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${blew ? `threw: ${blew}` : why ?? ""}`); failed += 1; }
}
console.log(failed
  ? `\n${failed} of ${checks.length} wrong`
  : `\nnothing obviously wrong (${checks.length} checks`
    + `${chromium ? ", pictures in /tmp/notes-*.png" : ", NO PICTURES"})`);
process.exit(failed ? 1 : 0);
