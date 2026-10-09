/**
 * Taking hold of a home, in a real browser, on a real map.
 *
 * The fix for "I'm not able to move these easily" is one function: on a
 * miss, widen the query into a square around the pointer and take the
 * nearest pad in it. Everything about whether that works is in shapes
 * MapLibre accepts and geometry MapLibre hands back, and reading the
 * source says nothing about either -- a bounding box in the wrong form
 * is a silent empty array, which looks exactly like "you missed".
 *
 * So: a real MapLibre map, eight single-wides fourteen metres apart at
 * the zoom that shows a whole park, and the pointer put down in the
 * places a hand puts it.
 *
 *     node lib/__fixtures__/grab-check.mjs
 *
 * No network: the style is a background colour and the homes are handed
 * in as GeoJSON, so this does not depend on a tile server being up.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const nearpad = ts.transpileModule(
  readFileSync(join(root, "lib/nearpad.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const footprint = ts.transpileModule(
  readFileSync(join(root, "lib/footprint.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

const gl = readFileSync(join(root, "node_modules/maplibre-gl/dist/maplibre-gl.js"), "utf8");
const css = readFileSync(join(root, "node_modules/maplibre-gl/dist/maplibre-gl.css"), "utf8");

// Lady Viola, because the numbers in this file are the numbers the park
// is drawn at and a toy park hides the bug.
const LAT = 35.09249, LNG = -78.91932, BEARING = 128, SPACING = 14;

const page = `<!doctype html><html><head><meta charset="utf-8">
<style>${css}
  html,body{margin:0;height:100%} #map{position:absolute;inset:0}</style>
<script>${gl}</script>
</head><body><div id="map"></div>
<script type="module">
${footprint.replace(/^export /gm, "")}
${nearpad.replace(/^export /gm, "")}
window.padAt = padAt;
const homes = [];
for (let i = 0; i < 8; i++) {
  const per = degreesPerMetre(${LAT});
  // Strung out along the row, the way a row of pads is.
  const r = (${BEARING} + 90) * Math.PI / 180;
  const lng = ${LNG} + Math.sin(r) * ${SPACING} * i * per.lng;
  const lat = ${LAT} + Math.cos(r) * ${SPACING} * i * per.lat;
  homes.push({
    type: "Feature",
    properties: { id: "Lady Viola Dr|" + (3100 + i) },
    geometry: { type: "Polygon", coordinates: [footprint(lat, lng, ${BEARING})] },
  });
}
window.homes = homes;
const m = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {},
           layers: [{ id: "bg", type: "background",
                      paint: { "background-color": "#e8eaee" } }] },
  center: [${LNG}, ${LAT}], zoom: 17.2, attributionControl: false,
});
window.map = m;
m.on("load", () => {
  m.addSource("homes", { type: "geojson",
    data: { type: "FeatureCollection", features: homes } });
  m.addLayer({ id: "home-fill", type: "fill", source: "homes",
    paint: { "fill-color": "#6E9BD1" } });
  m.once("idle", () => { window.ready = true; });
});
</script></body></html>`;

const file = "/tmp/grab-check.html";
writeFileSync(file, page);

let chromium;
for (const where of ["playwright", "/tmp/node_modules/playwright/index.js", "playwright-core"]) {
  try {
    const mod = await import(where);
    chromium = mod.chromium ?? mod.default?.chromium;
    if (chromium) break;
  } catch { /* next */ }
}
if (!chromium) {
  console.log("skipped: no playwright here. npm i -g playwright, then run this again.");
  process.exit(0);
}
const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
let exe = process.env.CHROMIUM_PATH;
if (!exe || !existsSync(exe)) {
  exe = undefined;
  try {
    for (const d of readdirSync(browsers)) {
      if (!d.startsWith("chromium-")) continue;
      const c = join(browsers, d, "chrome-linux", "chrome");
      if (existsSync(c)) { exe = c; break; }
    }
  } catch { /* playwright's own guess */ }
}

const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  // Headless chromium has no GPU; MapLibre wants WebGL either way.
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const noise = [];
p.on("pageerror", (e) => noise.push(String(e)));
await p.goto(`file://${file}`);
try {
  await p.waitForFunction(() => window.ready === true, { timeout: 30000 });
} catch {
  await browser.close();
  console.error(" ✗ the map never finished drawing"
    + (noise.length ? `\n   ${noise.join("\n   ")}` : ""));
  process.exit(1);
}

const said = await p.evaluate(() => {
  const m = window.map, padAt = window.padAt;
  const mid = (f) => {
    const r = f.geometry.coordinates[0].slice(0, -1);
    return [r.reduce((a, q) => a + q[0], 0) / r.length,
            r.reduce((a, q) => a + q[1], 0) / r.length];
  };
  const idOf = (f) => (f ? String(f.properties.id) : null);
  const at = (lngLat, dx = 0, dy = 0) => {
    const q = m.project(lngLat);
    return { x: q.x + dx, y: q.y + dy };
  };
  const third = window.homes[3], fourth = window.homes[4];
  const want = String(third.properties.id);

  // How wide a pad actually is on screen, which is the whole premise.
  const ring = third.geometry.coordinates[0];
  const a = m.project(ring[0]), b = m.project(ring[1]);
  const across = Math.hypot(a.x - b.x, a.y - b.y);

  // Halfway between two pads, nudged a little towards the third, is a
  // point a hand aiming at the third would land on.
  const m3 = m.project(mid(third)), m4 = m.project(mid(fourth));
  const between = { x: (m3.x * 0.6 + m4.x * 0.4), y: (m3.y * 0.6 + m4.y * 0.4) };

  return {
    across,
    gap: Math.hypot(m3.x - m4.x, m3.y - m4.y),
    onIt: idOf(padAt(m, at(mid(third)))),
    want,
    justOff: idOf(padAt(m, at(mid(third), Math.round(across / 2) + 6, 0))),
    wellOff: idOf(padAt(m, at(mid(third), Math.round(across / 2) + 14, 0))),
    between: idOf(padAt(m, between)),
    miles: padAt(m, { x: 5, y: 5 }) === undefined,
    noLayer: padAt(m, at(mid(third)), 20, "no-such-layer") === undefined,
    // The reach is a promise about distance, so past it is a miss.
    pastReach: padAt(m, at(mid(third), 400, 0), 20) === undefined,
  };
});

await p.screenshot({ path: "/tmp/grab-check.png" });
await browser.close();

const wrong = [];
const t = (name, ok, why) => {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) wrong.push(why ?? name);
};

// The premise. If a pad were already forty pixels across there would be
// nothing to fix, and this check would be testing nothing.
t(`a pad really is small on screen (${said.across.toFixed(1)}px across,`
  + ` ${said.gap.toFixed(1)}px apart)`,
  said.across < 20, "A pad this size is not the thing that was hard to hit.");
t("the pointer on the pad takes that pad", said.onIt === said.want);
t("the pointer just off the pad still takes it", said.justOff === said.want,
  `missing by a few pixels gave ${said.justOff}, not ${said.want}`);
t("and a good way off still takes it", said.wellOff === said.want,
  `missing by half a pad's width gave ${said.wellOff}, not ${said.want}`);
t("between two pads it takes the nearer", said.between === said.want,
  `gave ${said.between}, not the nearer ${said.want}`);
t("a tap on empty grass takes nothing", said.miles);
t("past the reach is still a miss", said.pastReach,
  "the box has to be a box, not the whole viewport");
t("a layer that is not there takes nothing", said.noLayer);
if (noise.length) t("the page threw nothing", false, noise.join("; "));

console.log("wrote /tmp/grab-check.png");
if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
