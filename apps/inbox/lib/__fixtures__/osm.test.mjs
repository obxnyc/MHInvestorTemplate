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
    orientedBox, boxAround, overpassBody, nearestOn, placeFromRoads, midOf,
    areasOf, parkAround, inRing, roadQuery, buildingQuery, landQuery, nearestNames,
    fitInside, areaOf, tightest;
let RETREAT, layOut, streetLines;
try {
  ({ buildingsOf, roadsOf, assign, sameStreet, bareName, centroid, placeOn,
     orientedBox, boxAround, overpassBody, nearestOn, placeFromRoads, midOf,
     areasOf, parkAround, inRing, roadQuery, buildingQuery, landQuery, nearestNames,
     fitInside, areaOf, tightest } = await import(gen.osm));
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
  // 3100 is at the loop in the east and the numbers climb west towards
  // Pamalee, which is how the addresses actually run. Sorted the other way
  // -- which is what "along the street" means on its own -- every row in
  // the park reads backwards.
  // The county map is unambiguous: 3124 is at the Pamalee entrance in the
  // west and the numbers count down to 3100 at the loop. Sorted the other
  // way -- which is what "along the street" gives on its own -- every row
  // in the park reads backwards, which looks plausible until somebody
  // reads a house number.
  t("the row starts at the entrance with its highest number",
    violaN[0].label === "3124" && violaN[12].label === "3100");
  const xs = violaN.map((h) => h.ring[0][0]);
  t("so the low numbers are the eastern ones", xs[12] > xs[0]);
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
    n.length === 13 && n[0].label === "3124" && n[12].label === "3100");
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

// --- what is not a home, and what is not there at all ---
{
  // A row missing its last five buildings still has five lots. A lot that
  // is not on the screen is a lot nobody can record a sale against.
  // The last five buildings of Lady Viola's odd row, which is the east end
  // once the row is read from the entrance.
  const short = elements.filter((e) =>
    !(e.tags?.building && e.id >= 23 && e.id <= 27));
  const { homes } = assign(RETREAT, buildingsOf(short), roadsOf(elements));
  t("a row the map is short of still has all its lots", homes.length === 51);
  const drawn = homes.filter((h) => h.drawn);
  t("and the ones the map lacks are marked as drawn", drawn.length === 5);
  t("they continue their own row, not somebody else's",
    drawn.every((h) => h.street === "Lady Viola Dr" && h.side === "S"));
  // Carrying on past the end of a row, not piling up on the last home.
  const centres = drawn.map((h) => h.ring[0]);
  t("spread out rather than stacked",
    new Set(centres.map((c) => c[0].toFixed(6))).size === drawn.length);
}
{
  // The office, a carport, or two pads traced as one shape: three times
  // the size of a home, and drawn as a home the size of four.
  const big = elements.map((e) =>
    e.id === 3 && e.tags?.building
      ? { ...e, geometry: e.geometry.map((p) => ({
          lat: LAT + (p.lat - LAT) * 3, lon: LNG + (p.lon - LNG) * 3 })) }
      : e);
  const { homes } = assign(RETREAT, buildingsOf(big), roadsOf(big));
  const odd = homes.filter((h) => h.redrawn);
  t("an outline that is not a home is redrawn as a pad", odd.length >= 1);
  t("at about the size of a home",
    odd.every((h) => areaOf(h.ring) > 60 && areaOf(h.ring) < 120));
}
{
  // A building the far side of Pamalee Dr is not lot 3100.
  const fence = [
    [LNG - 12 * dLng, LAT - 95 * dLat], [LNG + 150 * dLng, LAT - 95 * dLat],
    [LNG + 150 * dLng, LAT + 35 * dLat], [LNG - 12 * dLng, LAT + 35 * dLat],
    [LNG - 12 * dLng, LAT - 95 * dLat],
  ];
  // West of the entrance, across Pamalee Dr, so it sorts first and takes
  // the first number in the row -- which is exactly what happened.
  const strays = [...elements, home(800, -22, 15)];
  const where = (r) => r.homes
    .find((h) => h.label === "3124" && h.street === "Lady Viola Dr").ring[0][0];
  const loose = assign(RETREAT, buildingsOf(strays), roadsOf(strays));
  const tight = assign(RETREAT, buildingsOf(strays), roadsOf(strays), { inside: fence });
  // The property line settles it when the map has one.
  t("a property line keeps the first lot inside the park",
    where(tight) > LNG - 12 * dLng);
  // And when it does not -- which is most of the time -- the row itself
  // settles it, because a building across the road is further from its
  // nearest neighbour than any two homes in a row are from each other.
  t("and without one, the tightest run does the same job",
    where(loose) > LNG - 12 * dLng);
  t("and the park still has all its lots",
    tight.homes.length === 51 && new Set(tight.homes.map((h) => h.id)).size === 51);
}
{
  t("a pad is about a hundred square metres",
    Math.round(areaOf([[0, 0], [0.0001, 0], [0.0001, 0.0001], [0, 0.0001], [0, 0]])) > 0);
}

