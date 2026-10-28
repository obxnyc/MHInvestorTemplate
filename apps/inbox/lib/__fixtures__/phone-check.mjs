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

/* THE SIGNED-IN SCREENS, which are the ones anybody complains about.
 *
 * Until the stand-in database existed this harness could only reach the five
 * public pages above -- so the crew clock, the screen it was built for, was
 * the one thing it could not see, and every finding about it came from a
 * photograph of a phone.
 *
 * Two identities, because one cannot tell the screens apart: `crew` is
 * CLOCK_ONLY and is redirected away from every office screen, so a crew-only
 * fixture would check nothing on /home, /jobs or /timesheets and report a
 * pass. The ids are the stand-in's own; see stub-supabase.mjs. */
const STUB = "http://127.0.0.1:54321";
const WHOM = {
  crew: "11111111-1111-1111-1111-111111111111",
  desk: "22222222-2222-2222-2222-222222222222",
};
const SIGNED_IN = [
  ["crew", "/clock"], ["crew", "/team"], ["crew", "/settings"],
  ["desk", "/home"], ["desk", "/timesheets"], ["desk", "/jobs"],
  ["desk", "/leasing"], ["desk", "/properties"], ["desk", "/"],
  ["desk", "/owners"],
  // The investor with two homes, and the one with none. The papers are
  // drawn on both -- the empty one is the screen somebody reaches when
  // they are selling a first home, and it was the screen with no way in.
  ["desk", "/owners/ow1"], ["desk", "/owners/ow2"],
];
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

/* NOTHING ANSWERED and ANSWERED BADLY are different, and treating them the
 * same is why this harness reported success for as long as it has existed.
 * `r.ok` is false for a 500, so a server that was up and erroring on every
 * page read as "no server here" -- and exited 0, green, having checked
 * nothing. Only a refused connection is a skip. */
const probe = await fetch(`${BASE}${PAGES[0]}`)
  .then((r) => ({ code: r.status })).catch(() => null);
if (!probe) {
  console.log(`skipped: nothing serving at ${BASE}.`
    + " Build, then `npx next start -p 3100`, then run this.");
  process.exit(0);
}
if (probe.code >= 500) {
  console.error(` ✗ ${BASE}${PAGES[0]} answers ${probe.code}. The server is up and`
    + " every page is broken, which is NOT a reason to skip. Usually missing"
    + " NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY in the environment it was started with.");
  process.exit(1);
}

const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
let exe = process.env.CHROMIUM_PATH;
if (!exe || !existsSync(exe)) {
  /* Both spellings. Chromium renamed this folder to chrome-linux64, so a
     container with a newer build in it launches playwright's own guess --
     which points at a version that is not installed and fails with a wall of
     text about running `playwright install`. */
  exe = readdirSync(root).filter((d) => d.startsWith("chromium"))
    .flatMap((d) => [`${root}/${d}/chrome-linux/chrome`,
                     `${root}/${d}/chrome-linux64/chrome`])
    .find(existsSync);
}

/* Mint a session the way @supabase/ssr stores one: the cookie is named for
 * the FIRST label of the database's hostname (`sb-127-auth-token` against the
 * stand-in) and its value is "base64-" plus the session JSON. */
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
const stubUp = await fetch(`${STUB}/rest/v1/staff`).then((r) => r.ok).catch(() => false);
// Same rows every run, whatever else has written to it since.
if (stubUp) await fetch(`${STUB}/__reset`).catch(() => null);
/* SAY SO when the signed-in half is not being checked. A silent skip is the
 * fault this harness has now had twice over. */
if (!stubUp) {
  console.log(`note: ${STUB} is not answering, so the ${SIGNED_IN.length}`
    + " SIGNED-IN screens were NOT checked -- only the public pages."
    + " Start lib/__fixtures__/stub-supabase.mjs and rebuild against it.");
}

