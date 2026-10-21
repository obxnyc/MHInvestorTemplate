/** Where the money is going.  Run:  node lib/__fixtures__/leaks.test.mjs
 *
 *  Every check in here is about honesty rather than arithmetic. A figure on
 *  this screen is one somebody plans around, so the ways it can lie are the
 *  thing worth guarding: a guess totalled as though it were measured, a total
 *  that is short and does not say so, and a count dressed up as money.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const load = async (name) => {
  const src = readFileSync(join(here, "..", `${name}.ts`), "utf8");
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
};

// leaks.ts imports its neighbours, so they are inlined as data: URLs rather
// than written to disk beside the source.
const dep = async (name) => "data:text/javascript," + encodeURIComponent(await load(name));
let src = await load("leaks");
for (const n of ["empty", "match", "wanted"]) {
  src = src.replaceAll(`"./${n}"`, `"${await dep(n)}"`);
}
const { leaks } = await import("data:text/javascript," + encodeURIComponent(src));

const TODAY = new Date(Date.UTC(2026, 9, 21));          // 21 October 2026

const lot = (o) => ({ id: o.label, label: o.label, property: "The Retreat",
                      rent: null, bedrooms: null, vacantSince: null,
                      vacantSinceEstimated: false, blocker: null, ...o });
const run = (g) => leaks({ empty: [], looking: [], jobs: [], invoices: [],
                           today: TODAY, ...g });
const find = (rows, key) => rows.find((r) => r.key === key);

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

// ---- nothing wrong is an empty list, not a screen of zeroes ----
t("a business with nothing leaking says nothing", () => run({}).length === 0);

// ---- the empty lots ----
// Two measured ($775 since 19 July = 94 days, $650 since 11 October = 10
// days) and one with no rent on file.
const EMPTY = [
  lot({ label: "3114", rent: 775, bedrooms: 3, vacantSince: "2026-07-19" }),
  lot({ label: "3120", rent: 650, bedrooms: 2, vacantSince: "2026-10-11" }),
  lot({ label: "3130", rent: null, bedrooms: 3, vacantSince: "2026-09-01" }),
];
const e = find(run({ empty: EMPTY }), "empty");
t("every empty lot is counted", () => e.count === 3);
t("only the priced ones are in the monthly figure", () => e.perMonth === 1425);
t("what has gone already is the days, not the months",
  () => e.gone === Math.round((94 / 30.44) * 775 + (10 / 30.44) * 650));

// A total that is short says so, and says by how many. Six lots with no rent
// on file make the leak look smaller than it is, and the smaller it looks the
// longer it stays.
t("the lot with no rent is named as missing from the figure", () => e.short.count === 1);
t("and says why", () => /no rent on file/.test(e.short.because));

// A guess multiplied by a rent is a figure somebody puts in front of an
// investor. The backfilled spells are not in the total at all.
const guessed = run({ empty: [
  lot({ label: "A", rent: 775, vacantSince: "2026-07-19", vacantSinceEstimated: true }),
] });
t("a carried-over spell is not totalled as money gone",
  () => find(guessed, "empty").gone === undefined);
t("but its rent still counts against the month",
  () => find(guessed, "empty").perMonth === 775);
t("and the screen is told the spell was a guess",
  () => /carried over/.test(find(guessed, "empty").short.because));

const halfGuessed = run({ empty: [
  lot({ label: "A", rent: 775, vacantSince: "2026-07-19" }),
  lot({ label: "B", rent: 650, vacantSince: "2026-07-19", vacantSinceEstimated: true }),
] });
t("a measured spell beside a guessed one still totals the measured one",
  () => find(halfGuessed, "empty").gone === Math.round((94 / 30.44) * 775));
t("and only the guessed one is named as left out",
  () => find(halfGuessed, "empty").short.count === 1);

// ---- empty a long time with nobody on it ----
const adrift = run({ empty: [
  lot({ label: "A", rent: 775, vacantSince: "2026-07-19" }),
  lot({ label: "B", rent: 650, vacantSince: "2026-07-19", blocker: "Flooring quote" }),
  lot({ label: "C", rent: 600, vacantSince: "2026-10-11" }),
] });
t("a lot long empty with no reason given is its own line",
  () => find(adrift, "adrift").count === 1);
t("a lot long empty WITH a reason is not on it",
  () => find(adrift, "adrift").perMonth === 775);
t("a lot only just empty is not on it either", () =>
  !find(adrift, "adrift").says.includes("3"));
t("a blocker of nothing but spaces is not a reason",
  () => find(run({ empty: [lot({ label: "A", rent: 775, vacantSince: "2026-07-19",
                           blocker: "   " })] }), "adrift").count === 1);

// ---- who is waiting ----
const WAITING = {
  empty: [lot({ label: "3114", rent: 775, bedrooms: 3, vacantSince: "2026-10-11" }),
          lot({ label: "3100", rent: 650, bedrooms: 1, vacantSince: "2026-10-11" })],
  looking: [
    { id: "p1", wanted: { bedroomsMin: 3, priceCeiling: 900 } },   // fits 3114
    { id: "p2", wanted: { bedroomsMin: 4 } },                      // fits nothing
    { id: "p3", wanted: {} },                                      // said nothing
  ],
};
const w = find(run(WAITING), "waiting");
t("only the people something actually fits are counted", () => w.count === 1);
t("it is money to be had, not money going out", () => w.upside === true);
t("and it sorts to the top", () => run(WAITING)[0].key === "waiting");

// The same lot fits several people and one person takes one home. Adding
// every pair would invent the rent two and three times over.
// TWO three-bed lots, not one. With a single clean fit each, adding every
// pair and taking the best one give the same number, and a fixture that
// cannot tell the two answers apart is not testing the thing it names --
// removing the best-of rule passed this check the first time round.
const crowd = run({ empty: [...WAITING.empty,
                            lot({ label: "3118", rent: 725, bedrooms: 3,
                                  vacantSince: "2026-10-11" })],
  looking: [{ id: "a", wanted: { bedroomsMin: 3 } },
            { id: "b", wanted: { bedroomsMin: 3 } },
            { id: "c", wanted: { bedroomsMin: 3 } }] });
t("three people who fit the same lot are three calls", () => find(crowd, "waiting").count === 3);
t("the rent is counted once per person, not once per lot they fit", () => {
  // Each of the three cleanly fits BOTH three-bed lots. One person takes one
  // home, so the figure is their best fit three times -- $725 is cheaper so
  // it sorts first -- and never the six pairings their shortlists hold
  // between them, which would invent the rent twice over.
  return find(crowd, "waiting").perMonth === 725 * 3;
});
t("and the pairs, if they were added, would be a different number",
  () => 725 * 3 !== (725 + 775) * 3);
t("somebody who said nothing is not counted as a fit",
  () => find(run({ empty: WAITING.empty, looking: [{ id: "x", wanted: {} }] }), "waiting")
  === undefined);
t("a near miss is not counted as a fit",
  () => find(run({ empty: [lot({ label: "A", rent: 950, bedrooms: 3 })],
             looking: [{ id: "x", wanted: { bedroomsMin: 3, priceCeiling: 900 } }] }),
       "waiting") === undefined);
t("nobody looking is no line", () => find(run({ empty: WAITING.empty }), "waiting") === undefined);

// ---- work with no cost on it ----
const jobs = run({ jobs: [
  { id: "1", completedAt: "2026-10-01", costCents: null },
  { id: "2", completedAt: "2026-10-02", costCents: 24000 },
  { id: "3", completedAt: null, costCents: null },             // still open
] });
t("only finished jobs with no cost count", () => find(jobs, "uncosted").count === 1);
// A made-up number in the figure that decides what a property costs to run is
// worse than a gap somebody can see.
t("the amount is not guessed at", () => find(jobs, "uncosted").perMonth === undefined);
t("and not reported as gone either", () => find(jobs, "uncosted").gone === undefined);

// ---- invoices nobody sent on ----
const inv = run({ invoices: [
  { id: "1", amountCents: 24000, emailedAt: null },
  { id: "2", amountCents: 50000, emailedAt: "2026-10-02T00:00:00Z" },
  { id: "3", amountCents: 1050, emailedAt: null },
] });
t("only the unsent ones count", () => find(inv, "unsent").count === 2);
t("and the amount is in dollars", () => find(inv, "unsent").perMonth === 251);

// ---- everything has somewhere to go ----
const all = run({ empty: EMPTY, looking: WAITING.looking,
                  jobs: [{ id: "1", completedAt: "2026-10-01", costCents: null }],
                  invoices: [{ id: "1", amountCents: 24000, emailedAt: null }] });
t("every line says where to go and do something about it",
  () => all.every((l) => l.go && l.go.href && l.go.said));
t("every line says what it is about", () => all.every((l) => l.says && l.count > 0));

// Every assertion above is a thunk, so a fault that leaves a field undefined
// is REPORTED rather than taking the run down with a TypeError and a line
// number. Four faults did exactly that the first time this was swept, and a
// run that dies reads as the harness being broken rather than as the fault
// defeating the one check it defeated.
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
