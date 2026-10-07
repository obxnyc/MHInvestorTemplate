/** The park's real outlines, from OpenStreetMap. No network: the Overpass
 *  answer is built here, because what has to be right is the reading of it.
 *  Run: node lib/__fixtures__/osm.test.mjs */
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
  foot: join(here, "..", ".osm.footprint.gen.mjs"),
  plan: join(here, "..", ".osm.parkplan.gen.mjs"),
  osm: join(here, "..", ".osm.gen.mjs"),
};
writeFileSync(gen.foot, transpile("footprint.ts"));
writeFileSync(gen.plan, transpile("parkplan.ts")
  .replace(/(["'])\.\/footprint\1/g, '"./.osm.footprint.gen.mjs"'));
writeFileSync(gen.osm, transpile("osm.ts")
  .replace(/(["'])\.\/footprint\1/g, '"./.osm.footprint.gen.mjs"')
  .replace(/(["'])\.\/parkplan\1/g, '"./.osm.parkplan.gen.mjs"'));
let buildingsOf, roadsOf, assign, sameStreet, bareName, centroid, placeOn,
    orientedBox, boxAround, overpassBody, nearestOn, placeFromRoads, midOf;
let RETREAT, layOut, streetLines;
try {
  ({ buildingsOf, roadsOf, assign, sameStreet, bareName, centroid, placeOn,
     orientedBox, boxAround, overpassBody, nearestOn, placeFromRoads, midOf }
    = await import(gen.osm));
  ({ RETREAT, layOut, streetLines } = await import(gen.plan));
} finally {
  for (const f of Object.values(gen)) unlinkSync(f);
}

const checks = [];
const t = (n, ok) => checks.push([n, ok]);
const near = (a, b, e = 0.5) => Math.abs(a - b) < e;

// A park like the real one: two streets running east, homes either side.
const LAT = 35.09249, LNG = -78.91932;
const dLat = 1 / 111_320;
const dLng = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));

const road = (name, offsetM) => ({
  type: "way", id: Math.round(Math.random() * 1e6),
  tags: { highway: "residential", name },
  geometry: [0, 60, 130].map((m) => ({
    lat: LAT + offsetM * dLat, lon: LNG + m * dLng,
  })),
});
const home = (id, alongM, acrossM) => {
  const cx = LNG + alongM * dLng, cy = LAT + acrossM * dLat;
  const w = 2.5 * dLng, h = 9 * dLat;
  return {
    type: "way", id, tags: { building: "yes" },
    geometry: [
      { lat: cy - h, lon: cx - w }, { lat: cy - h, lon: cx + w },
      { lat: cy + h, lon: cx + w }, { lat: cy + h, lon: cx - w },
      { lat: cy - h, lon: cx - w },
    ],
  };
};

// Lady Viola on the north, Lady Cheryl 57 m south of it, as the plan says.
const elements = [road("Lady Viola Drive", 0), road("Lady Cheryl Drive", -57)];
let nextId = 1;
// Thirteen north of Viola, fourteen south, twelve and twelve on Cheryl.
for (let i = 0; i < 13; i++) elements.push(home(nextId++, 10 + i * 10.5, 15));
for (let i = 0; i < 14; i++) elements.push(home(nextId++, 5 + i * 10.5, -15));
for (let i = 0; i < 12; i++) elements.push(home(nextId++, 10 + i * 10.5, -42));
for (let i = 0; i < 12; i++) elements.push(home(nextId++, 10 + i * 10.5, -72));
// And a shed four hundred metres away that belongs to nobody here.
elements.push(home(nextId++, 10, 300));

// --- reading the answer ---
{
  const b = buildingsOf(elements);
  t("every building came back", b.length === 52);
  t("rings are closed",
    b.every((s) => s.ring[0][0] === s.ring[s.ring.length - 1][0]
                && s.ring[0][1] === s.ring[s.ring.length - 1][1]));
  t("and they are lng,lat, not the reverse",
    b.every((s) => s.ring.every(([x, y]) => x < -70 && y > 30 && y < 40)));
  t("two named roads", roadsOf(elements).length === 2);
  // A way tagged building with three points is not a building outline.
  t("a stub is not a building",
    buildingsOf([{ tags: { building: "yes" }, geometry: [{ lat: 1, lon: 1 }] }]).length === 0);
  t("an untagged way is not a road",
    roadsOf([{ tags: { highway: "residential" }, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] }]).length === 0);
}

// --- one street, two spellings ---
{
  t("Dr is Drive", sameStreet("Lady Viola Dr", "Lady Viola Drive"));
  t("and Cheryl is not Viola", !sameStreet("Lady Cheryl Dr", "Lady Viola Drive"));
  t("St is Street", sameStreet("Gary St", "Gary Street"));
  t("the bare name drops the suffix", bareName("Lady Viola Dr.") === "lady viola");
  // A street whose name IS a suffix word must not vanish to nothing.
  t("and does not eat a whole name", bareName("Park Drive") === "park");
}

// --- the numbering ---
{
  const { homes, spare, rows } = assign(RETREAT, buildingsOf(elements), roadsOf(elements));
  t("every pad got a number", homes.length === 51);
  t("and the far-off shed did not", spare.length === 1);
  t("each row found what it expected",
    rows.every((r) => r.found === r.row.numbers.length));
  if (process.env.DEBUG) console.log(rows.map((r) =>
    `${r.row.street} ${r.row.side}: ${r.found}/${r.row.numbers.length}`).join("\n"),
    "spare", spare.length, "homes", homes.length);

  const violaN = homes.filter((h) => h.street === "Lady Viola Dr" && h.side === "N");
  t("the north row of Lady Viola has thirteen", violaN.length === 13);
  t("numbered from the west end",
    violaN[0].label === "3100" && violaN[12].label === "3124");
  const cherylS = homes.filter((h) => h.street === "Lady Cheryl Dr" && h.side === "S");
  t("and the south row of Lady Cheryl has twelve", cherylS.length === 12);
  t("the two streets did not swap sides",
    homes.filter((h) => h.street === "Lady Cheryl Dr").length === 24);
  t("no number is used twice on one street",
    new Set(homes.map((h) => h.id)).size === homes.length);
}
{
  // Half a street mapped the other way round is ordinary in OpenStreetMap
  // and must not put one row of homes on both sides of its own road.
  const flipped = elements.map((e) =>
    e.tags?.name === "Lady Viola Drive"
      ? { ...e, geometry: [...e.geometry].reverse() } : e);
  const { homes } = assign(RETREAT, buildingsOf(flipped), roadsOf(flipped));
  const n = homes.filter((h) => h.street === "Lady Viola Dr" && h.side === "N");
  t("a road drawn backwards still sorts the same way",
    n.length === 13 && n[0].label === "3100" && n[12].label === "3124");
}
{
  // More buildings than numbers: the extras stay grey rather than being
  // given numbers that belong to nobody.
  const extra = [...elements, home(900, 145, 15), home(901, 155, 15)];
  const { homes, spare } = assign(RETREAT, buildingsOf(extra), roadsOf(extra));
  t("extra buildings are not invented into lots", homes.length === 51);
  t("they are set aside instead", spare.length === 3);
}

// --- the shapes ---
{
  const ring = [[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]];
  const c = centroid(ring);
  t("a centroid is the middle of the shape", near(c[0], 1, 1e-9) && near(c[1], 0.5, 1e-9));
}
{
  // The one that matters: a five-metre building at a real longitude. Done
  // by shoelace from the origin, eight significant figures cancel away and
  // the answer lands metres outside the building -- far enough to put a
  // home on the wrong side of its own street.
  const w = 2.5 * dLng, h = 9 * dLat;
  const c = centroid([
    [LNG - w, LAT - h], [LNG + w, LAT - h], [LNG + w, LAT + h],
    [LNG - w, LAT + h], [LNG - w, LAT - h],
  ]);
  const off = Math.hypot((c[0] - LNG) / dLng, (c[1] - LAT) / dLat);
  t("and stays in the middle of a real building at a real longitude", off < 0.01);
}
{
  const { homes } = assign(RETREAT, buildingsOf(elements), roadsOf(elements));
  const box = orientedBox(homes.flatMap((h) => h.ring));
  t("the boundary is a rectangle", box.length === 5);
  const side = (i) => {
    const a = box[i], b = box[i + 1];
    return Math.hypot((b[0] - a[0]) / dLng, (b[1] - a[1]) / dLat);
  };
  t("with opposite sides equal", near(side(0), side(2), 0.5) && near(side(1), side(3), 0.5));
  // 130 m of homes plus two 9 m margins, and four rows across about 87 m.
  t("about the size of the park",
    Math.max(side(0), side(1)) > 140 && Math.max(side(0), side(1)) < 175);
}
{
  const n = nearestOn([[0, 0], [10, 0]], [5, 1]);
  t("the nearest point on a line is perpendicular to it", near(n.at[0], 5, 1e-9));
}
{
  const p = placeOn({ name: "x", line: [[-78.92, 35.09], [-78.91, 35.09]] }, [-78.915, 35.091]);
  t("north of a street reads as north", p.north === true);
  const q = placeOn({ name: "x", line: [[-78.92, 35.09], [-78.91, 35.09]] }, [-78.915, 35.089]);
  t("and south of it does not", q.north === false);
}

// --- pinned to the real streets ---
{
  const got = placeFromRoads(RETREAT, roadsOf(elements));
  t("the block takes its angle from the road", near(got.bearing, 90, 0.5));
  t("and the street spacing from the roads", near(got.streetGap, 57, 1));

  // Each drawn street centreline has to land on the road it is named
  // after. This is the whole test: a park that is crooked, in the wrong
  // place or upside down fails it, and all three looked the same on screen.
  for (const line of streetLines(got)) {
    const road = roadsOf(elements).find((r) => sameStreet(line.name, r.name));
    const off = nearestOn(road.line, midOf(line.line)).metres;
    t(`${line.name} lands on ${road.name}`, off < 3);
  }
}
{
  // The same park with its streets the other way round. One of the two
  // arrangements is upside down, and upside down looks exactly like right
  // until you read a street name.
  const swapped = elements.map((e) =>
    e.tags?.name === "Lady Viola Drive" ? { ...e, geometry: e.geometry.map((p) => ({ ...p, lat: p.lat - 57 * dLat })) }
    : e.tags?.name === "Lady Cheryl Drive" ? { ...e, geometry: e.geometry.map((p) => ({ ...p, lat: p.lat + 57 * dLat })) }
    : e);
  const got = placeFromRoads(RETREAT, roadsOf(swapped));
  for (const line of streetLines(got)) {
    const road = roadsOf(swapped).find((r) => sameStreet(line.name, r.name));
    t(`${line.name} follows its road when the two are swapped`,
      nearestOn(road.line, midOf(line.line)).metres < 3);
  }
}
{
  // A volunteer tracing a street east to west instead of west to east must
  // not reverse the house numbers.
  const back = elements.map((e) =>
    e.tags?.highway ? { ...e, geometry: [...e.geometry].reverse() } : e);
  const got = placeFromRoads(RETREAT, roadsOf(back));
  t("a road drawn backwards gives the same angle", near(got.bearing, 90, 0.5));
}
{
  t("no road by that name, no placement",
    placeFromRoads(RETREAT, [{ name: "Nowhere Ave", line: [[0, 0], [1, 1]] }]) === null);
}
{
  const mid = midOf([[0, 0], [10, 0], [10, 10]]);
  t("the middle of a line is halfway along it, not between its ends",
    near(mid[0], 10, 1e-9) && near(mid[1], 0, 1e-9));
}

// --- the question asked ---
{
  const b = boxAround([LNG, LAT], 420);
  t("the box is the right way up", b.n > b.s && b.e > b.w);
  // A degree of longitude is shorter than one of latitude here, so the box
  // is wider in degrees than it is tall. Using one number for both asks
  // for a rectangle and calls it a square.
  t("and wider in degrees than it is tall", (b.e - b.w) > (b.n - b.s));
  const q = overpassBody(b);
  t("the query asks for buildings and named roads",
    q.includes('way["building"]') && q.includes('way["highway"]["name"]'));
  t("and for geometry inline", q.includes("out geom"));
}

const bad = checks.filter(([, ok]) => !ok);
for (const [n, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${n}`);
console.log(bad.length ? `\n${bad.length} failed` : `\nall ${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
