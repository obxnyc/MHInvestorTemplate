/** Placing a lot on a map, and finding it again.
 *  Run: node lib/__fixtures__/sitemap.test.mjs
 *
 *  The whole point of storing coordinates rather than "62% across the
 *  photograph" is that the picture can be replaced without moving a pin. So
 *  what has to hold is the round trip: a click becomes a place, and that
 *  place lands back under the same click -- at any zoom, and at a different
 *  zoom from the one it was placed at. */
import { readFileSync } from "fs";
import ts from "typescript";

const src = readFileSync(new URL("../sitemap.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { toPixels, toLatLng, zoomFor, centreOf, project, unproject } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (n, ok, extra = "") => checks.push([n, ok, extra]);
const near = (a, b, eps) => Math.abs(a - b) < eps;

// 1140 Northside, roughly. Real numbers, so the scales involved are real.
const frame = { lat: 36.3419, lng: -76.2261, zoom: 18, width: 640, height: 480 };

{
  // A click, turned into a place, turned back into a click.
  for (const [px, py] of [[320, 240], [80, 60], [600, 450], [0, 0]]) {
    const { lat, lng } = toLatLng(frame, px, py);
    const back = toPixels(frame, lat, lng);
    t(`click at ${px},${py} lands back where it was`,
      near(back.x, px, 0.01) && near(back.y, py, 0.01),
      `${back.x.toFixed(3)},${back.y.toFixed(3)}`);
  }
}

{
  // The point of the exercise: the same place, on a different picture.
  const { lat, lng } = toLatLng(frame, 200, 150);
  const wider = { ...frame, zoom: 16, width: 900, height: 600 };
  const on = toPixels(wider, lat, lng);
  const backAgain = toLatLng(wider, on.x, on.y);
  t("a lot keeps its place when the map is replaced",
    near(backAgain.lat, lat, 1e-9) && near(backAgain.lng, lng, 1e-9));
  t("and lands inside the new picture",
    on.x > 0 && on.x < wider.width && on.y > 0 && on.y < wider.height,
    `${on.x.toFixed(0)},${on.y.toFixed(0)}`);
}

{
  // The centre of the picture is the place it is centred on.
  const mid = toPixels(frame, frame.lat, frame.lng);
  t("the centre is the centre", near(mid.x, 320, 1e-9) && near(mid.y, 240, 1e-9));
}

{
  // Going north moves up the screen; going east moves right. Getting either
  // backwards mirrors an entire park and looks almost plausible.
  const north = toPixels(frame, frame.lat + 0.001, frame.lng);
  const east = toPixels(frame, frame.lat, frame.lng + 0.001);
  t("north is up", north.y < 240, `y=${north.y.toFixed(1)}`);
  t("east is right", east.x > 320, `x=${east.x.toFixed(1)}`);
}

{
  // A park a few hundred metres long fits; a single house does not zoom to
  // the whole county.
  const park = Array.from({ length: 60 }, (_, i) => ({
    lat: 36.3419 + i * 0.00004, lng: -76.2261 + (i % 2) * 0.0002,
  }));
  const z = zoomFor(park, 640, 480);
  t("a park gets a zoom that fits it", z >= 16 && z <= 19, `zoom ${z}`);

  const fitted = { ...frame, zoom: z, ...centreOf(park) };
  const every = park.map((p) => toPixels(fitted, p.lat, p.lng));
  t("and every lot lands on the picture",
    every.every((p) => p.x >= 0 && p.x <= 640 && p.y >= 0 && p.y <= 480));

  t("one lot alone falls back rather than zooming to the street",
    zoomFor([{ lat: 36.34, lng: -76.22 }], 640, 480) === 18);
}

{
  // The poles, where the projection goes to infinity.
  const p = project(89.9999, 0);
  t("the projection does not run away at the pole",
    Number.isFinite(p.y) && p.y >= 0 && p.y <= 1, String(p.y));
  const u = unproject(0.5, 0.5);
  t("the middle of the world is the equator at Greenwich",
    near(u.lat, 0, 1e-9) && near(u.lng, 0, 1e-9));
}

let bad = 0;
for (const [name, ok, extra] of checks) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${extra && !ok ? ` — ${extra}` : ""}`);
}
console.log(bad ? `\n${bad} failed` : `\n${checks.length} passed`);
process.exit(bad ? 1 : 0);
