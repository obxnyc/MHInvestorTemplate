/** Zillow Lead API parsing.  Run:  node lib/__fixtures__/zillow-lead.test.mjs
 *
 *  The payload is the example from Zillow's own "Lead Delivery API Guide"
 *  (11 Dec 2024), with the listing moved to one of ours. */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const load = async (f) => import("data:text/javascript," + encodeURIComponent(
  ts.transpileModule(readFileSync(join(here, "..", f), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText));
const { parseZillowLead } = await load("zillow-lead.ts");
const { readWanted } = await load("wanted.ts");

const BODY = "listingId=p01023&name=Rachel%20Lee&email=rachel%40gmail.com&phone=555-555-8378"
  + "&movingDate=20261201&numBedroomsSought=3&numBathroomsSought=2"
  + "&message=Is%20this%20still%20available%3F&listingStreet=1140%20Northside%20Rd"
  + "&listingCity=Elizabeth%20City&listingPostalCode=27909&listingState=NC"
  + "&incomeYearly=42000&creditScoreRangeJson=%7B%22creditScoreMin%22%3A620%2C%22creditScoreMax%22%3A659%7D"
  + "&petDetailsJson=%5B%7B%22type%22%3A%22dog%22%2C%22breed%22%3A%22Lab%22%2C%22weightPounds%22%3A50%7D%5D"
  + "&smoker=false&leadType=tourRequest&providerModelId=0";

const checks = [];
const t = (name, f) => { try { checks.push([name, !!f()]); } catch (e) { checks.push([`${name} (threw: ${e.message})`, false]); } };

const lead = parseZillowLead(new URLSearchParams(BODY), "abc123");
const i = lead.intake;

t("the renter's real phone is kept", () => i.phone === "555-555-8378");
t("the renter's real email is kept", () => i.email === "rachel@gmail.com");
t("the name is kept", () => i.name === "Rachel Lee");
t("it is filed as a prospect from Zillow", () => i.category === "prospect" && i.source === "zillow");
t("the listing address is the lot hint", () => i.unitHint === "1140 Northside Rd, Elizabeth City");
t("a redelivery has the same id", () => i.externalId === "zillow-api:abc123");
t("the move date is read as a date", () => lead.answers.movingDate === "2026-12-01");
t("the credit range is read", () => lead.answers.creditMin === 620 && lead.answers.creditMax === 659);
t("income is shown a month as well as a year", () => i.raw.includes("$42,000 a year") && i.raw.includes("$3,500 a month"));
t("the pet is described", () => i.raw.includes("dog (Lab, 50 lb)"));
t("the tour request is named", () => i.summary.startsWith("Zillow tour request — 1140 Northside Rd"));
t("their own words are in the thread", () => i.raw.includes('"Is this still available?"'));

// The thread text feeds the inquiry reader: what Zillow told us must come
// out the other side as bedrooms and a move-in date, or the board cannot
// match the lead to a home.
const w = readWanted(i.raw, { today: new Date("2026-11-17T12:00:00Z") }).wanted;
t("the inquiry reader finds the bedrooms", () => w.bedroomsMin === 3);
t("the inquiry reader finds the move-in date", () => w.moveInFrom === "2026-12-01");
// Income said a month must not be taken for the most they will pay in rent.
t("their income is not read as a rent ceiling", () => w.priceCeiling === undefined);

// A house number is not a budget. Asked of the reader directly, because the
// thread text above no longer says "about" and so cannot catch it.
const today = new Date("2026-11-17T12:00:00Z");
t("a house number after 'about' is not a budget",
  () => readWanted("I have a question about 1140 Northside Rd", { today }).wanted.priceCeiling === undefined);
t("a budget after 'about' is still a budget",
  () => readWanted("my budget is about 900 a month", { today }).wanted.priceCeiling === 900);

// Absent fields stay absent rather than becoming zeros or "null".
const bare = parseZillowLead(new URLSearchParams("name=Sam&email=s%40x.com&leadType=question"), "d");
t("a bare question has no invented facts", () => !/null|NaN|undefined|\$0/.test(bare.intake.raw));
t("a bare question is still a Zillow question", () => bare.intake.summary === "Zillow question");
t("no phone is no phone", () => bare.intake.phone === null);

let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "ok  " : "FAIL"}  ${name}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
