/** Everything you own, on the ground.
 *
 *  A real browser, the real page and a real MapLibre, because the fault
 *  this screen was built around is one that only a running map has.
 *
 *  THE FIRST VERSION USED ONE HTML MARKER PER PROPERTY, and two of the
 *  three in the fixture are a mile apart near Fayetteville. They drew
 *  exactly on top of each other and the one underneath could not be
 *  clicked AT ALL -- not hard to hit; unreachable, because the pin above
 *  took every click. Reading the code says nothing about that. The
 *  harness found it by trying to press the thing.
 *
 *  So the pins are a clustered source now, and what is checked is that
 *  a cluster opens rather than swallowing what is inside it.
 *
 *  Start the stand-in and the app first:
 *      node lib/__fixtures__/stub-supabase.mjs &
 *      npx next build && npx next start -p 3100
 *      node lib/__fixtures__/map-check.mjs
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.MAP_CHECK_BASE ?? "http://127.0.0.1:3100";

/* `require` and not a bare import: playwright is installed globally in
   a cloud session and ESM resolves only against node_modules up the
   tree, so `await import` throws and the harness reports itself absent.
   Four harnesses here skipped silently for months on that. */
const req = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { try { ({ chromium } = req("playwright")); } catch { /* said below */ } }

const checks = [];
const t = (name, ok, why) => checks.push([name, ok === true, why]);

/* A SKIP IS AS LOUD AS A FAILURE. A harness that cannot run and exits 0
   reads exactly like one that passed. */
if (!chromium) {
  console.error("FAIL  playwright is not reachable — the map has NOT been checked");
  process.exit(1);
}
const up = await fetch(`${BASE}/signin`).then(() => true).catch(() => false);
if (!up) {
  console.error(`FAIL  nothing serving at ${BASE} — the map has NOT been checked.`
    + " Start stub-supabase.mjs, build, and `npx next start -p 3100`.");
  process.exit(1);
}

const DESK = "22222222-2222-2222-2222-222222222222";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1e3) + 3600;
const jwt = [b64({ alg: "HS256", typ: "JWT" }),
  b64({ sub: DESK, aud: "authenticated", role: "authenticated",
        email: "2222@larabeehomesllc.com", exp, iat: exp - 3600,
        iss: "http://127.0.0.1:54321/auth/v1" }), "c3R1Yg"].join(".");
const session = "base64-" + Buffer.from(JSON.stringify({
  access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp,
  refresh_token: "r", user: { id: DESK, aud: "authenticated", role: "authenticated",
    email: "2222@larabeehomesllc.com", app_metadata: {}, user_metadata: {},
    created_at: "2026-01-01T00:00:00Z" } })).toString("base64url");

/* Esri's tiles are refused by this container's egress, so they are
   answered with a square of mottled green. That is the HARNESS's limit
   and not the page's: what is under test is the pins, the clustering,
   the card and the drill-in, all of which are ours. A flat colour would
   also do, but a mottled one makes a screenshot of this a fair picture
   of the real thing. */
const TILE = readFileSync(join(here, "aerial-stand-in.png"));

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium",
  args: ["--headless", "--no-sandbox"] });
const shots = process.env.MAP_CHECK_SHOTS ?? "/tmp";

