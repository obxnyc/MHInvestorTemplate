/** The park laid out along its own streets.
 *  Run: node lib/__fixtures__/rows.test.mjs */
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
  foot: join(here, "..", ".r.footprint.gen.mjs"),
  plan: join(here, "..", ".r.parkplan.gen.mjs"),
  osm: join(here, "..", ".r.osm.gen.mjs"),
  rows: join(here, "..", ".r.gen.mjs"),
};
writeFileSync(gen.foot, transpile("footprint.ts"));
writeFileSync(gen.plan, transpile("parkplan.ts")
  .replace(/(["'])\.\/footprint\1/g, '"./.r.footprint.gen.mjs"'));
writeFileSync(gen.osm, transpile("osm.ts")
  .replace(/(["'])\.\/footprint\1/g, '"./.r.footprint.gen.mjs"')
  .replace(/(["'])\.\/parkplan\1/g, '"./.r.parkplan.gen.mjs"'));
writeFileSync(gen.rows, transpile("rows.ts")
  .replace(/(["'])\.\/footprint\1/g, '"./.r.footprint.gen.mjs"')
  .replace(/(["'])\.\/parkplan\1/g, '"./.r.parkplan.gen.mjs"')
  .replace(/(["'])\.\/osm\1/g, '"./.r.osm.gen.mjs"'));
let layRows, clipTo, westToEast, walk, lengthOf, densify, reachTo;
let RETREAT, metresBetween, inRing, centroid, areaOf;
try {
  ({ layRows, clipTo, westToEast, walk, lengthOf, densify, reachTo } = await import(gen.rows));
  ({ RETREAT } = await import(gen.plan));
  ({ metresBetween } = await import(gen.foot));
  ({ inRing, centroid, areaOf } = await import(gen.osm));
} finally {
  for (const f of Object.values(gen)) unlinkSync(f);
}

const checks = [];
const t = (n, ok) => checks.push([n, ok]);
const near = (a, b, e = 0.5) => Math.abs(a - b) < e;

const LAT = 35.09249, LNG = -78.91932;
const dLat = 1 / 111_320;
const dLng = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
const at = (m, c) => [LNG + m * dLng, LAT + c * dLat];

// Two streets running east, Lady Cheryl 57 m south of Lady Viola, both
// traced well past the park at each end -- which is how OpenStreetMap has
// them, because a street does not stop at a property line.
const roads = [
  { name: "Lady Viola Drive", line: [-80, 0, 60, 130, 220].map((m) => at(m, 0)) },
  { name: "Lady Cheryl Drive", line: [-80, 0, 60, 130, 220].map((m) => at(m, -57)) },
];
const parcel = [
  at(-10, 35), at(150, 35), at(150, -95), at(-10, -95), at(-10, 35),
];

// --- the whole park ---
{
  const pads = layRows(RETREAT, roads, parcel);
  t("fifty one lots", pads.length === 51);
  t("every one with its own id", new Set(pads.map((p) => p.id)).size === 51);
  t("and every one the same rectangle", (() => {
    const a = pads.map((p) => areaOf(p.ring));
    return Math.max(...a) - Math.min(...a) < 0.5;
  })());
  // The thing that has been wrong in every version: a lot outside the
  // fence. There is nowhere for one to go now.
  t("all of them inside the property line",
    pads.every((p) => inRing(centroid(p.ring), parcel)));
}

// --- the numbering, in the order the county map reads ---
{
  const pads = layRows(RETREAT, roads, parcel);
  const row = (street, side) => pads.filter((p) => p.street === street && p.side === side);

  const vn = row("Lady Viola Dr", "N");
  t("Lady Viola's even row starts at the entrance with 3124",
    vn[0].label === "3124" && vn[vn.length - 1].label === "3100");
  t("and 3124 really is the western one",
    centroid(vn[0].ring)[0] < centroid(vn[vn.length - 1].ring)[0]);
  t("3122 is next, not somewhere past the loop", vn[1].label === "3122");

  const vs = row("Lady Viola Dr", "S");
  t("the office is at the entrance on the odd side",
    vs[0].label === "1808" && vs[1].label === "3123");
  t("and the row runs down to 3101", vs[vs.length - 1].label === "3101");
  const cn = row("Lady Cheryl Dr", "N");
  t("the site address is the first home round on Lady Cheryl",
    cn[0].label === "1800" && cn[1].label === "3122");

  // Odds one side of the road, evens the other, on both streets.
  const odd = (p) => Number(p.label) % 2 === 1;
  for (const street of ["Lady Viola Dr", "Lady Cheryl Dr"]) {
    t(`${street} has the evens on one side`,
      row(street, "N").filter((p) => Number(p.label) > 3000).every((p) => !odd(p)));
    t(`${street} has the odds on the other`,
      row(street, "S").filter((p) => Number(p.label) > 3000).every(odd));
  }
}

// --- evenly spaced, and on the right side of the road ---
{
  const pads = layRows(RETREAT, roads, parcel);
  for (const [street, side] of [
    ["Lady Viola Dr", "N"], ["Lady Viola Dr", "S"],
    ["Lady Cheryl Dr", "N"], ["Lady Cheryl Dr", "S"],
  ]) {
    const row = pads.filter((p) => p.street === street && p.side === side);
    const cs = row.map((p) => centroid(p.ring));
    const gaps = cs.slice(1).map((c, i) => metresBetween(cs[i], c));
    t(`${street} ${side} is evenly spaced`,
      Math.max(...gaps) - Math.min(...gaps) < 0.2);
    t(`${street} ${side} runs west to east`,
      cs.every((c, i) => i === 0 || c[0] > cs[i - 1][0]));
  }
  const north = pads.filter((p) => p.street === "Lady Viola Dr" && p.side === "N");
  const south = pads.filter((p) => p.street === "Lady Viola Dr" && p.side === "S");
  t("the even row is north of the street",
    centroid(north[0].ring)[1] > LAT);
  t("and the odd row is south of it",
    centroid(south[0].ring)[1] < LAT);
}

// --- the street, trimmed to the park ---
{
  // The regression this replaces. A street is not a dense line:
  // OpenStreetMap traces a straight road as two points a few hundred
  // metres apart, so a road crossing the whole park can have no vertex
  // inside it at all. Keeping the vertices that fall inside then left a
  // stub a few metres long, and fifty one pads went in a heap in the
  // corner of the park.
  const sparse = [at(-300, 0), at(400, 0)];
  const kept = clipTo(sparse, parcel);
  t("a street with no vertex inside is still clipped to the park",
    lengthOf(kept) > 100 && lengthOf(kept) < 180);
  t("and what is kept is inside", kept.every((p) => inRing([p[0], p[1]], parcel)));

  const pads = layRows(RETREAT, [
    { name: "Lady Viola Drive", line: sparse },
    { name: "Lady Cheryl Drive", line: [at(-300, -57), at(400, -57)] },
  ], parcel);
  t("so the rows fill the park rather than piling up in a corner",
    pads.length === 51 && pads.every((p) => inRing(centroid(p.ring), parcel)));
  const row = pads.filter((p) => p.street === "Lady Viola Dr" && p.side === "N");
  const cs = row.map((p) => centroid(p.ring));
  t("and a row of thirteen spans most of the park",
    metresBetween(cs[0], cs[cs.length - 1]) > 110);
}
{
  const d = densify([at(0, 0), at(100, 0)], 5);
  t("walking a line gives a point every few metres", d.length === 21);
  t("it starts and ends where the line does",
    near(d[0][0], at(0, 0)[0], 1e-9) && near(d[20][0], at(100, 0)[0], 1e-9));
  t("and a line that is already short is left as it is",
    densify([at(0, 0), at(1, 0)], 5).length === 2);
}
{
  const whole = roads[0].line;
  const kept = clipTo(whole, parcel);
  // Measured in metres, not in how many points a volunteer clicked.
  t("the bit of the street outside the park is dropped",
    lengthOf(kept) < lengthOf(whole) - 100);
  t("and what is left is inside", kept.every((p) => inRing([p[0], p[1]], parcel)));
  t("a street with nothing inside is used whole",
    clipTo(whole, [at(500, 500), at(600, 500), at(600, 600), at(500, 600), at(500, 500)])
      .length === whole.length);
  t("and no boundary at all leaves it alone", clipTo(whole, null).length === whole.length);
}
{
  const back = [...roads[0].line].reverse();
  t("a street traced east to west is turned round",
    westToEast(back)[0][0] < westToEast(back)[4][0]);
}

// --- the boundary meeting the road it fronts ---
{
  // Pamalee Drive, running south-west past the entrance, and a parcel
  // traced eight metres shy of it.
  const pamalee = [at(-20, 60), at(-20, -140)];
  const shy = [at(-12, 35), at(150, 35), at(150, -95), at(-12, -95), at(-12, 35)];
  const met = reachTo(shy, pamalee);
  const gap = (ring) => Math.min(...ring.map((p) => Math.abs((p[0] - at(-20, 0)[0]) / dLng)));
  t("the corners nearly on the road are put on it", gap(met) < 0.5);
  t("it is still a closed ring",
    met[0][0] === met[met.length - 1][0] && met[0][1] === met[met.length - 1][1]);
  t("and the far side is left where it was",
    near((met[1][0] - at(150, 35)[0]) / dLng, 0, 0.001));

  // The notch at the entrance is a real step back in the deed. Reaching
  // too far would iron it flat and lose the one feature of this boundary
  // anybody would recognise.
  const notched = [
    at(-12, 35), at(150, 35), at(150, -95), at(-12, -95),
    at(-12, -40), at(30, -40), at(30, -10), at(-12, -10), at(-12, 35),
  ];
  const kept = reachTo(notched, pamalee);
  t("a step back further than the reach survives",
    kept.some((p) => near((p[0] - at(30, 0)[0]) / dLng, 0, 0.5)));
}

// --- following a bend ---
{
  // A street that turns south halfway along. Interpolating between the two
  // ends would cut the corner and put half the row in the field.
  const bent = [at(0, 0), at(60, 0), at(100, -40)];
  t("length follows the bend, it does not cut it",
    near(lengthOf(bent), 60 + Math.hypot(40, 40), 1));
  const mid = walk(bent, 60);
  t("sixty metres along is the corner", near(mid.point[0], at(60, 0)[0], 1e-7));
  const past = walk(bent, 80);
  t("and past it the row has turned", past.bearing > 100 && past.bearing < 160);
}

const bad = checks.filter(([, ok]) => !ok);
for (const [n, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${n}`);
console.log(bad.length ? `\n${bad.length} failed` : `\nall ${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