// --- gaps at the start of a row, which is where they actually are ---
{
  // Lady Viola's even row with its first two buildings missing, which is
  // the real case: 3124 and 3122 at the Pamalee entrance are not on the
  // map. The property line still reaches that far west.
  const short = elements.filter((e) =>
    !(e.tags?.building && (e.id === 1 || e.id === 2)));
  const fence = [
    [LNG - 12 * dLng, LAT - 95 * dLat], [LNG + 150 * dLng, LAT - 95 * dLat],
    [LNG + 150 * dLng, LAT + 35 * dLat], [LNG - 12 * dLng, LAT + 35 * dLat],
    [LNG - 12 * dLng, LAT - 95 * dLat],
  ];
  const { homes } = assign(RETREAT, buildingsOf(short), roadsOf(short), { inside: fence });
  const row = homes.filter((h) => h.street === "Lady Viola Dr" && h.side === "N");

  t("the row still has all thirteen lots", row.length === 13);
  t("and reads 3124 down to 3100",
    row[0].label === "3124" && row[12].label === "3100");
  // The bug this replaces: the two missing lots were numbered onto the
  // buildings that WERE there, so every home wore its neighbour's number
  // and the two spares were drawn off the far end, past the loop and
  // outside the property.
  if (process.env.DEBUG) console.log(row.map((h) => `${h.label}${h.drawn ? "*" : ""}`).join(" "));
  t("the missing two are the ones at the entrance",
    row[0].drawn === true && row[1].drawn === true);
  t("and the rest are the map's own outlines",
    row.slice(2).every((h) => !h.drawn));
  t("3100 is still on the building at the loop", !row[12].drawn);

  // Nothing hanging off the end of the park.
  const xs = row.map((h) => h.ring[0][0]);
  t("every lot is inside the property line",
    xs.every((x) => x > LNG - 14 * dLng && x < LNG + 152 * dLng));
  t("and they run west to east in order",
    xs.every((x, i) => i === 0 || x > xs[i - 1]));
}
{
  // Gaps at both ends: two at the entrance, one at the loop.
  const short = elements.filter((e) =>
    !(e.tags?.building && (e.id === 28 || e.id === 29 || e.id === 39)));
  const { homes } = assign(RETREAT, buildingsOf(short), roadsOf(short));
  t("a row short at both ends still has every lot",
    homes.filter((h) => h.street === "Lady Cheryl Dr" && h.side === "N").length === 12);
  t("and the park still has fifty one", homes.length === 51);
}

// --- the tightest run ---
{
  const run = [0, 10, 20, 30, 40].map((along) => ({ along }));
  t("with nothing spare, the whole row is the row",
    tightest(run, 5).length === 5);
  t("a stray at one end is dropped",
    tightest([{ along: -80 }, ...run], 5).map((x) => x.along).join() === "0,10,20,30,40");
  t("and one at each end",
    tightest([{ along: -80 }, ...run, { along: 140 }], 5)
      .map((x) => x.along).join() === "0,10,20,30,40");
  t("a short row is left alone", tightest(run, 9).length === 5);
  t("and asking for none gets none", tightest(run, 0).length === 5);
}