try {
  for (const [tag, w, dark] of [["wide", 1100, false], ["phone", 390, false],
                                ["dark", 1100, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 },
      colorScheme: dark ? "dark" : "light" });
    /* EVERY tile source, not just the photograph. The roads and the
       place labels come from a different path on the same host, and
       leaving those two unanswered is enough to keep the map
       permanently "loading" -- which is how a settle that waited on
       m.loaded() hung for ever against a page that was fine.
       The glyphs are refused outright rather than left hanging: no
       text can rasterise here either way, and a request that never
       answers is worse than one that fails. */
    await ctx.route("**/server.arcgisonline.com/**", (r) =>
      r.fulfill({ status: 200, contentType: "image/png", body: TILE }));
    await ctx.route("**/tiles.openfreemap.org/**", (r) => r.abort());
    await ctx.addCookies([{ name: "sb-127-auth-token", value: session,
      domain: "127.0.0.1", path: "/" }]);
    const pg = await ctx.newPage();
    const errs = [];
    pg.on("pageerror", (e) => errs.push(String(e.message)));
    await pg.goto(`${BASE}/properties`, { waitUntil: "networkidle" });

    await pg.locator(".groupbar button", { hasText: /^Map$/ }).click();
    /* Wait for the LAYERS, not for the handle and not for the style.
       The handle is published the moment the map is made, and
       isStyleLoaded() goes true before the load handler has run -- so
       both of those let a check measure an empty map and report the
       pins missing. The pin layer exists only once the load handler
       has finished adding it. */
    /* SETTLE, don't sleep. Four different things here go true before
       the map is ready to be asked anything: the handle is published
       when the map is made, isStyleLoaded() goes true before the load
       handler runs, the pin layer is added before the effect that puts
       properties into it, and fitBounds animates for 400ms afterwards
       -- during which a query returns nothing. Every one of those made
       this harness report the pins missing from a working map.

       `m.loaded()` is false while anything is still in flight, so
       waiting for that AND for a feature to be drawn covers all four,
       and no fixed timeout has to be guessed. */
    const settle = async (why) => {
      await pg.waitForFunction(() => {
        const m = window.__pm;
        if (!m || !m.getLayer?.("pin")) return false;
        /* AND THE CAMERA HAS STOPPED. A count can be stable two polls
           running while a fitBounds is still gliding, and a screen
           point projected mid-glide is stale by the time the mouse
           gets there -- the click lands on grass and the card never
           opens. That failure looked exactly like a broken card. */
        if (m.isMoving() || m.isZooming() || m.isEasing()) return false;
        /* Not m.loaded(): with the glyph server refused it never goes
           true, and waiting on it hangs against a working map. What
           settles is the DRAWING -- the same count twice in a row,
           which is false during a fitBounds and true once it lands. */
        const n = m.queryRenderedFeatures({ layers: ["pin", "cluster"] }).length;
        const was = window.__pmWas;
        window.__pmWas = n;
        return n > 0 && n === was;
      }, null, { timeout: 25000 }).catch(() => {
        console.log(`      (did not settle: ${why})`);
      });
    };
    await pg.evaluate(() => { window.__pmWas = -1; });
    await settle("first draw");

    const drawn = await pg.evaluate(() => {
      const m = window.__pm;
      if (!m) return null;
      return {
        pins: m.queryRenderedFeatures({ layers: ["pin"] }).length,
        clusters: m.queryRenderedFeatures({ layers: ["cluster"] }).length,
      };
    });

    t(`${tag}: the map is on the page`, !!drawn,
      "window.__pm never appeared — the map did not load");
    if (!drawn) { await ctx.close(); continue; }

    t(`${tag}: something is drawn on it`, drawn.pins + drawn.clusters > 0,
      JSON.stringify(drawn));

    /* THE WHOLE POINT. Two of the three sit a mile apart, so at the
       framing that fits all three they must collect rather than stack.
       If this ever reads 3 loose pins the overlap is back. */
    t(`${tag}: the close-together ones collect into a cluster`,
      drawn.clusters >= 1 && drawn.pins < 3,
      `${drawn.pins} loose pins and ${drawn.clusters} clusters`);

    await pg.screenshot({ path: `${shots}/map-${tag}.png` });

    if (tag === "wide") {
      const bb = await pg.locator(".propmap").boundingBox();
      const tapAt = async (at) => {
        await pg.mouse.click(bb.x + at.x, bb.y + at.y);
        await pg.evaluate(() => { window.__pmWas = -1; });
        await settle("after a tap");
        await pg.waitForTimeout(250);
      };
      const pointOn = (layer, pick) => pg.evaluate(({ l, p }) => {
        const m = window.__pm;
        const all = m.queryRenderedFeatures({ layers: [l] });
        const f = p ? all.find((x) => Number(x.properties.lots) > 1) : all[0];
        if (!f) return null;
        const q = m.project(f.geometry.coordinates);
        return { x: q.x, y: q.y };
      }, { l: layer, p: pick });

      /* A CLUSTER THAT WILL NOT OPEN IS A DEAD END -- the properties
         inside it would be on the map and unreachable, which is the
         fault this replaced wearing a different hat. */
      const before = drawn.pins;
      const cl = await pointOn("cluster", false);
      if (cl) await tapAt(cl);
      const after = await pg.evaluate(() =>
        window.__pm.queryRenderedFeatures({ layers: ["pin"] }).length);
      t("tapping a cluster opens it", after > before,
        `${before} loose pins before, ${after} after`);

      /* And the park inside it, not whichever pin happens to be first:
         with one lot each, "see the lots" and "there is nothing to
         drill into" are the same screen. */
      const one = await pointOn("pin", true);
      t("a property with lots is reachable once it is open", !!one,
        "no multi-lot property among the loose pins");
      if (one) await tapAt(one);

      const card = await pg.locator(".propmapcard strong").innerText()
        .catch(() => null);
      t("choosing one brings up its card", !!card, String(card));

      const href = await pg.locator(".propmapacts a").getAttribute("href")
        .catch(() => null);
      t("and a park offers the way into its lots",
        !!href && /^\/properties\/[^/]+\/plan$/.test(href), String(href));

      await pg.screenshot({ path: `${shots}/map-card.png` });

      /* Tapping bare ground puts it away, which is what somebody means
         by tapping away from it. Up and left of centre: the card lives
         in the BOTTOM left and the zoom buttons in the top right, so
         the first version of this pressed the card it was trying to
         dismiss and reported the page broken. */
      await pg.mouse.click(bb.x + bb.width * 0.3, bb.y + bb.height * 0.18);
      await pg.waitForTimeout(500);
      t("and tapping the ground puts the card away",
        (await pg.locator(".propmapcard").count()) === 0);

      /* LABELS ACTUALLY DRAW. A symbol layer with no glyphs in the
         style renders as nothing at all, with no error -- the layer is
         still there and still answers a query, so asking whether the
         layer exists proves nothing. Ask the map whether it has glyphs
         to draw with and whether the text layers found features. */
      const text = await pg.evaluate(() => {
        const m = window.__pm;
        return {
          glyphs: !!m.getStyle().glyphs,
          labelled: m.queryRenderedFeatures({ layers: ["pin-label"] }).length,
          counted: m.queryRenderedFeatures({ layers: ["pin-count"] }).length,
        };
      });
      /* WHAT CAN HONESTLY BE ASKED HERE. The glyph server is on the
         open internet and this container cannot reach it, so no text
         ever rasterises in this harness -- asking whether a label
         DREW would fail for a reason that has nothing to do with the
         page, which is worse than not asking. What is checkable is
         that the style names a glyph source at all (dropping it once
         made every label silently blank) and that the layers exist
         with a text-field to draw. */
      t("the style has glyphs, so text can be drawn",
        text.glyphs, JSON.stringify(text));
      const labels = await pg.evaluate(() => {
        const m = window.__pm;
        return ["pin-label", "pin-count", "cluster-count"].map((id) => {
          const l = m.getLayer(id);
          return l ? !!m.getLayoutProperty(id, "text-field") : false;
        });
      });
      t("and every text layer is there with something to say",
        labels.every(Boolean), JSON.stringify(labels));

      /* A park and a house are different work; ours and one we manage
         for somebody else are different again. Both are drawn, so both
         have to be ASKED of the drawing rather than of the data. */
      const drawnAs = await pg.evaluate(() => {
        const m = window.__pm;
        return m.queryRenderedFeatures({ layers: ["pin"] })
          .map((f) => ({ park: f.properties.park, ours: f.properties.ours }));
      });
      t("a park is told apart from a house",
        new Set(drawnAs.map((d) => String(d.park))).size > 1,
        JSON.stringify(drawnAs));
    }

    t(`${tag}: nothing threw`, errs.length === 0, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
} finally {
  await b.close();
}

let bad = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${!ok && why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${checks.length}`); process.exit(1); }
console.log(`every property on the ground, and the close ones open out`
  + ` — pictures in ${shots}`);
