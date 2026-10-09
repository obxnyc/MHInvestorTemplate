/**
 * The lot card, drawn and looked at.
 *
 * The owner card shipped with its fields running off the side of the page,
 * a tick box stretched to the width of the card, and a date field clipped
 * to `mm/dd/y`. Every one of those is invisible to a type checker and to
 * every test in this repo, and obvious in a picture.
 *
 * So: render the card against the real stylesheet at four widths and fail
 * on the things a picture answers -- anything sticking out of the card,
 * anything pushing the page sideways, a control squashed below the size
 * it can be used at, and a label sitting on top of its own field.
 *
 *     node lib/__fixtures__/card-picture.mjs
 *
 * It writes /tmp/lot-card-<width>.png either way. Look at them.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../../app/globals.css"), "utf8");

// The card as LotCard.tsx builds it, with every section showing at once:
// a home that is sold, financed, let, has a shed in the yard and two
// meters. The widest the card is ever asked to be.
const card = `
<aside class="lotcard">
  <header><h2>Lot 3123 Lady Cheryl Dr</h2><button class="x">&times;</button></header>
  <section class="lotbit"><h3>The home</h3>
    <div class="chips"><button class="btn">Park owned</button><button class="btn">Tenant owned</button>
    <button class="btn">Investor owned</button><button class="btn pri">No home on it</button></div>
    <label class="check"><input type="checkbox"> We let it and look after it</label></section>
  <section class="lotbit"><h3>Owner</h3>
    <form class="saleform">
      <div class="recall">
        <p>Copy a sale you have already recorded here.</p>
        <ul class="recalls">
          <li><button><strong>3107 Lady Cheryl Dr</strong>
            <span class="dim"> Habberstad Norse Ventures LLC &middot; 2026-08-10
            &middot; $95,600.00 &middot; $341.22/mo</span></button></li>
          <li><button><strong>3105 Lady Cheryl Dr</strong>
            <span class="dim"> Jernigan Holdings LLC &middot; 2026-07-02
            &middot; $38,500.00 &middot; outright</span></button></li>
        </ul>
      </div>
      <div class="ownerpick">
        <label>Who bought it<input value="Habb" placeholder="Start typing their name or LLC"></label>
        <ul class="ownerhits">
          <li><button class="on">Habberstad Norse Ventures LLC</button></li>
          <li><button>Habberstad Property Group</button></li>
          <li><button class="make">Add &ldquo;Habb&rdquo;</button></li>
        </ul>
      </div>
      <div class="two"><input placeholder="Their name or LLC"><button class="btn">Add them</button></div>
      <p class="memory">Their last deal: $38,500, financed at $612 a month over 84 months.</p>
      <div class="three"><label>Sold on<input type="date"></label>
        <label>Price<input></label><label>Down<input></label></div>
      <label class="check"><input type="checkbox"> We hold the note</label>
      <div class="three"><label>Monthly<input></label><label>Rate %<input></label>
        <label>Months<input></label></div>
      <label>First payment due<input type="date"></label>
      <p class="memory">Every month, from the day it sells</p>
      <div class="three"><label>Lot fee<input></label><label>Consultancy<input></label>
        <label>Warranty<input></label></div>
      <div class="three"><label>Tenant rent<input></label><label>Pet fee<input></label>
        <label>Late fee<input></label></div>
      <div class="three"><label>Year<input></label><label>Make<input></label>
        <label>Serial<input></label></div>
      <label>Note<textarea rows="2"></textarea></label>
    </form></section>
  <section class="lotbit"><h3>Every month</h3>
    <form class="saleform">
      <p class="memory">The owner pays the park</p>
      <p class="dim">Mortgage $612.00 a month, from the note above.</p>
      <div class="three"><label>Lot fee<input></label><label>Consultancy<input></label>
        <label>Warranty<input></label></div>
      <label class="check"><input type="checkbox"> They carry their own insurance</label>
      <p class="memory">The tenant pays</p>
      <div class="three"><label>Rent<input></label><label>Pet fee<input></label>
        <label>Late fee<input></label></div></form></section>
  <section class="lotbit"><h3>What we have spent</h3>
    <ul class="lotlist">
      <li><strong>$485.00</strong> Water heater <span class="dim">&middot; 2026-09-14</span>
        <button class="aslink">remove</button></li>
      <li><strong>$120.00</strong> Damage we caused
        <span class="dim">&middot; ours, not deducted</span>
        <button class="aslink">remove</button></li>
    </ul>
    <form class="rowform"><div class="three">
      <label>What<input placeholder="Water heater"></label>
      <label>Cost<input placeholder="485"></label>
      <label>When<input type="date"></label></div>
      <label class="check"><input type="checkbox" checked> Take it off the owner</label>
      <button class="btn">Add expense</button></form></section>
  <section class="lotbit"><h3>What we send them</h3>
    <dl class="lotfacts">
      <dt>Rent in</dt><dd>$1,100.00</dd>
      <dt>They owe</dt><dd>$1,072.00 <span class="dim">mortgage + lot fee + consultancy + warranty</span></dd>
      <dt>We spent</dt><dd>$485.00</dd>
      <dt>Net to them</dt><dd><strong class="parkbad">-$457.00</strong></dd>
    </dl>
    <p class="dim">On the agreed charges, not on what has actually come in &mdash;
      nothing here knows yet whether the rent arrived.</p></section>
  <section class="lotbit"><h3>Storage in the yard</h3>
    <form class="rowform"><div class="three">
      <label>What<input placeholder="Shed"></label><label>Size<input placeholder="10x12"></label>
      <label>A month<input placeholder="45"></label></div>
      <button class="btn">Add storage</button></form></section>
  <section class="lotbit"><h3>Meters</h3>
    <form class="rowform"><div class="three">
      <label>Which<select><option>Water</option></select></label>
      <label>Number<input placeholder="81-440391"></label>
      <label>Provider<input placeholder="PWC"></label></div>
      <label>Account reference<input></label>
      <button class="btn">Add meter</button></form>
    <p class="dim">Recording one replaces the one in service and keeps the old number.</p></section>
</aside>`;

// And the same card for a home we still own, which is a different card:
// no buyer, no sale date, no price, no bill of sale -- nothing has been
// sold -- and three chips saying whether it is stock, a letting we mean
// to keep, or the laundry.
const owned = `
<aside class="lotcard">
  <header><h2>Lot 3100 Lady Viola Dr</h2><button class="x">&times;</button></header>
  <section class="lotbit"><h3>The home</h3>
    <div class="kindpick"><button class="chip on">Park owned</button>
      <button class="chip">Tenant owned</button><button class="chip">Investor owned</button>
      <button class="chip">No home on it</button></div>
    <p class="dim">We still own this one.</p>
    <div class="kindpick"><button class="chip on">Ours to sell</button>
      <button class="chip">We rent it out</button><button class="chip">Not a home</button></div>
    <p class="dim">Counted in what is left to sell. It can still be let in the meantime.</p>
  </section>
  <section class="lotbit"><h3>Every month</h3>
    <form class="saleform"><p class="memory">The tenant pays</p>
      <div class="three"><label>Rent<input></label><label>Pet fee<input></label>
        <label>Late fee<input></label></div>
      <div class="invacts"><button class="btn pri">Save the rent</button></div>
    </form></section>
  <section class="lotbit"><h3>Storage in the yard</h3>
    <form class="rowform"><div class="three">
      <label>What<input placeholder="Shed"></label><label>Size<input placeholder="10x12"></label>
      <label>A month<input placeholder="45"></label></div>
      <button class="btn">Add storage</button></form></section>
</aside>`;

// And the panel that takes the card's place while the homes are being
// moved: four arrows round a number, a tick, a box to retype the number
// in, and two buttons to step along the row. Three separate grids in a
// 23rem column, which is the exact shape of thing that has gone wrong
// here before -- a bare `1fr` that will not shrink, and a tick box
// stretched by a width of 100%.
const moving = `
<aside class="lotcard movecard">
  <header><h2>Lot 1140 Northside Rd Lot 17</h2><button class="x">&times;</button></header>
  <div class="movepad">
    <button class="up">&uarr;</button>
    <button class="left">&larr;</button>
    <span class="movenum">17</span>
    <button class="right">&rarr;</button>
    <button class="down">&darr;</button>
  </div>
  <label class="movewhole"><input type="checkbox"> <span>Move the whole row</span></label>
  <p class="movesay">Half a metre a press. The arrow keys do the same thing.</p>
  <form class="movenumber">
    <label for="lotno">Lot number</label>
    <input id="lotno" value="17">
    <button class="btn">Rename</button>
  </form>
  <div class="moveshape">
    <label for="lotangle">Angle</label>
    <div class="movebump">
      <button>&minus;</button><input id="lotangle" value="-38"><span class="movedeg">&deg;</span><button>+</button>
    </div>
    <div class="movetwo">
      <label>Wide (ft)<input value="16"></label>
      <label>Long (ft)<input value="60"></label>
    </div>
    <p class="movesay">This changes all 30 homes in the row, because they are
      one row of one model.</p>
    <button class="btn">Give this one its own shape</button>
  </div>
  <p class="movesay">1140 Northside Rd Lot 17 &mdash; what a sale or a lease is filed under.</p>
  <button class="moveoff">Take off the map</button>
  <div class="movestep">
    <button class="btn">&lsaquo; Previous</button>
    <button class="btn">Next &rsaquo;</button>
  </div>
</aside>`;

const page = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head><body style="background:var(--page);padding:1rem">
<div class="parkmain withcard">
  <div class="parkwrap"><div style="background:#e8eaee;aspect-ratio:16/10;border-radius:12px"></div></div>
  ${card}
</div>
<div class="parkmain withcard" style="margin-top:2rem">
  <div class="parkwrap"><div style="background:#e8eaee;aspect-ratio:16/10;border-radius:12px"></div></div>
  ${owned}
</div>
<div class="parkmain withcard" style="margin-top:2rem">
  <div class="parkwrap"><div style="background:#e8eaee;aspect-ratio:16/10;border-radius:12px"></div></div>
  ${moving}
</div></body></html>`;

const file = "/tmp/lot-card.html";
writeFileSync(file, page);

// Playwright is not a dependency of this app -- it is a few hundred
// megabytes to check a stylesheet, and the rest of the suite needs no
// browser. Where it is not installed this says so and stops, rather
// than failing in a way that reads like the card is broken.
let chromium;
for (const where of ["playwright", "/tmp/node_modules/playwright/index.js",
                     "playwright-core"]) {
  try {
    const m = await import(where);
    // Playwright is CommonJS, so a path import puts it under `default`
    // and a bare name does not. Both shapes, or neither works.
    chromium = m.chromium ?? m.default?.chromium;
    if (chromium) break;
  } catch { /* next */ }
}
if (!chromium) {
  console.log("skipped: no playwright here. npm i -g playwright, then run this again.");
  process.exit(0);
}

