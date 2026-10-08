/** Taking the park out of the vector tiles.
 *  Run: node lib/__fixtures__/harvest.test.mjs */
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const transpile = (file) =>
  ts.transpileModule(
    readFileSync(join(here, "..", file), "utf8").replace(/^import type .*$/gm, ""),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;

const gen = {
  foot: join(here, "..", ".h.footprint.gen.mjs"),
  plan: join(here, "..", ".h.parkplan.gen.mjs"),
  osm: join(here, "..", ".h.osm.gen.mjs"),
  harvest: join(here, "..", ".h.gen.mjs"),
};
writeFileSync(gen.foot, transpile("footprint.ts"));
writeFileSync(gen.plan, transpile("parkplan.ts")
  .replace(/(["'])\.\/footprint\1/g, '"./.h.footprint.gen.mjs"'));
writeFileSync(gen.osm, transpile("osm.ts")
  .replace(/(["'])\.\/footprint\1/g, '"./.h.footprint.gen.mjs"')
  .replace(/(["'])\.\/parkplan\1/g, '"./.h.parkplan.gen.mjs"'));
writeFileSync(gen.harvest, transpile("harvest.ts")
  .replace(/(["'])\.\/osm\1/g, '"./.h.osm.gen.mjs"')
  .replace(/(["'])\.\/footprint\1/g, '"./.h.footprint.gen.mjs"'));
let dedupe, ringsIn, shapesFrom, roadsFrom, stitch, assign, RETREAT, nearestOn, placeOn;
try {
  ({ dedupe, ringsIn, shapesFrom, roadsFrom, stitch } = await import(gen.harvest));
  ({ assign, nearestOn, placeOn } = await import(gen.osm));
  ({ RETREAT } = await import(gen.plan));
} finally {
  for (const f of Object.values(gen)) unlinkSync(f);
}

const checks = [];
const t = (n, ok) => checks.push([n, ok]);
const near = (a, b, e = 0.5) => Math.abs(a - b) < e;

const LAT = 35.09249, LNG = -78.91932;
const dLat = 1 / 111_320;
const dLng = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));

const poly = (id, a, c) => {
  const cx = LNG + a * dLng, cy = LAT + c * dLat, w = 2.5 * dLng, h = 9 * dLat;
  return {
    id, properties: { class: "residential" },
    geometry: { type: "Polygon", coordinates: [[
      [cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h], [cx - w, cy - h],
    ]] },
  };
};
const road = (id, name, off, from, to) => ({
  id, properties: { name },
  geometry: { type: "LineString", coordinates: [from, to].map((m) => [LNG + m * dLng, LAT + off * dLat]) },
});

// --- one feature per thing ---
{
  const a = poly(1, 10, 15);
  // The same building, arriving again from the next tile, clipped short.
  const clipped = { ...a, geometry: { type: "Polygon", coordinates: [a.geometry.coordinates[0].slice(0, 4)] } };
  const out = dedupe([a, clipped]);
  t("a building on a tile boundary counts once", out.length === 1);
  t("and the whole copy wins over the clipped one",
    out[0].geometry.coordinates[0].length === 5);
}
{
  // Without ids, two different buildings must still be two.
  const a = { ...poly(undefined, 10, 15), id: undefined };
  const b = { ...poly(undefined, 60, 15), id: undefined };
  t("two buildings with no ids are still two", dedupe([a, b]).length === 2);
}
{
  const multi = {
    id: 7, properties: {},
    geometry: { type: "MultiPolygon", coordinates: [
      poly(1, 10, 15).geometry.coordinates, poly(2, 20, 15).geometry.coordinates,
    ] },
  };
  t("a multipolygon is two rings", ringsIn(multi).length === 2);
  t("and an unknown geometry is none", ringsIn({ geometry: { type: "Point", coordinates: [0, 0] } }).length === 0);
  t("and a feature with no geometry is none", ringsIn({}).length === 0);
}

// --- buildings ---
{
  const shapes = shapesFrom([poly(1, 10, 15), poly(2, 20, 15)]);
  t("two buildings come out", shapes.length === 2);
  t("their rings are closed",
    shapes.every((s) => s.ring[0][0] === s.ring[s.ring.length - 1][0]));
  t("and each has a middle inside itself",
    shapes.every((s) => Math.abs(s.centre[1] - (LAT + 15 * dLat)) < 1e-7));
  t("a three-point scrap is not a building",
    shapesFrom([{ id: 9, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] } }]).length === 0);
}

// --- streets ---
{
  // One street arriving as nine pieces, out of order, as tiling delivers it.
  const pieces = [
    road(1, "Lady Viola Dr", 0, 90, 130),
    road(2, "Lady Viola Dr", 0, 0, 45),
    road(3, "Lady Viola Dr", 0, 45, 90),
    road(4, "Lady Cheryl Dr", -57, 0, 130),
    { id: 5, properties: {}, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
  ];
  const roads = roadsFrom(pieces);
  t("the pieces of one street make one street", roads.length === 2);
  t("an unnamed line is not a street", !roads.some((r) => !r.name));

  const viola = roads.find((r) => r.name === "Lady Viola Dr");
  // Measured on the ground. The shared endpoint between two pieces is one
  // place, so counting points counts it twice.
  const span = (line) => Math.abs(line[line.length - 1][0] - line[0][0]) / dLng;
  t("and it runs the whole length", span(viola.line) > 125);
  // Left in tile order, the piece nearest a home can point the wrong way
  // and put it on the wrong side of its own street.
  // In order along the street, either way round. Which end a joined
  // street starts at depends on which piece happened to come first, and
  // the direction the house numbers run is settled later, deliberately.
  const xs = viola.line.map((p) => p[0]);
  const rising = xs.every((x, i) => i === 0 || x >= xs[i - 1]);
  const falling = xs.every((x, i) => i === 0 || x <= xs[i - 1]);
  t("in order along the street", rising || falling);
}
{
  t("a single point is not a street", stitch([[[0, 0]]]).length === 1);
}
{
  // What a street really looks like coming out of vector tiles, and what
  // broke the whole screen: several pieces, out of order, some traced
  // backwards, plus a run of the same name a quarter mile east that is a
  // different piece of road entirely.
  //
  // Sorting every point of every piece along one axis -- which is what
  // this used to do -- turns that into one line zig-zagging across the
  // site, and a row of homes walked along it wanders off at angles that
  // match nothing on the map.
  const seg = (fromM, toM, offM = 0) =>
    [[LNG + fromM * dLng, LAT + offM * dLat], [LNG + toM * dLng, LAT + offM * dLat]];
  const scrambled = [
    seg(90, 130),
    [...seg(0, 45)].reverse(),
    seg(45, 90),
    // Same name, a quarter mile east, not joined to anything here.
    seg(520, 640),
  ];
  const one = stitch(scrambled);
  const xs = one.map((p) => (p[0] - LNG) / dLng);
  t("the pieces join into one street, in order",
    xs.every((x, i) => i === 0 || x >= xs[i - 1] - 0.001)
    || xs.every((x, i) => i === 0 || x <= xs[i - 1] + 0.001));
  t("it runs the length of the park", Math.max(...xs) - Math.min(...xs) > 120);
  t("and the far-off run of the same name is not part of it",
    Math.max(...xs) < 200);

  // Joined end to end, not point-sorted: a street that doubles back has
  // to keep its shape rather than being flattened into a monotonic line.
  const hook = stitch([
    [[LNG, LAT], [LNG + 60 * dLng, LAT]],
    [[LNG + 60 * dLng, LAT], [LNG + 60 * dLng, LAT - 40 * dLat]],
    [[LNG + 60 * dLng, LAT - 40 * dLat], [LNG, LAT - 40 * dLat]],
  ]);
  t("a street that doubles back keeps its shape", hook.length === 4);
  const back = hook.map((p) => (p[0] - LNG) / dLng);
  t("so it is not monotonic", back.some((x, i) => i > 0 && x < back[i - 1] - 0.5));
}

// --- and the whole thing, numbered ---
{
  const features = [];
  let id = 1;
  const rows = [[13, 10, 15], [14, 5, -15], [12, 10, -42], [12, 10, -72]];
  for (const [n, start, c] of rows) {
    for (let i = 0; i < n; i++) features.push(poly(id++, start + i * 10.5, c));
  }
  // Each building also arriving a second time from the neighbouring tile.
  const doubled = [...features, ...features.map((f) => ({ ...f }))];
  const roads = roadsFrom([
    road(900, "Lady Viola Drive", 0, 0, 140),
    road(901, "Lady Cheryl Drive", -57, 0, 140),
  ]);
  const { homes, rows: found } = assign(RETREAT, shapesFrom(doubled), roads);
  t("fifty one homes, counted once each", homes.length === 51);
  t("every row full", found.every((r) => r.found === r.row.numbers.length));
  const violaN = homes.filter((h) => h.street === "Lady Viola Dr" && h.side === "N");
  t("numbered from the entrance, high to low",
    violaN[0].label === "3124" && violaN[12].label === "3100");
}

const bad = checks.filter(([, ok]) => !ok);
for (const [n, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${n}`);
console.log(bad.length ? `\n${bad.length} failed` : `\nall ${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
