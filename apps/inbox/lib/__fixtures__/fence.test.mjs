/** Is somebody actually on the property?  Run: node lib/__fixtures__/fence.test.mjs
 *
 *  Almost every check here is about the third answer. Inside and outside are
 *  arithmetic; "cannot tell" is the one a naive distance test never gives,
 *  and it is the common case on a phone indoors -- which is where a labourer
 *  clocking in actually stands.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "fence.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { readFix, whichSite, metresBetween, defaultRadius, DEFAULT_RADIUS, TOO_VAGUE } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

// 3124 Lady Viola Dr, Fayetteville, near enough.
const HOUSE = { propertyId: "h", name: "1012 Chason St", lat: 35.1012, lng: -78.9612, radius: 75 };
const PARK = { propertyId: "p", name: "The Retreat", lat: 35.1210, lng: -78.9410, radius: 250 };

/** A point `m` metres due north of a fence's pin. */
const north = (fence, m, accuracy = 10) =>
  ({ lat: fence.lat + m / 111_320, lng: fence.lng, accuracy });

// ---- the arithmetic ----
t("a hundred metres north is a hundred metres away",
  () => Math.abs(metresBetween(HOUSE, north(HOUSE, 100)) - 100) < 1);
t("the pin is nought metres from itself",
  () => metresBetween(HOUSE, HOUSE) < 0.001);

// ---- inside and outside, when the fix is good enough to say ----
t("standing on the pin with a good fix is inside",
  () => readFix(north(HOUSE, 0, 5), HOUSE).verdict === "inside");
t("forty metres out with a five metre fix is inside",
  () => readFix(north(HOUSE, 40, 5), HOUSE).verdict === "inside");
t("four hundred metres out with a five metre fix is outside",
  () => readFix(north(HOUSE, 400, 5), HOUSE).verdict === "outside");
t("and it says how far", () =>
  Math.abs(readFix(north(HOUSE, 400, 5), HOUSE).metres - 400) < 2);

// ---- the error bar, which is the whole point ----
// A fix accurate to 200m, 150m from a 75m fence. The naive test says OUTSIDE,
// confidently, with somebody's wages on the other end of it. The handset
// could easily be in the kitchen.
const indoors = readFix(north(HOUSE, 150, 200), HOUSE);
t("a vague fix near a small fence cannot tell", () => indoors.verdict === "unsure");
t("and says why in metres", () => /give or take 200m/.test(indoors.because));
t("the same distance with a good fix IS outside",
  () => readFix(north(HOUSE, 150, 8), HOUSE).verdict === "outside");

// Inside needs the WHOLE error circle inside the fence. 40m from the pin of a
// 75m fence, accurate to 50m, could be 90m away.
t("a fix whose error reaches past the fence is not called inside",
  () => readFix(north(HOUSE, 40, 50), HOUSE).verdict === "unsure");
t("the same spot with a tight fix is inside",
  () => readFix(north(HOUSE, 40, 5), HOUSE).verdict === "inside");

// ---- no accuracy is not accuracy of nought ----
// A device that did not say how sure it is has not said it is certain.
t("a fix with no accuracy cannot tell",
  () => readFix({ ...north(HOUSE, 10), accuracy: null }, HOUSE).verdict === "unsure");
t("and says the phone did not say", () =>
  /did not say how accurate/.test(readFix({ ...north(HOUSE, 10), accuracy: null }, HOUSE).because));
t("a fix accurate to a kilometre cannot tell",
  () => readFix(north(HOUSE, 10, 1000), HOUSE).verdict === "unsure");
t("and that holds even standing on the pin",
  () => readFix(north(HOUSE, 0, 1000), HOUSE).verdict === "unsure");
t("the vagueness threshold is the one the screen quotes", () => TOO_VAGUE === 500);
// On a 75m fence the error-bar rule already refuses a kilometre-wide fix, so
// the two lines above pass with the vagueness rule deleted and prove nothing.
// What it is actually for is a big fence: a handset accurate to a kilometre,
// standing on the pin of a 1.5km boundary, is geometrically inside it and
// tells you nothing about whether anybody is on site.
const HUGE = { propertyId: "x", name: "A very large parcel",
               lat: 35.10, lng: -78.96, radius: 1500 };
