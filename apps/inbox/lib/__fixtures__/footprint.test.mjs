/** A home as a rectangle on the ground.
 *  Run: node lib/__fixtures__/footprint.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(readFileSync(join(here, "..", "footprint.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { footprint, bearingOf, metresBetween, bearingsForRow, degreesPerMetre, half,
        middleOfRing, SINGLE_WIDE } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (n, ok) => checks.push([n, ok]);
const near = (a, b, e = 0.5) => Math.abs(a - b) < e;

// Pamalee.
const LAT = 35.09249, LNG = -78.91932;

// --- the shape itself ---
{
  const ring = footprint(LAT, LNG, 0);
  t("a closed ring of five points", ring.length === 5);
  t("the last point is the first",
    ring[0][0] === ring[4][0] && ring[0][1] === ring[4][1]);
  // GeoJSON is [lng, lat]. The other way round puts the park in the Indian
  // Ocean, which is at least an obvious failure, but better caught here.
  t("coordinates are lng,lat and not the reverse",
    ring.every(([x, y]) => x < -70 && y > 30 && y < 40));
}
{
  // The thing that makes it a drawing rather than a doodle: it has to be the
  // right size on the ground.
  const ring = footprint(LAT, LNG, 0);
  const width = metresBetween(ring[0], ring[1]);
  const length = metresBetween(ring[1], ring[2]);
  t("it is 16 feet wide", near(width, SINGLE_WIDE.width, 0.05));
  t("and 60 feet long", near(length, SINGLE_WIDE.length, 0.05));
  // A degree of longitude is 111 km at the equator and 91 km here. Using one
  // number for both turns every rectangle into a parallelogram, and the park
  // looks subtly sheared in a way nobody can name.
  t("corners are square, not sheared", (() => {
    const d1 = metresBetween(ring[0], ring[2]);
    const d2 = metresBetween(ring[1], ring[3]);
    return near(d1, d2, 0.05);
  })());
}
{
  // Turned ninety degrees, the width and length swap on the ground.
  const ring = footprint(LAT, LNG, 90);
  t("rotating ninety degrees turns it on its side",
    near(metresBetween(ring[0], ring[1]), SINGLE_WIDE.width, 0.05));
  const turned = footprint(LAT, LNG, 90);
  const flat = footprint(LAT, LNG, 0);
  // Its long axis should now run east-west rather than north-south.
  const spanEW = (r) => Math.abs(Math.max(...r.map((p) => p[0])) - Math.min(...r.map((p) => p[0])));
  t("and its long side now runs east to west", spanEW(turned) > spanEW(flat));
}
{
  const ring = footprint(LAT, LNG, 37);
  t("every corner is the same distance from the middle whatever the angle",
    (() => {
      const d = ring.slice(0, 4).map((p) => metresBetween([LNG, LAT], p));
      return d.every((x) => near(x, d[0], 0.02));
    })());
}

// --- which way is the street ---
t("due east is 90 degrees", near(bearingOf([-78.9, 35.09], [-78.89, 35.09]), 90, 0.5));
t("due north is 0", near(bearingOf([-78.9, 35.09], [-78.9, 35.10]), 0, 0.5));
t("due south is 180", near(bearingOf([-78.9, 35.10], [-78.9, 35.09]), 180, 0.5));

// --- metres between ---
t("a hundred metres reads as a hundred metres", (() => {
  const per = degreesPerMetre(LAT);
  return near(metresBetween([LNG, LAT], [LNG, LAT + 100 * per.lat]), 100, 0.5);
})());

// --- the way a row faces, worked out from the row ---
{
  // Five pads in a line running east. They should all stand across it,
  // facing north or south -- 0 or 180, not 90.
  const per = degreesPerMetre(LAT);
  const row = Array.from({ length: 5 }, (_, i) => ({
    lat: LAT, lng: LNG + i * 12 * per.lng,
  }));
  const bearings = bearingsForRow(row);
  t("every home in a row faces the same way",
    bearings.every((b) => near(b, bearings[0], 1)));
  t("including the ones on the ends, whose neighbours are both one side",
    near(bearings[0], bearings[4], 1));
  t("and stands across the street, not along it",
    near(bearings[0] % 180, 0, 1));
  // A rectangle facing north and one facing south are the same rectangle,
  // so the answer is folded into half a turn. Without that, which of two
  // equidistant neighbours sorted first decided between 0 and 180.
  t("the answer is a half turn, so neighbours cannot disagree",
    bearings.every((b) => b >= 0 && b < 180));
}
{
  // One pad on its own has no row to take an angle from, and guessing is how
  // a single home ends up at a jaunty angle nobody can explain.
  t("a lone home keeps the default", bearingsForRow([{ lat: LAT, lng: LNG }], 42)[0] === 42);
  t("no homes, no bearings", bearingsForRow([]).length === 0);
}
{
  // A row running north-south should face east-west.
  const per = degreesPerMetre(LAT);
  const col = Array.from({ length: 4 }, (_, i) => ({
    lat: LAT + i * 12 * per.lat, lng: LNG,
  }));
  const b = bearingsForRow(col);
  t("a north-south row faces east or west", near(b[0] % 180, 90, 1));
  t("and agrees with itself all the way down",
    b.every((x) => near(x, b[0], 1)));
}

// --- folding an angle into half a turn ---
// The bug this exists for: trigonometry hands back 89.99999 where 90 was
// meant, that folds to 179.99999, and a home at the start of the range ends
// up recorded at the far end of it.
t("just under half a turn snaps to zero", half(179.99999) === 0);
t("and so does just over nothing", half(0.00001) === 0);
t("exactly half a turn is zero", half(180) === 0);
t("a real angle in between is kept", near(half(37.4), 37.4, 0.05));
t("a whole turn is zero", half(360) === 0);
t("a negative angle comes back positive", near(half(-45), 135, 0.05));

// --- the middle of a pad ---
//
// What a drag and an arrow key both start from. A ring closes by
// repeating its first point, and counting that twice pulls the middle a
// metre and a half towards one corner -- which on screen is a home that
// jumps the moment it is touched.
{
  const ring = footprint(LAT, LNG, 0);
  const mid = middleOfRing(ring);
  t("the middle of a pad is where the pad was put",
    near(metresBetween(mid, [LNG, LAT]), 0, 0.01));
  const open = ring.slice(0, 4);
  const mo = middleOfRing(open);
  t("an unclosed ring gives the same answer",
    near(metresBetween(mo, mid), 0, 0.001));
  // The bug this guards: slicing one point off a ring that was never
  // closed drops a real corner.
  const three = [[0, 0], [0, 2], [2, 2]];
  const m3 = middleOfRing(three);
  t("three points are all counted",
    near(m3[0], 2 / 3, 1e-9) && near(m3[1], 4 / 3, 1e-9));
  t("a turned pad still finds its own middle",
    near(metresBetween(middleOfRing(footprint(LAT, LNG, 128)), [LNG, LAT]), 0, 0.01));
  t("nothing is not a shape", middleOfRing(undefined) === null);
  t("nor is a line", middleOfRing([[0, 0], [1, 1]]) === null);
  t("nor is an empty ring", middleOfRing([]) === null);
}

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
