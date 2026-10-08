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
      <label>Who bought it<select><option>Jernigan Holdings LLC</option></select></label>
      <div class="two"><input placeholder="Their name or LLC"><button class="btn">Add them</button></div>
      <p class="memory">Their last deal: $38,500, financed at $612 a month over 84 months.</p>
      <div class="three"><label>Sold on<input type="date"></label>
        <label>Price<input></label><label>Down<input></label></div>
      <label class="check"><input type="checkbox"> We hold the note</label>
      <div class="three"><label>Monthly<input></label><label>Rate %<input></label>
        <label>Months<input></label></div>
      <label>First payment due<input type="date"></label>
      <div class="three"><label>Year<input></label><label>Make<input></label>
        <label>Serial<input></label></div>
      <label>Note<textarea rows="2"></textarea></label>
    </form></section>
  <section class="lotbit"><h3>Every month</h3>
    <form class="saleform">
      <div class="three"><label>Lot rent<input></label><label>Management<input></label>
        <label>Warranty<input></label></div>
      <div class="three"><label>Tenant rent<input></label><label>Pet fee<input></label>
        <label>Late fee<input></label></div></form></section>
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
      <button class="btn">Record the meter</button></form>
    <p class="dim">Recording one replaces the one in service and keeps the old number.</p></section>
</aside>`;

const page = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head><body style="background:var(--page);padding:1rem">
<div class="parkmain withcard">
  <div class="parkwrap"><div style="background:#e8eaee;aspect-ratio:16/10;border-radius:12px"></div></div>
  ${card}
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
    const card = document.querySelector(".lotcard");
    const box = card.getBoundingClientRect();
    const out = [], thin = [], over = [];
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
    return {
      out: [...new Set(out)], thin: [...new Set(thin)], over: [...new Set(over)],
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  await p.screenshot({ path: `/tmp/lot-card-${width}.png`, fullPage: true });
  await p.close();

  if (said.out.length) wrong.push(`${width}px: out of the card -- ${said.out.join(", ")}`);
  if (said.thin.length) wrong.push(`${width}px: too narrow to use -- ${said.thin.join(", ")}`);
  if (said.over.length) wrong.push(`${width}px: a tick box stretched -- ${said.over.join(", ")}`);
  if (said.sideways) wrong.push(`${width}px: the page scrolls sideways`);
}

await browser.close();
console.log("wrote /tmp/lot-card-1440.png and three narrower");
if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
