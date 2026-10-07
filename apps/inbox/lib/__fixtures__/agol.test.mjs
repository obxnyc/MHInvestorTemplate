/** Reading a park out of a county map. No network: every function here is
 *  pure. Run: node lib/__fixtures__/agol.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(readFileSync(join(here, "..", "agol.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { appIdFrom, numberField, houseNumber, boxAround, toFractions, mostLikelyFirst,
        inRing, inShape, parcelLayers } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (n, ok) => checks.push([n, ok]);
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;

// --- the link somebody pastes ---
const LINK = "https://www.arcgis.com/apps/webappviewer/index.html?id=a6ea68995c2349e9a177366288589be7";
t("the id comes out of a webappviewer link",
  appIdFrom(LINK) === "a6ea68995c2349e9a177366288589be7");
t("and out of an appid= link",
  appIdFrom("https://x.maps.arcgis.com/apps/instant/basic/index.html?appid=38fc8f0292b04ba0a300f801f17ae902")
    === "38fc8f0292b04ba0a300f801f17ae902");
t("a bare id is an id", appIdFrom("a6ea68995c2349e9a177366288589be7").length === 32);
t("a link with no id in it gives nothing", appIdFrom("https://example.com/map") === null);

// --- finding the field with the mailbox number in it ---
t("HOUSE_NUM", numberField(["OBJECTID", "HOUSE_NUM", "ST_NAME"]) === "HOUSE_NUM");
t("ADDRNUM", numberField(["ADDRNUM", "STREET"]) === "ADDRNUM");
t("SITE_ADDRESS when that is all there is",
  numberField(["OBJECTID", "SITE_ADDRESS"]) === "SITE_ADDRESS");
// A parcel layer has owners and acreage and no number -- it is not the layer
// we want, and saying so is better than picking the nearest thing.
t("a parcel layer has no number field",
  numberField(["OBJECTID", "OWNER", "ACREAGE", "PIN"]) === null);

// --- the number itself ---
t("a bare number", houseNumber("3107") === "3107");
t("a number with the street after it", houseNumber("3107 LADY CHERYL DR") === "3107");
t("a unit letter does not change the lot", houseNumber("3107-A") === "3107");
t("nothing in, nothing out", houseNumber(null) === null && houseNumber("") === null);
t("a street with no number is not a lot", houseNumber("LADY VIOLA DR") === null);

// --- the search box ---
{
  const b = boxAround(35.09, -78.93, 250);
  t("the box is centred on the park",
    near((b.xmin + b.xmax) / 2, -78.93) && near((b.ymin + b.ymax) / 2, 35.09));
  // Degrees of longitude are shorter this far north, so a square on the
  // ground is not a square in degrees. Getting this wrong makes the box
  // narrow and drops half a street.
  t("longitude is widened for the latitude",
    (b.xmax - b.xmin) > (b.ymax - b.ymin));
}

// --- where each lot lands on the plan ---
{
  // Four homes: one north-west, one north-east, one south-west, one
  // south-east. Coordinates chosen so the answers are unambiguous.
  const found = [
    { label: "NW", lat: 35.10, lng: -78.94 },
    { label: "NE", lat: 35.10, lng: -78.92 },
    { label: "SW", lat: 35.08, lng: -78.94 },
    { label: "SE", lat: 35.08, lng: -78.92 },
  ];
  const out = Object.fromEntries(toFractions(found).map((l) => [l.label, l]));

  t("west is left of east", out.NW.x < out.NE.x);
  // The one every map gets wrong once: north is UP on a map and DOWN is
  // positive on a screen. Without the flip the park is drawn upside down and
  // looks plausible until somebody stands in it.
  t("north is ABOVE south on screen", out.NW.y < out.SW.y);
  t("the four corners are the four corners",
    near(out.NW.x, out.SW.x) && near(out.NE.x, out.SE.x)
    && near(out.NW.y, out.NE.y) && near(out.SW.y, out.SE.y));

  // Padded off the edge, so no home sits half outside the plan.
  const all = Object.values(out);
  t("nothing touches the edge",
    all.every((l) => l.x > 0.05 && l.x < 0.95 && l.y > 0.05 && l.y < 0.95));
}
{
  // A park on one street is a line, not a box. Dividing by a zero span is
  // how every lot ends up stacked on one spot.
  const line = toFractions([
    { label: "1", lat: 35.09, lng: -78.94 },
    { label: "2", lat: 35.09, lng: -78.93 },
    { label: "3", lat: 35.09, lng: -78.92 },
  ]);
  t("a single row spreads across and does not collapse",
    line[0].x < line[1].x && line[1].x < line[2].x);
  t("and sits level", near(line[0].y, line[2].y));
}
t("no homes, no positions", toFractions([]).length === 0);
{
  const one = toFractions([{ label: "7", lat: 35.09, lng: -78.93 }]);
  t("one home does not divide by zero",
    one.length === 1 && Number.isFinite(one[0].x) && Number.isFinite(one[0].y));
}

// --- what to try first ---
// Cumberland publishes sixteen years of aerial flights as separate layers.
// The first run spent its entire budget on them and never reached the
// address points, which were there the whole time.
{
  const real = [
    { title: "Imagery · CC2025 6 Inch Resolution", url: "https://x/ImageServer" },
    { title: "Parcels", url: "https://x/MapServer/1" },
    { title: "Street Centerlines", url: "https://x/MapServer/2" },
    { title: "Address Points", url: "https://x/MapServer/3" },
    { title: "Building Footprints", url: "https://x/MapServer/4" },
  ];
  const order = mostLikelyFirst(real).map((l) => l.title);
  t("address points are tried first", order[0] === "Address Points");
  t("then buildings, which usually carry the number too",
    order[1] === "Building Footprints");
  t("then parcels, which sometimes carry a situs address", order[2] === "Parcels");
  // Not excluded -- a county might surprise us -- but last, behind everything
  // that could plausibly answer.
  t("street centrelines come last", order[order.length - 1] === "Street Centerlines");
}

// --- inside the parcel, or the neighbours' ---
// "Within 250 metres" swept in Capri Street and Rosemary Drive and came back
// with eighty-five lots for a park that has twenty-eight. The parcel boundary
// is the real answer.
{
  const square = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
  t("a point in the middle is inside", inRing(5, 5, square));
  t("a point outside is outside", inRing(15, 5, square) === false);
  t("and so is one just past the edge", inRing(5, 10.5, square) === false);
  // A vertex exactly level with the point must not be counted twice, which
  // is the classic way this test silently inverts.
  t("a point level with a vertex is still judged correctly",
    inRing(10, 5, square) === false && inRing(0, 5, square) === true);
}
{
  // A parcel with a right of way through it. A home in the hole is not on
  // the parcel.
  const withHole = {
    type: "Polygon",
    coordinates: [
      [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]],
      [[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]],
    ],
  };
  t("inside the parcel counts", inShape(2, 2, withHole));
  t("inside a hole does not", inShape(5, 5, withHole) === false);
  t("outside altogether does not", inShape(20, 20, withHole) === false);
}
{
  // A park split either side of a road is two polygons, and both are ours.
  const two = {
    type: "MultiPolygon",
    coordinates: [
      [[[0, 0], [0, 5], [5, 5], [5, 0], [0, 0]]],
      [[[10, 10], [10, 15], [15, 15], [15, 10], [10, 10]]],
    ],
  };
  t("both halves of a split parcel count",
    inShape(2, 2, two) && inShape(12, 12, two));
  t("the gap between them does not", inShape(7, 7, two) === false);
}
t("nothing in, nothing inside", inShape(1, 1, null) === false);

{
  // Cumberland publishes several things with "parcel" in the name that are
  // not the parcel boundary.
  const all = [
    { title: "Parcels", url: "a" },
    { title: "Voluntary Agriculture Districts · Vol_Ag_Dist_Parcels", url: "b" },
    { title: "Voluntary Agriculture Districts · Vol_Ag_Parcels_Buffer", url: "c" },
    { title: "Mineral Rights Parcels", url: "d" },
    { title: "Zoning", url: "e" },
  ];
  const picked = parcelLayers(all).map((l) => l.title);
  t("the real parcel layer is kept", picked.includes("Parcels"));
  t("agriculture districts are not parcels", !picked.some((p) => /Vol_Ag/.test(p)));
  t("nor are buffers", !picked.some((p) => /Buffer/.test(p)));
  t("nor mineral rights", !picked.some((p) => /Mineral/.test(p)));
}

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