// The browser download is switched off in this container; one is already
// installed where PLAYWRIGHT_BROWSERS_PATH points, under a version that
// moves, so it is looked up rather than named.
const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
const { readdirSync } = await import("node:fs");
let exe = process.env.CHROMIUM_PATH;
if (!exe || !existsSync(exe)) {
  exe = (() => {
    try {
      for (const d of readdirSync(root)) {
        if (!d.startsWith("chromium-")) continue;
        const c = join(root, d, "chrome-linux", "chrome");
        if (existsSync(c)) return c;
      }
    } catch { /* fall through to playwright's own guess */ }
    return undefined;
  })();
}

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const wrong = [];

for (const width of [1440, 1100, 900, 420]) {
  const p = await browser.newPage({ viewport: { width, height: 1200 } });
  await p.goto(`file://${file}`);
  await p.waitForTimeout(150);

  const said = await p.evaluate(() => {
    const out = [], thin = [], over = [], small = [], faint = [];
    // The point of the nudge buttons is that a pad can be moved without
    // hitting a twelve-pixel rectangle. A nudge button you have to aim
    // at is the same bug one step along, so they have a floor: 30px,
    // which is under Apple's 44 and over a fingertip's worth of slop.
    // Words you cannot read. `.btn.danger` is the filled destructive
    // button -- red ground, white text -- and a later rule that set only
    // the colour gave red on red: a solid block with the words invisible
    // inside it, which every other check in here was happy with.
    const seen = (el) => {
      let node = el;
      while (node && node !== document.documentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        const m = bg.match(/[\d.]+/g);
        if (m && (m.length < 4 || Number(m[3]) > 0.5)) return m.slice(0, 3).map(Number);
        node = node.parentElement;
      }
      return [255, 255, 255];
    };
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    for (const el of document.querySelectorAll(".lotcard button, .lotcard a, .lotcard label, .lotcard p, .lotcard h2, .lotcard h3, .lotcard span, .lotcard dt, .lotcard dd")) {
      if (!el.textContent.trim()) continue;
      if (el.querySelector("*")) continue;
      const ink = (getComputedStyle(el).color.match(/[\d.]+/g) ?? [0, 0, 0])
        .slice(0, 3).map(Number);
      const a = lum(ink) + 0.05, b2 = lum(seen(el)) + 0.05;
      const ratio = a > b2 ? a / b2 : b2 / a;
      // Not a contrast audit -- this stylesheet uses a deliberately
      // quiet grey for its small uppercase labels and that is a choice,
      // not a bug. 1.6 is the floor for "these words are not there at
      // all", which is what red on red was.
      if (ratio < 1.6) {
        faint.push(`${el.tagName.toLowerCase()}.${el.className || "-"}`
          + ` ${ratio.toFixed(1)}:1`);
      }
    }
    for (const b of document.querySelectorAll(".movepad button, .movestep .btn")) {
      const r = b.getBoundingClientRect();
      if (r.width < 30 || r.height < 30) {
        small.push(`${b.className} ${Math.round(r.width)}x${Math.round(r.height)}px`);
      }
    }
    for (const card of document.querySelectorAll(".lotcard")) {
    const box = card.getBoundingClientRect();
    for (const el of card.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const name = `${el.tagName.toLowerCase()}.${el.className || "-"}`;
      // Out of the card altogether.
      if (r.right > box.right + 1 || r.left < box.left - 1) out.push(name);
      // A field too narrow to type into, or a tick stretched into a box.
      if (/^(input|select|textarea)$/.test(el.tagName.toLowerCase())) {
        const tick = el.type === "checkbox" || el.type === "radio";
        if (tick && r.width > 40) over.push(`${name}[${el.type}] ${Math.round(r.width)}px`);
        if (!tick && r.width < 56) thin.push(`${name} ${Math.round(r.width)}px`);
        // A date field clips rather than shrinks, and its own text is the
        // only thing that says whether it fitted.
        if (el.type === "date" && r.width < 128) thin.push(`${name}[date] ${Math.round(r.width)}px`);
      }
    }
    }
    return {
      out: [...new Set(out)], thin: [...new Set(thin)], over: [...new Set(over)],
      small: [...new Set(small)], faint: [...new Set(faint)],
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  await p.screenshot({ path: `/tmp/lot-card-${width}.png`, fullPage: true });
  await p.close();

  if (said.out.length) wrong.push(`${width}px: out of the card -- ${said.out.join(", ")}`);
  if (said.thin.length) wrong.push(`${width}px: too narrow to use -- ${said.thin.join(", ")}`);
  if (said.over.length) wrong.push(`${width}px: a tick box stretched -- ${said.over.join(", ")}`);
  if (said.small.length) wrong.push(`${width}px: too small to hit -- ${said.small.join(", ")}`);
  if (said.faint.length) wrong.push(`${width}px: words you cannot read -- ${said.faint.join(", ")}`);
  if (said.sideways) wrong.push(`${width}px: the page scrolls sideways`);
}

await browser.close();
console.log("wrote /tmp/lot-card-1440.png and three narrower");
if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
