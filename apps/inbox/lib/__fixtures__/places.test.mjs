/** Finding the place you are working.  Run: node lib/__fixtures__/places.test.mjs
 *
 *  The requirement, in the owner's words: "some will know its the retreat and
 *  some will just know they are going to 1140 Northside rd lot 20". Both have
 *  to find the same row, and work on a lot has to be filed against the LOT.
 *
 *  BOTH PARKS HAVE A LOT 20. Without that, "lot 20" has one answer whatever
 *  the matcher does, and a version that ignored the park name entirely would
 *  pass every check in here. The same shape as the fixture that gave each
 *  person one clean match, and the Service Manager orderings before it.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const load = (n) => ts.transpileModule(
  readFileSync(join(here, "..", `${n}.ts`), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
let src = load("places");
src = src.replaceAll('"@/lib/fuzzy"',
  `"data:text/javascript,${encodeURIComponent(load("fuzzy"))}"`);
const { places, findPlace, lotsFollowTheirPark } =
  await import("data:text/javascript," + encodeURIComponent(src));

const said = [];
const t = (name, fn) => {
  let ok = false;
  try { ok = fn(); } catch (e) { said.push(` ✗ ${name} -- threw: ${e.message}`); return; }
  said.push(ok ? ` ok ${name}` : ` ✗ ${name}`);
};

const PROPS = [
  { id: "p1", name: "The Retreat", kind: "mhp",
    address: "3100 Lady Viola Dr, Fayetteville NC" },
  { id: "p2", name: "1140 Northside Road Mobile Home Community", kind: "mhp",
    address: "1140 Northside Rd, Elizabeth City NC" },
  { id: "p3", name: "1012 Chason St", kind: "sfh",
    address: "1012 Chason St, Fayetteville NC" },
  { id: "p4", name: "Hall Street Duplex", kind: "multi", address: null },
  // A park with nothing on file to pick from.
  { id: "p5", name: "Pine Ridge", kind: "mhp", address: "9 Pine Ridge Rd, Dunn NC" },
];
const UNITS = [];
for (let i = 1; i <= 13; i++) UNITS.push({ id: `r${i}`, property_id: "p1", label: String(i + 3099) });
for (let i = 1; i <= 59; i++) UNITS.push({ id: `n${i}`, property_id: "p2", label: String(i) });
/* THE SINGLE HOUSE HAS A UNIT ROW, as a real one does -- the house itself.
   Without it, "a single house does not ask which lot" passed when the kind
   check was deleted, because the has-any-lots condition already made it
   false. Two conditions, and the fixture could only ever exercise one. */
UNITS.push({ id: "c1", property_id: "p3", label: "Unit A" });
UNITS.push({ id: "h1", property_id: "p4", label: "A" });
UNITS.push({ id: "h2", property_id: "p4", label: "B" });
// A lot whose park is gone.
UNITS.push({ id: "orphan", property_id: "gone", label: "7" });
// Both parks get a lot 20, so the park name has to do real work.
UNITS.push({ id: "r20", property_id: "p1", label: "20" });

const ALL = places(PROPS, UNITS);
const find = (q, n = 8) => findPlace(q, ALL, n);
const ids = (q, n = 8) => find(q, n).map((p) => p.id);

t("every property is a place, lots or no lots", () =>
  PROPS.every((p) => ALL.some((x) => x.id === `p:${p.id}`)));
t("a lot whose park is gone is not a place", () =>
  !ALL.some((x) => x.unitId === "orphan"));

/* --------------------------------------- the two people in the requirement */

t("somebody who knows the park finds it by name", () =>
  find("the retreat")[0]?.id === "p:p1");

t("somebody who knows only the street and lot finds the LOT", () =>
  find("1140 northside rd lot 20")[0]?.id === "u:n20");

t("and the short way they would actually type it", () =>
  find("northside 20")[0]?.id === "u:n20");

/* THE ONE THE SECOND LOT 20 EXISTS FOR. If the park name were ignored, this
   would come back as Northside's lot 20 -- a shift filed against a park a
   hundred miles from the work. */
t("the park named in the query decides WHICH lot 20", () =>
  find("retreat lot 20")[0]?.id === "u:r20");

t("a bare lot number offers both parks' lot 20, not one of them", () => {
  const got = ids("lot 20", 20);
  return got.includes("u:n20") && got.includes("u:r20");
});

/* ------------------------------------------------------- how people type */

t("a typo in the street still finds it", () =>
  find("nortside 20")[0]?.id === "u:n20");

t("a single house is findable by its street", () =>
  find("chason")[0]?.id === "p:p3");

t("a property with no address on file does not break the search", () =>
  find("hall street")[0]?.id === "p:p4");

/* EVERY WORD HAS TO LAND. Without this the list is everything on Northside
   Road whatever else was typed, which on a phone is no narrower than the
   dropdown it replaces. */
t("a word that matches nothing rules the place out", () =>
  find("northside giraffe").length === 0);

t("the park outranks its own lots when only the park was typed", () => {
  const got = find("the retreat", 5);
  return got[0]?.kind === "property";
});

t("asking for nothing offers the list rather than nothing", () =>
  find("", 5).length === 5);

/* ------------------------------------------------------------- the labels */

t("a numeric lot label is shown as a lot, not as a bare number", () =>
  ALL.find((p) => p.unitId === "n20")?.label === "1140 Northside Road Mobile Home Community · Lot 20");

t("a lot carries the property it belongs to, for filing the hours", () => {
  const p = ALL.find((x) => x.unitId === "n20");
  return p.propertyId === "p2" && p.kind === "lot";
});

/* -------------------------------------------- which lot, when it is a park */

t("picking a PARK that is a mobile home park asks which lot", () =>
  ALL.find((p) => p.id === "p:p2")?.needsLot === true);

/* The pair that makes the first one mean something. Without the kind check
   every property would ask, including a single house where the question has
   no answer -- and a check that only looks at the park would pass on that. */
t("a single house does not ask which lot", () =>
  ALL.find((p) => p.id === "p:p3")?.needsLot === false);

t("a park with no lots on file does not ask a question nothing can answer", () =>
  ALL.find((p) => p.id === "p:p5")?.needsLot === false);

t("a LOT never asks which lot, because it is the answer", () =>
  ALL.filter((p) => p.kind === "lot").every((p) => p.needsLot === false));

/* ------------------------------------------------ what the ordering rests on */

/* The park sorting above its own lots is not a rule about kinds -- it works
   because a lot is labelled `<park> · Lot <n>`, so the park's label is a
   prefix and sorts first. Two explicit rules for it were written and both
   were no-ops. This is the thing actually holding it up, so this is what is
   checked: change the label format and this fails rather than the ordering
   quietly changing. */
t("every lot's label still begins with its park's, which is what orders them",
  () => lotsFollowTheirPark(ALL));

for (const l of said) (l.startsWith(" ✗") ? console.error : console.log)(l);
if (said.some((l) => l.startsWith(" ✗"))) process.exit(1);
console.log("both ways of saying where you are find the same place");
