/** Category labels and property colouring.
 *  Run: node lib/__fixtures__/category.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "category.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const M = await import("data:text/javascript," + encodeURIComponent(js));
const { CATEGORIES, CAT_LABEL, CAT_TAB, catLabel, propertyColor, propertyOf } = M;

const checks = [];
const t = (n, ok) => checks.push([n, ok]);

// --- every category the database can produce has a human label ---
const ENUM = ["maintenance","prospect","current_tenant","vendor","collections","other"];
t("the label map covers the conv_category enum exactly",
  JSON.stringify([...CATEGORIES].sort()) === JSON.stringify([...ENUM].sort()));
t("every category has a badge label and a tab label",
  ENUM.every((k) => CAT_LABEL[k] && CAT_TAB[k]));
t("no two categories share a badge label",
  new Set(ENUM.map((k) => CAT_LABEL[k])).size === ENUM.length);

// A row whose category is somehow null still has to render something; a blank
// badge reads as a rendering fault, not as "we don't know".
t("null category falls back to General", catLabel(null) === "General");
t("an unknown category falls back rather than showing the raw key",
  catLabel("something_new") === "General");
t("maintenance and prospect are visibly different words",
  catLabel("maintenance") !== catLabel("prospect"));

// --- property colours ---
t("a stored colour wins over the derived one",
  propertyColor("Pine Ridge", "#123456") === "#123456");
t("a malformed stored colour is ignored, not rendered",
  propertyColor("Pine Ridge", "red") === propertyColor("Pine Ridge"));
t("a short hex is rejected", propertyColor("Pine Ridge", "#123") !== "#123");
t("the derived colour is stable across calls",
  propertyColor("Pine Ridge") === propertyColor("Pine Ridge"));
t("different properties can get different colours",
  new Set(["Pine Ridge","Shady Oaks","Willow Bend","Cypress Park","Magnolia Court"]
    .map((n) => propertyColor(n))).size > 1);
t("every derived colour is a usable hex",
  ["Pine Ridge","Shady Oaks","","x"].every((n) => /^#[0-9A-Fa-f]{6}$/.test(propertyColor(n))));
t("a nameless property still gets a colour", /^#/.test(propertyColor(null)));

// --- which unit a thread belongs to ---
const P = (name) => ({ name, color: null });
const convUnit = { label: "Lot 14", properties: P("Pine Ridge") };
const contactUnit = { label: "Lot 3", properties: P("Shady Oaks") };

t("the thread's own unit wins when it is set",
  propertyOf(convUnit, contactUnit).name === "Pine Ridge");
t("the thread's own unit is marked exact",
  propertyOf(convUnit, contactUnit).exact === true);
t("with no unit on the thread, the contact's home unit is used",
  propertyOf(null, contactUnit).name === "Shady Oaks");
// The fallback is a guess and the UI says so on hover; asserting the flag here
// keeps that caveat from being quietly dropped in a refactor.
t("the fallback is flagged as inexact", propertyOf(null, contactUnit).exact === false);
t("the unit label rides along", propertyOf(null, contactUnit).unit === "Lot 3");
t("a contact with no unit yields no property chip at all",
  propertyOf(null, null) === null);
t("a unit with no property row does not render an empty chip",
  propertyOf({ label: "Lot 9", properties: null }, null) === null);
t("a conversation unit without a property falls back to the contact's",
  propertyOf({ label: "Lot 9", properties: null }, contactUnit).name === "Shady Oaks");

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