mkdirSync("/tmp/phone", { recursive: true });
const browser = await chromium.launch({ executablePath: exe });
const wrong = [];

/* ONE definition of what is being looked for, so the public pass and the
 * signed-in pass cannot drift apart. A harness whose two halves measure
 * different things reports a pass that means two different things. */
const LOOK = () => {
    const gone = [], thin = [], small = [], over = [], faint = [];
    /* Words that are not there at all. The floor is 1.6:1, NOT a contrast
       audit -- this stylesheet uses a deliberately quiet grey for small
       labels and that is a choice. 1.6 is what white-on-white and
       red-on-red measure. */
    const lum = (c) => {
      const n = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
        .map((x) => x / 255)
        .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return n.length === 3 ? 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2] : null;
    };
    /* COMPOSITE THE LAYERS. Taking the first background with any colour in
       it and treating it as opaque reported six findings at 1.0:1 on the crew
       clock, every one of them WRONG: those rows sit on
       rgba(255,255,255,0.18) over a dark red card, so white text on them is
       white on dark red and perfectly readable. Read as opaque, it came out
       white on white.

       A harness that cries wolf six times on the one screen that matters is
       worse than no harness, because the real finding is in that list too.

       Each layer is blended onto what is behind it until the alpha reaches 1,
       which is what the browser actually paints. */
    const parse = (c) => {
      const n = (c.match(/[\d.]+/g) || []).map(Number);
      if (n.length < 3) return null;
      return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
    };
    const blend = (t, u) => ({ a: 1,
      r: t.r * t.a + u.r * (1 - t.a),
      g: t.g * t.a + u.g * (1 - t.a),
      b: t.b * t.a + u.b * (1 - t.a) });
    const behind = (el) => {
      const stack = [];
      /* Start at the ELEMENT, not its parent. Starting at the parent skips a
         button's own opaque background and measures its text against the page
         behind it -- which turned six false findings into eight different
         ones on other screens. Its own background is simply the topmost
         layer; the compositing below handles it whether it is opaque or not. */
      for (let a = el; a; a = a.parentElement) {
        const c = parse(getComputedStyle(a).backgroundColor);
        if (!c || !c.a) continue;
        stack.push(c);
        if (c.a >= 1) break;
      }
      let out = parse(getComputedStyle(document.body).backgroundColor);
      if (!out || out.a < 1) out = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) out = blend(stack[i], out);
      return out;
    };
    const scrolls = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ov = getComputedStyle(a).overflowX;
        if (ov === "auto" || ov === "scroll") return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll(
      "button, a, input, select, textarea, h1, h2, h3, label, strong, p, li, span")) {
      const r0 = el.getBoundingClientRect();
      if (!r0.width || !r0.height) continue;
      if (!el.textContent?.trim()) continue;
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || st.opacity === "0") continue;
      const bg = behind(el);
      /* Translucent INK over that ground, for the same reason. */
      const fg0 = parse(st.color);
      const ink = fg0 && fg0.a < 1 ? blend(fg0, bg) : fg0;
      const lf = ink ? lum(`rgb(${ink.r},${ink.g},${ink.b})`) : null;
      const lb = lum(`rgb(${bg.r},${bg.g},${bg.b})`);
      if (lf !== null && lb !== null) {
        const hi = Math.max(lf, lb), lo = Math.min(lf, lb);
        const ratio = (hi + 0.05) / (lo + 0.05);
        if (ratio < 1.6) {
          faint.push(`${el.tagName.toLowerCase()}.${(el.className || "-").toString().slice(0, 28)} ${ratio.toFixed(1)}:1`);
        }
      }
    }
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
      faint: [...new Set(faint)],
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      // A page that needs pinching is a page somebody gives up on.
      zoomable: !/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1/.test(
        document.querySelector('meta[name="viewport"]')?.content ?? ""),
    };
};