t("a kilometre-wide fix inside a kilometre-wide fence still cannot tell",
  () => readFix(north(HUGE, 0, 1000), HUGE).verdict === "unsure");
t("and says it is the accuracy that is the problem",
  () => /only accurate to 1000m/.test(readFix(north(HUGE, 0, 1000), HUGE).because));
t("a good fix on the same big fence is inside",
  () => readFix(north(HUGE, 200, 15), HUGE).verdict === "inside");

// ---- no fix at all ----
t("no position is unsure, not outside", () => readFix(null, HOUSE).verdict === "unsure");
t("and says the phone gave nothing", () => /gave no position/.test(readFix(null, HOUSE).because));
t("rubbish coordinates are unsure",
  () => readFix({ lat: NaN, lng: 0, accuracy: 5 }, HOUSE).verdict === "unsure");

// ---- a park is not a house ----
t("a hundred and fifty metres into a park is inside it",
  () => readFix(north(PARK, 150, 10), PARK).verdict === "inside");
t("the same hundred and fifty metres at a house is not",
  () => readFix(north(HOUSE, 150, 10), HOUSE).verdict === "outside");

// ---- which site, for tagging the hours ----
const FAR = { propertyId: "f", name: "Elsewhere", lat: 36.3, lng: -76.2, radius: 75 };
const one = whichSite(north(HOUSE, 20, 5), [HOUSE, PARK, FAR]);
t("one fence says inside, so that is the site", () => one.on.fence.propertyId === "h");
t("the ones it ruled out are not offered", () => !one.maybe.some((w) => w.fence.propertyId === "f"));

// Two houses on the same street, or a fence drawn too wide. Picking the
// nearer one files a day's labour against the wrong property -- and an
// unfiled day is recoverable where a misfiled one is not.
const NEXT_DOOR = { ...HOUSE, propertyId: "h2", name: "1014 Chason St",
                    lat: HOUSE.lat + 0.0002 };
const two = whichSite(north(HOUSE, 5, 5), [HOUSE, NEXT_DOOR]);
t("two fences both saying inside is not a site", () => two.on === null);
t("but both are offered so somebody can say which", () => two.maybe.length === 2);
t("nearest first", () => two.maybe[0].fence.propertyId === "h");

t("an unsure reading is never taken as the site",
  () => whichSite(north(HOUSE, 150, 200), [HOUSE]).on === null);
t("but it is still offered as a maybe",
  () => whichSite(north(HOUSE, 150, 200), [HOUSE]).maybe.length === 1);
t("no fix means no site and nothing ruled out",
  () => whichSite(null, [HOUSE, PARK]).on === null
     && whichSite(null, [HOUSE, PARK]).maybe.length === 2);
t("no fences is no site, not a throw", () => whichSite(north(HOUSE, 5), []).on === null);

// ---- the radius table against the real list of kinds ----
// The first version of this invented a `quad` and an `apartment` and left out
// three kinds the codebase has, which would have fallen through to a default
// that is wrong for all three. The two lists are checked against each other
// rather than either being trusted.
const property = readFileSync(join(here, "..", "property.ts"), "utf8");
const KINDS = [...(/export type Kind =([^;]+);/.exec(property)?.[1] ?? "")
  .matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
t("the kinds were found in property.ts at all", () => KINDS.length >= 5);
t("every real kind has a radius", () => KINDS.every((k) => k in DEFAULT_RADIUS));
t("and no radius is given for a kind that does not exist",
  () => Object.keys(DEFAULT_RADIUS).every((k) => KINDS.includes(k)));
t("a park's radius is bigger than a house's",
  () => DEFAULT_RADIUS.mhp > DEFAULT_RADIUS.sfh);
t("an unknown kind still gets something usable", () => defaultRadius("wharf") === 100);
t("and so does no kind at all", () => defaultRadius(null) === 100);

t("a throwing check is named, not fatal", () => { throw new Error("on purpose"); });
if (checks.pop()[0] !== "a throwing check is named, not fatal") {
  console.log("FAIL  the harness does not catch a throwing check");
  process.exit(1);
}

let failed = 0;
for (const [n, ok, note] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${n}${note ? ` (${note})` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
