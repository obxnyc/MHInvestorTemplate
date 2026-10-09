/**
 * Every lot inside the park's own deed line.
 *
 * 1140 Northside Rd shipped with fifty-nine numbered pads strung out in
 * two rows running a couple of hundred metres past the property line and
 * across a neighbouring field. On a plain basemap that looks like a park
 * -- tidy rows, numbers in order, homes all parallel -- and it is only
 * wrong if you happen to notice the blue line it crosses. Nothing in the
 * suite asked.
 *
 *     node lib/__fixtures__/inside-check.mjs
 *
 * So: a park the size of the real one, with the spacing deliberately far
 * too wide, and the question the owner was actually asking -- does
 * pressing the button put them all back inside?
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of ["footprint", "parkplan", "osm"]) {
  const src = readFileSync(join(here, `${f}.ts`), "utf8").replace(/^import type .*$/gm, "");
  writeFileSync(join(here, `${f}.gen.mjs`),
    ts.transpileModule(src, { compilerOptions: { target: 99, module: 99 } }).outputText
      .replace(/from "\.\/(\w+)"/g, `from "${join(here, "$1.gen.mjs")}"`));
}
const { layOut } = await import(join(here, "parkplan.gen.mjs"));
const { fitInside, inRing } = await import(join(here, "osm.gen.mjs"));
const { degreesPerMetre, SINGLE_WIDE } = await import(join(here, "footprint.gen.mjs"));

// Measured off Pasquotank's own georeferenced aerial, not read off a
// screenshot by eye -- which is how this park once came to be drawn four
// kilometres from where it stands.
const CENTRE = [-76.28638, 36.37140];
const BEARING = 177.8;
const LOOP = 278;            // metres, end to end
const ACROSS = 45;           // metres between the two carriageways
const LOTS = 59;

/**
 * A parcel round the park: 12.48 acres, the long way along the loop.
 *
 * `shift` slides it along the rows, because the street a row hangs from
 * is traced from wherever the map happens to start it -- which is not
 * the middle of the park. A parcel sharing the plan's own centre makes
 * the re-centring step untestable, since it has nothing to do.
 */
function parcel(long = LOOP + 60, wide = 150, shift = 0) {
  const per = degreesPerMetre(CENTRE[1]);
  const r = (BEARING * Math.PI) / 180;
  // Along the rows, and across them.
  const a = [Math.sin(r), Math.cos(r)];
  const b = [Math.cos(r), -Math.sin(r)];
  const at = (u, v) => [
    CENTRE[0] + (a[0] * u + b[0] * v) * per.lng,
    CENTRE[1] + (a[1] * u + b[1] * v) * per.lat,
  ];
  const ring = [
    at(shift - long / 2, -wide / 2), at(shift + long / 2, -wide / 2),
    at(shift + long / 2, wide / 2), at(shift - long / 2, wide / 2),
  ];
  return [...ring, ring[0]];
}

const ACRE = 4046.8564;
function acres(ring) {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const k = Math.cos((lat0 * Math.PI) / 180) * 111320;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    a += (x1 * k) * (y2 * 111320) - (x2 * k) * (y1 * 111320);
  }
  return Math.abs(a) / 2 / ACRE;
}

/** The park as the screen had it: two rows, and far too much room between. */
function spread(padSpacing) {
  const half = Math.ceil(LOTS / 2);
  return {
    name: "The Retreat", naming: "lot", address: "1140 Northside Rd",
    centre: [...CENTRE], bearing: BEARING, size: SINGLE_WIDE,
    padSpacing, pairGap: ACROSS, streetGap: 60, homeTurn: 0,
    // One street, a row facing it from either side -- which is what the
    // loop is. The sides are N and S because that is what the plan calls
    // them, whichever way the park actually points.
    rows: [
      { street: "1140 Northside Rd", side: "N",
        numbers: Array.from({ length: half }, (_, i) => String(i + 1)) },
      { street: "1140 Northside Rd", side: "S",
        numbers: Array.from({ length: LOTS - half }, (_, i) => String(half + i + 1)) },
    ],
  };
}

const checks = [];
const t = (name, ok, why) => checks.push([name, ok, why]);

const ring = parcel();
t(`the test parcel is about the size of the real one (${acres(ring).toFixed(2)} acres)`,
  Math.abs(acres(ring) - 12.48) < 2.5,
  "A toy parcel would make this check pass on a park that does not fit.");

// The spacing the screen was drawing at: wide enough to run the rows
// clean out of the far end of the deed.
const loose = spread(LOOP / (Math.ceil(LOTS / 2) - 1) * 2.4);
const outBefore = layOut(loose).filter((h) => !inRing([h.lng, h.lat], ring)).length;
t(`the loose park really does run outside (${outBefore} of ${LOTS})`,
  outBefore > LOTS / 4,
  "If nothing is outside to begin with, this check is testing nothing.");

const fitted = fitInside(loose, ring);
const after = layOut(fitted);
const outAfter = after.filter((h) => !inRing([h.lng, h.lat], ring)).length;
t("fitting brings every lot inside the line", outAfter === 0,
  `${outAfter} of ${LOTS} are still outside after fitting.`);
t("and all of them are still there", after.length === LOTS);
t("the numbers are still in order",
  after.slice(0, Math.ceil(LOTS / 2)).every((h, i) => h.label === String(i + 1)));