/* A MENU THAT IS SHUT IS NOT A MENU.
 *
 * Everything else here measures a page AT REST, and the thing the owner
 * photographed only exists once something is open: the account menu, anchored
 * to the avatar's right edge, opening at -90..94 on every phone width --
 * ninety pixels off the left of the screen. No check here could see it,
 * because no check here had ever pressed anything.
 *
 * So: press each control in the header, measure, put it back. Cheap, because
 * there are only a handful, and it is the half of the screen that overlays
 * everything else. */
const OPENERS = ".apphead button, .apphead summary, .apphead [aria-haspopup]";
const probeOpen = async (page, at, out) => {
  const n = await page.$$eval(OPENERS, (els) => els.length).catch(() => 0);
  for (let i = 0; i < n; i++) {
    const els = await page.$$(OPENERS);
    if (!els[i]) break;
    const name = await els[i].evaluate(
      (e) => `${e.tagName.toLowerCase()}.${(e.className || "-").toString().slice(0, 24)}`)
      .catch(() => "?");
    await els[i].click({ force: true }).catch(() => {});
    await page.waitForTimeout(180);
    const off = await page.evaluate(() => {
      const bad = [];
      /* The same rule the at-rest check uses: a nav that scrolls sideways is
         SUPPOSED to have items past the edge. Without this the tab strip
         reported four findings on every page and buried the real one. */
      const scrolls = (el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ov = getComputedStyle(a).overflowX;
          if (ov === "auto" || ov === "scroll") return true;
        }
        return false;
      };
      for (const el of document.querySelectorAll("body *")) {
        if (scrolls(el)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const st = getComputedStyle(el);
        if (st.visibility === "hidden" || st.opacity === "0") continue;
        // A full-width fixed backdrop is meant to cover the screen.
        if (st.position === "fixed" && r.width >= window.innerWidth) continue;
        if (r.left < -1 || r.right > window.innerWidth + 1) {
          bad.push(`${el.tagName.toLowerCase()}.${(el.className || "-").toString().slice(0, 24)}`
            + ` ${Math.round(r.left)}..${Math.round(r.right)}`);
        }
      }
      return [...new Set(bad)].slice(0, 5);
    }).catch(() => []);
    if (off.length) out.push(`${at}: with ${name} open, off the screen -- ${off.join(", ")}`);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(100);
  }
};

/* Both themes, for the same reason card-picture.mjs now draws both: a phone
 * is held in a dark room, and this stylesheet redefines every colour token
 * under prefers-color-scheme: dark. This harness loads the REAL pages, so it
 * is the one that should have caught the white-on-white Clock In button, and
 * it missed it twice over -- it only ever asked for the daytime theme, and it
 * had no contrast check at all. */
const SCHEMES = ["light", "dark"];
for (const scheme of SCHEMES) {
for (const path of PAGES) {
  for (const [width, height] of SIZES) {
    const p = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
    });
    /* A PAGE THAT DID NOT LOAD IS A FAILURE, NOT A PASS.
     *
     * Without this, every page 500s for want of Supabase env, Next serves its
     * own error page, that page has nothing off the screen and nothing too
     * small to tap -- and the harness reports "nothing wrong" about a screen
     * it never saw. Which is what it did, silently, for as long as it has
     * existed. Same shape as the send that cleared the composer whatever came
     * back: silence and success look identical.
     *
     * A redirect to the sign-in wall is not a failure -- it IS the page an
     * unauthenticated phone gets, and it is worth checking. A 500 is. */
    const res = await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" })
      .catch((e) => ({ status: () => 0, err: String(e) }));
    const code = res?.status?.() ?? 0;
    if (code === 0 || code >= 500) {
      wrong.push(`${scheme} ${path} at ${width}x${height}: did not load (${code || "no response"})`
        + ` -- this harness checks nothing on a page that is not there`);
      await p.close();
      continue;
    }
    await p.waitForTimeout(250);

    const said = await p.evaluate(LOOK);

    const tag = `${path.replace(/\//g, "_") || "_root"}-${scheme}-${width}x${height}`;
    await p.screenshot({ path: `/tmp/phone/${tag}.png`, fullPage: true });
    await probeOpen(p, `${scheme} ${path} at ${width}x${height}`, wrong);
    await p.close();

    const at = `${scheme} ${path} at ${width}x${height}`;
    if (said.gone.length) wrong.push(`${at}: off the screen -- ${said.gone.join(", ")}`);
    if (said.sideways) wrong.push(`${at}: the page scrolls sideways`);
    if (said.thin.length) wrong.push(`${at}: too narrow to type into -- ${said.thin.join(", ")}`);
    if (said.over.length) wrong.push(`${at}: a tick box stretched -- ${said.over.join(", ")}`);
    if (said.small.length) wrong.push(`${at}: too small to tap -- ${said.small.join(", ")}`);
    if (said.faint.length) wrong.push(`${at}: words you cannot read -- ${said.faint.join(", ")}`);
    if (!said.zoomable) wrong.push(`${at}: pinch-zoom is switched off`);
  }
}