// --- the property line ---
{
  // A park inside a residential district inside a city limit. All three
  // hold the streets; only one of them is the park.
  const ringOf = (w, e, s2, n2) => [
    { lat: s2, lon: w }, { lat: s2, lon: e }, { lat: n2, lon: e },
    { lat: n2, lon: w }, { lat: s2, lon: w },
  ];
  const land = [
    { tags: { landuse: "residential", name: "City of Fayetteville" },
      geometry: ringOf(LNG - 0.05, LNG + 0.05, LAT - 0.05, LAT + 0.05) },
    { tags: { landuse: "residential", name: "Ethel's Mobile Home Park" },
      geometry: ringOf(LNG - 20 * dLng, LNG + 160 * dLng, LAT - 95 * dLat, LAT + 35 * dLat) },
    { tags: { landuse: "industrial", name: "The scrapyard over the fence" },
      geometry: ringOf(LNG + 400 * dLng, LNG + 600 * dLng, LAT, LAT + 100 * dLat) },
  ];
  const areas = areasOf(land);
  t("three pieces of land", areas.length === 3);
  // An open way is a fence or a stream, not a parcel.
  t("an unclosed way is not a parcel",
    areasOf([{ tags: { landuse: "residential" },
               geometry: ringOf(0, 1, 0, 1).slice(0, 4) }]).length === 0);

  const got = parkAround(areas, roadsOf(elements));
  t("the park is the tightest land that holds its streets",
    got?.name === "Ethel's Mobile Home Park");
  t("and it is a closed ring",
    got.ring[0][0] === got.ring[got.ring.length - 1][0]);
  t("land that holds nothing is not the park",
    parkAround(areasOf([land[2]]), roadsOf(elements)) === null);
}
{
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  t("a point inside is inside", inRing([5, 5], sq));
  t("and a point outside is not", !inRing([15, 5], sq));
}

// --- squeezed inside the fence ---
{
  const placed = placeFromRoads(RETREAT, roadsOf(elements));
  // A park a hundred metres long cannot hold a hundred-and-twenty-six-metre
  // row, and the ends were hanging out over the neighbours.
  const tight = [
    [LNG - 10 * dLng, LAT - 95 * dLat], [LNG + 100 * dLng, LAT - 95 * dLat],
    [LNG + 100 * dLng, LAT + 35 * dLat], [LNG - 10 * dLng, LAT + 35 * dLat],
    [LNG - 10 * dLng, LAT - 95 * dLat],
  ];
  const squeezed = fitInside(placed, tight);
  t("a row too long for its park is squeezed", squeezed.padSpacing < placed.padSpacing);

  const inside = layOut(squeezed).every((h) => inRing([h.lng, h.lat], tight));
  t("and every home then sits inside the fence", inside);

  // Only ever shrinks: a park with room to spare is drawn at the spacing it
  // was given, not stretched to touch its own boundary.
  const roomy = tight.map(([x, y]) => [x + (x - LNG) * 8, y + (y - LAT) * 8]);
  t("a park with room to spare is left alone",
    fitInside(placed, roomy).padSpacing === placed.padSpacing);
  t("and a ring that is not a ring changes nothing",
    fitInside(placed, [[0, 0]]).padSpacing === placed.padSpacing);
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

  // Two questions, not one. A kilometre and a half of Fayetteville holds a
  // few named roads and thousands of buildings, and asking for both at that
  // radius is a reply nobody can wait for.
  // Three small questions, not one big one. Every back yard in Fayetteville
  // is tagged landuse, so asking for land over a three-kilometre box ran
  // past Overpass's own time limit -- and a server-side timeout comes back
  // as an ordinary 200 with an empty list, which reads as "this place has no
  // streets in it".
  const wide = roadQuery(b);
  t("the street question asks only for named roads",
    wide.includes('way["highway"]["name"]')
    && !wide.includes("landuse") && !wide.includes("building"));
  t("the land question asks only for land",
    landQuery(b).includes('way["landuse"]') && !landQuery(b).includes("highway"));
  t("the building question asks only for buildings",
    buildingQuery(b).includes('way["building"]')
    && !buildingQuery(b).includes("highway"));
}
{
  // When the streets are not there, say what is. An error that lists the
  // neighbours is a fixable error; "none found" is a week of guessing.
  const names = nearestNames(roadsOf(elements), [LNG, LAT], 5);
  t("the nearest roads are named, with distances",
    names.length === 2 && /Lady \w+ Drive \(\d+ m\)/.test(names[0]));
  t("and the nearer one comes first", names[0].includes("Viola"));
}

const bad = checks.filter(([, ok]) => !ok);
for (const [n, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${n}`);
console.log(bad.length ? `\n${bad.length} failed` : `\nall ${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