// The homes are the same model, so the pads stay rungs on a ladder.
const turns = [...new Set(after.map((h) => Math.round(h.bearing)))];
t(`every home stays parallel (${turns.length} angle${turns.length === 1 ? "" : "s"})`,
  turns.length === 1);

// Only ever shrinks. A park with room to spare is drawn at the spacing it
// was given, not stretched until it touches its own fence.
const roomy = spread(6);
const kept = fitInside(roomy, ring);
t("a park that already fits keeps its spacing",
  Math.abs(kept.padSpacing - roomy.padSpacing) < 1e-9,
  `spacing went from ${roomy.padSpacing} to ${kept.padSpacing}`);

// And it is centred in the park, not hung off whichever end the street
// happened to be traced from. Tested against a parcel that does NOT
// share the plan's centre, or the step has nothing to do and the check
// passes however broken it is.
const SHIFT = 70;
const askew = parcel(LOOP + 60, 150, SHIFT);
const put = fitInside(spread(LOOP / (Math.ceil(LOTS / 2) - 1) * 2.4), askew);
{
  const per = degreesPerMetre(CENTRE[1]);
  const r = (BEARING * Math.PI) / 180;
  const dx = (put.centre[0] - CENTRE[0]) / per.lng;
  const dy = (put.centre[1] - CENTRE[1]) / per.lat;
  // Back into along-the-rows and across-them.
  const along = dx * Math.sin(r) + dy * Math.cos(r);
  const across = dx * Math.cos(r) - dy * Math.sin(r);
  t(`the rows move up to meet an off-centre parcel (${along.toFixed(1)} m along,`
    + ` wanted ${SHIFT})`,
    Math.abs(along - SHIFT) < 8,
    "Fitting that shrinks but does not re-centre leaves the park against "
    + "one end of its own deed.");
  t("and do not drift sideways doing it", Math.abs(across) < 1,
    `${across.toFixed(1)} m across`);
  t("every lot is inside the off-centre parcel too",
    layOut(put).every((h) => inRing([h.lng, h.lat], askew)));
}

// --- a fit that overlaps the pads is not a fit ----------------------
//
// Fifty-nine pads squeezed into room for thirty drew as one grey smear.
// Every number was present and in order, so nothing in the suite
// objected -- and nothing on screen could be taken hold of, because you
// cannot grab what you cannot tell apart.
const { metresBetween } = await import(join(here, "footprint.gen.mjs"));
function tightest(p) {
  const by = new Map();
  for (const h of layOut(p)) {
    const key = `${h.street}|${h.side}`;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(h);
  }
  let least = Infinity;
  for (const row of by.values()) {
    for (let i = 1; i < row.length; i++) {
      least = Math.min(least, metresBetween(
        [row[i - 1].lng, row[i - 1].lat], [row[i].lng, row[i].lat]));
    }
  }
  return least;
}
// Square to the row, so a pad takes up its own width along it.
const ROOM = SINGLE_WIDE.width;
t(`fitted pads do not overlap (${tightest(fitted).toFixed(1)} m apart,`
  + ` ${ROOM.toFixed(1)} m wide)`,
  tightest(fitted) >= ROOM,
  "Pads closer together than they are wide are drawn on top of each "
  + "other, and a smear cannot be dragged.");

{
  // A parcel far too small for the park: the fit must refuse to squeeze
  // rather than produce a smear that fits.
  const tiny = parcel(70, 150);
  const squashed = fitInside(spread(LOOP / (Math.ceil(LOTS / 2) - 1) * 2.4), tiny);
  t(`a park that cannot fit still keeps its pads apart`
    + ` (${tightest(squashed).toFixed(1)} m)`,
    tightest(squashed) >= ROOM,
    "It used to shrink to a fifth of the spacing it was given, whatever "
    + "that did to the drawing.");
  const over = layOut(squashed).filter((h) => !inRing([h.lng, h.lat], tiny)).length;
  t(`and lets the overflow show instead (${over} outside)`, over > 0,
    "A row that will not fit has to say so. The screen counts these and "
    + "says the number above the map.");
}

// --- and the rules the arithmetic cannot see ------------------------
const screen = readFileSync(join(here, "../components/ParkScreen.tsx"), "utf8");
const board = readFileSync(join(here, "../components/PropertyBoard.tsx"), "utf8");

t("fitting inside the line is a button, not only a side effect",
  /remember\(fitInside\(plan, plan\.fence \?\? \[\]\)\);/.test(screen)
  && />\s*\n?\s*Fit inside the boundary\s*\n?\s*<\/button>/.test(screen),
  "It used to happen only on the way back from the county lookup, which "
  + "is a path a park takes once -- so a park whose line arrived any "
  + "other way had no way to ask.");

t("and the screen says when lots are outside the line",
  /lots are drawn outside the\s*\n?\s*property line/.test(screen),
  "A park drawn past its own deed looks like a park. It is only wrong "
  + "if you happen to notice the blue line.");

t("rows put down by hand are not quietly re-fitted",
  /These rows were put down by hand/.test(screen)
  && /if \(plan\.rows\.some\(placedRow\)\) \{/.test(screen),
  "Fitting changes the spacing, and a placed row does not have one -- so "
  + "the button would report success and move nothing.");

t("the properties list starts with nothing open",
  /const \[open, setOpen\] = useState<string \| null>\(null\);/.test(board),
  "Opening whichever park sorts first answers a question the list exists "
  + "to ask, and it came back open on every visit.");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : "\nnothing obviously wrong");
process.exit(failed ? 1 : 0);