for (const [who, path] of stubUp ? SIGNED_IN : []) {
  for (const [width, height] of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width, height }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, colorScheme: scheme,
    });
    await ctx.addCookies([{ name: "sb-127-auth-token", value: sessionFor(WHOM[who]),
                            domain: "127.0.0.1", path: "/" }]);
    const p = await ctx.newPage();
    const at = `${scheme} ${path} as ${who} at ${width}x${height}`;
    const res = await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" })
      .catch(() => ({ status: () => 0 }));
    const code = res?.status?.() ?? 0;
    if (code === 0 || code >= 500) {
      wrong.push(`${at}: did not load (${code || "no response"})`);
      await ctx.close(); continue;
    }
    /* A SIGNED-IN PAGE THAT LANDED ON THE SIGN-IN WALL IS NOT THE PAGE.
       Without this the harness measures the login form and calls it /clock. */
    if (/\/(signin|login)/.test(new URL(p.url()).pathname)) {
      wrong.push(`${at}: redirected to ${new URL(p.url()).pathname}`
        + " -- the session was refused, so this screen was not checked");
      await ctx.close(); continue;
    }
    await p.waitForTimeout(250);
    const said = await p.evaluate(LOOK);
    await p.screenshot({ path: `/tmp/phone/${path.replace(/\//g, "_") || "_root"}`
      + `-${who}-${scheme}-${width}x${height}.png`, fullPage: true });
    await probeOpen(p, at, wrong);
    await ctx.close();
    if (said.gone.length) wrong.push(`${at}: off the screen -- ${said.gone.join(", ")}`);
    if (said.sideways) wrong.push(`${at}: the page scrolls sideways`);
    if (said.thin.length) wrong.push(`${at}: too narrow to type into -- ${said.thin.join(", ")}`);
    if (said.over.length) wrong.push(`${at}: a tick box stretched -- ${said.over.join(", ")}`);
    if (said.small.length) wrong.push(`${at}: too small to tap -- ${said.small.join(", ")}`);
    if (said.faint.length) wrong.push(`${at}: words you cannot read -- ${said.faint.join(", ")}`);
    if (!said.zoomable) wrong.push(`${at}: pinch-zoom is switched off`);
  }
}
}

await browser.close();
/* SAY WHAT WAS LOOKED AT, not what the public half was. This line read
   "looked at 5 pages" whether or not the nine signed-in screens had been
   checked -- which is the silent skip this harness exists to have stopped,
   wearing the summary's clothes instead of the loop's. */
console.log(`looked at ${PAGES.length} public and `
  + `${stubUp ? SIGNED_IN.length : 0} signed-in screens, at ${SIZES.length} `
  + `sizes in ${SCHEMES.length} themes; screenshots in /tmp/phone`);
if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
