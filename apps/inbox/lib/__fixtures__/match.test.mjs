/** Who to ring when a lot comes free.  Run: node lib/__fixtures__/match.test.mjs
 *
 *  The ordering of this list is the thing a fair-housing complaint would ask
 *  about, so the source rules at the bottom are as much of the check as the
 *  arithmetic: the file may not read anything but the five stated fields, and
 *  it may not order the list by anything about the person.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const path = join(here, "..", "match.ts");
const src = readFileSync(path, "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { fit, matches, saidNothing } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

const lot = (o) => ({ id: o.label, label: o.label, property: "The Retreat",
                      rent: null, bedrooms: null, ...o });

const LOTS = [
  lot({ label: "3100", rent: 650, bedrooms: 2 }),
  lot({ label: "3114", rent: 775, bedrooms: 3 }),
  lot({ label: "3120", rent: 950, bedrooms: 3 }),
  lot({ label: "3124", rent: 1200, bedrooms: 4 }),
  lot({ label: "3130", rent: null, bedrooms: 3 }),
  lot({ label: "3140", rent: 700, bedrooms: null }),
  lot({ label: "NS51", rent: 725, bedrooms: 3, property: "1140 Northside Rd" }),
];

// ---- the plain case ----
const three = matches(LOTS, { bedroomsMin: 3, priceCeiling: 900 });
t("too few bedrooms is not on the list",
  !three.some((f) => f.lot.label === "3100"));
t("well over the ceiling is not on the list",
  !three.some((f) => f.lot.label === "3124"));
t("the ones that fit are on it",
  three.filter((f) => !f.against.length).map((f) => f.lot.label).sort().join(",")
  === "3114,NS51");
t("the best fit is first", three[0].lot.label === "3114" || three[0].lot.label === "NS51");
t("it says why", () => three[0].because.some((b) => /wanted 3\+/.test(b)));

// ---- a near miss is a phone call, not a silence ----
// $950 against a stated $900 is nine fifty. Hiding it is how the call never
// gets made; the screen has to show it AND say it is over.
const over = three.find((f) => f.lot.label === "3120");
t("a little over the ceiling is still on the list", !!over);
t("and is marked as over", () => over.against.some((a) => /a little over/.test(a)));
t("a near miss sorts below a clean fit",
  three.findIndex((f) => f.lot.label === "3120")
  > three.findIndex((f) => f.lot.label === "3114"));
t("more than a tenth over is not a near miss",
  !matches(LOTS, { bedroomsMin: 3, priceCeiling: 800 })
    .some((f) => f.lot.label === "3120"));

// ---- missing data on OUR side is a thing to look up ----
// Not a reason to drop the lot. The one lot with no rent recorded might be
// the one that fits, and dropping it is the screen hiding our own gap.
const noRent = three.find((f) => f.lot.label === "3130");
t("a lot with no rent set is still offered", !!noRent);
t("and says the rent is not set", () => noRent.against.some((a) => /no rent set/.test(a)));
const noBeds = matches(LOTS, { bedroomsMin: 3 }).find((f) => f.lot.label === "3140");
t("a lot with no bedroom count is still offered", !!noBeds);
t("and says the bedrooms are not recorded",
  () => noBeds.against.some((a) => /not recorded/.test(a)));

// ---- silence is not a constraint ----
// Somebody who never said a number has not asked for one bedroom.
t("saying nothing fits everything", matches(LOTS, {}).length === LOTS.length);
// The count alone cannot tell the two readings apart: a file that tests every
// preference whether or not it was stated also returns all seven lots, just
// with "wanted undefined+" written beside them and the ones missing a bedroom
// count pushed to the bottom. What separates them is that an unstated
// preference produces no reason either way.
t("and with nothing said for or against any of them",
  matches(LOTS, {}).every((f) => !f.because.length && !f.against.length));
t("and the screen is told they said nothing", saidNothing({}) === true);
t("one stated preference is not nothing", saidNothing({ bedroomsMin: 3 }) === false);
t("a stated no on pets is not nothing", saidNothing({ hasPets: false }) === false);
t("no ceiling stated does not exclude the dearest lot",
  matches(LOTS, { bedroomsMin: 4 }).some((f) => f.lot.label === "3124"));

// ---- the place ----
const away = matches(LOTS, { area: "Northside" });
t("the named place is a clean fit",
  away.find((f) => f.lot.label === "NS51").against.length === 0);
t("somewhere else is still offered, marked",
  () => away.find((f) => f.lot.label === "3114").against.some((a) => /not Northside/.test(a)));
t("and sorts below the one in the right place",
  away[0].lot.label === "NS51");

// ---- the date ----
const soon = matches([lot({ label: "A", rent: 700, bedrooms: 3, availableOn: "2026-12-01" })],
                     { moveInFrom: "2026-11-01" });
t("a lot free after they need it is marked, not hidden",
  () => soon[0].against.some((a) => /they wanted 2026-11-01/.test(a)));
t("a lot free before they need it is clean",
  matches([lot({ label: "A", rent: 700, bedrooms: 3, availableOn: "2026-10-01" })],
          { moveInFrom: "2026-11-01" })[0].against.length === 0);

// ---- nothing to offer ----
t("no lots is an empty list, not a throw", matches([], { bedroomsMin: 3 }).length === 0);
t("a single lot that contradicts them is no list",
  matches([lot({ label: "A", rent: 2000, bedrooms: 1 })],
          { bedroomsMin: 3, priceCeiling: 700 }).length === 0);
t("fit returns null for a contradiction",
  fit(lot({ label: "A", rent: 700, bedrooms: 1 }), { bedroomsMin: 3 }) === null);

// ---- the rules, which the arithmetic cannot state ----
// A list of who to ring, ordered by anything other than what they asked for,
// is the screen somebody subpoenas. So the file is read as source.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

t("it reads no field but the five stated ones", () => {
  const reads = [...code.matchAll(/wanted\.([A-Za-z_]+)/g)].map((m) => m[1]);
  const allowed = new Set(["bedroomsMin", "priceCeiling", "area", "hasPets", "moveInFrom"]);
  return reads.length > 0 && reads.every((k) => allowed.has(k));
});
t("it never reaches for the party on a contact record",
  !/\bparty\b/.test(code));
t("it never orders by how long somebody has waited",
  !/inquired_at|waiting|since|seniority|first come/i.test(code));
t("it never reaches for income, credit or a prequalification outcome",
  !/income|credit|prequal|outcome|score/i.test(code));
t("the sort compares only the fit and the rent", () => {
  const sort = code.slice(code.indexOf(".sort("), code.indexOf("}\n\n/** Said"));
  return /against\.length/.test(sort) && /because\.length/.test(sort)
      && /lot\.rent/.test(sort)
      && !/contact|name|phone|party|income|credit/i.test(sort);
});

let failed = 0;
for (const [n, ok, note] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${n}${note ? ` (${note})` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
