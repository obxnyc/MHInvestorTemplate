/** Where the crew is, and what goes to payroll.  Run: node lib/__fixtures__/crew.test.mjs
 *
 *  Each fixture is built so the wrong answer gives a DIFFERENT number from the
 *  right one -- a fixture with one ping cannot tell newest from first, and one
 *  with only finished shifts cannot tell whether an open one leaked into the
 *  total.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const tr = (f) => ts.transpileModule(readFileSync(join(here, "..", f), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const shiftUrl = "data:text/javascript," + encodeURIComponent(tr("shift.ts"));
const crewJs = tr("crew.ts").replace(/from\s+["']\.\/shift["']/, `from "${shiftUrl}"`);
const { whereNow, payrollCsv, hoursBySite, cell, PAYROLL_COLUMNS } =
  await import("data:text/javascript," + encodeURIComponent(crewJs));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

const at = (d, h, m = 0) =>
  `2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
const NOW = new Date(at(10, 18));
const SITES = [
  { id: "p1", name: "Lady Viola 3124", lat: 35, lng: -79 },
  { id: "p2", name: "Northside 12", lat: 36, lng: -76 },
];

/* ------------------------------------------------------------ where now */

const open = [
  { id: "s1", staffId: "a", name: "Zed", propertyId: "p1", startedAt: at(10, 13), endedAt: null,
    startLat: 1, startLng: 1, startAcc: 20, startFence: "unsure" },
  { id: "s2", staffId: "b", name: "Amy", propertyId: null, startedAt: at(10, 14), endedAt: null,
    startLat: 2, startLng: 2, startAcc: 15, startFence: "outside" },
  { id: "s3", staffId: "c", name: "Bo", propertyId: "p2", startedAt: at(9, 2), endedAt: null,
    startLat: null, startLng: null, startAcc: null, startFence: "unsure" },
];
// The OLDER ping is listed first, so "first" and "newest" differ.
const pings = [
  { shiftId: "s1", at: at(10, 15), lat: 10, lng: 10, accuracy: 30, fence: "outside", metres: 400 },
  { shiftId: "s1", at: at(10, 17, 40), lat: 11, lng: 11, accuracy: 12, fence: "inside", metres: 8 },
];
const w = whereNow(open, pings, SITES, NOW);
const zed = w.find((x) => x.name === "Zed");
const amy = w.find((x) => x.name === "Amy");
const bo = w.find((x) => x.name === "Bo");

t("everybody on the clock is listed", () => w.length === 3);
t("sorted by name", () => w.map((x) => x.name).join() === "Amy,Bo,Zed");
t("the newest ping wins, not the first one listed", () => zed.at.lat === 11 && zed.fence === "inside");
t("the ping's distance is carried", () => zed.metres === 8);
t("a ping says it is a ping", () => zed.from === "ping");
t("how long since the ping", () => zed.quietMinutes === 20);
t("site named from the property", () => zed.site.name === "Lady Viola 3124");
t("no pings: the clock-in position, and says so", () =>
  amy.from === "clock-in" && amy.at.lat === 2 && amy.seenAt === at(10, 14));
t("no pings: the clock-in fence reading", () => amy.fence === "outside");
t("no site is null, not a guess", () => amy.site === null);
t("never a position: no dot, no age", () => bo.at === null && bo.from === null && bo.quietMinutes === null);
t("open 40 hours is abandoned", () => bo.abandoned === true);
t("open 5 hours is not", () => zed.abandoned === false);
t("a finished shift is not on the map", () =>
  whereNow([{ ...open[0], endedAt: at(10, 17) }], pings, SITES, NOW).length === 0);

/* --------------------------------------------------------------- payroll */

const pay = [
  // Finished, with a 30 minute break: 8.5 gross, 8.00 paid.
  { id: "f1", staffId: "a", name: "Zed", propertyId: "p1", siteName: "Lady Viola 3124",
    siteAddress: "3124 Lady Viola Ln, Fayetteville, NC", propertyFrom: "fence",
    startFence: "inside", endFence: "inside", signedOffAt: at(9, 18),
    startedAt: at(9, 12), endedAt: at(9, 20, 30),
    breaks: [{ startedAt: at(9, 16), endedAt: at(9, 16, 30) }] },
  // Finished, 2.25 hours, no site.
  { id: "f2", staffId: "a", name: "Zed", propertyId: null, siteName: null, siteAddress: null,
    propertyFrom: null, startFence: "unsure", endFence: "outside", signedOffAt: null,
    startedAt: at(10, 12), endedAt: at(10, 14, 15), breaks: [] },
  // Still running: must contribute NOTHING to the total.
  { id: "o1", staffId: "a", name: "Zed", propertyId: "p1", siteName: "Lady Viola 3124",
    siteAddress: null, propertyFrom: "chosen", startFence: "unsure", endFence: null,
    signedOffAt: null, startedAt: at(10, 15), endedAt: null, breaks: [] },
  // Forgotten: open 40 hours.
  { id: "o2", staffId: "c", name: "=HYPERLINK(\"x\")", propertyId: "p2", siteName: "Northside, Lot 12",
    siteAddress: null, propertyFrom: "fence", startFence: "inside", endFence: null,
    signedOffAt: null, startedAt: at(9, 2), endedAt: null, breaks: [] },
];
const csv = payrollCsv(pay, NOW, { offsetMinutes: 300 });
const rows = csv.split("\r\n");
const zedTotal = rows.find((r) => r.startsWith("Zed,,TOTAL"));

t("header row is the columns", () => rows[0] === PAYROLL_COLUMNS.join(","));
t("one row per shift plus totals", () => rows.filter((r) => r && !r.includes("TOTAL")).length === 5);
t("break deducted only as recorded", () => rows.some((r) => r.includes(",30,8.00,")));
t("the open shift's hours cell is empty", () =>
  rows.some((r) => r.includes("Still on the clock") && /,0,,/.test(r)));
t("the total counts finished shifts only: 8.00 + 2.25", () => zedTotal?.includes(",10.25,"));
t("the total says what it left out", () => zedTotal?.includes("1 shift not finished"));
t("a forgotten shift says it needs fixing", () => csv.includes("Not clocked out — needs fixing"));
t("times are in the reader's clock (UTC-5)", () => rows.some((r) => r.includes("2026-11-09 07:00,2026-11-09 15:30")));
t("a shift that starts after local midnight is the local day", () => {
  const late = payrollCsv([{ ...pay[1], startedAt: at(10, 3), endedAt: at(10, 4) }], NOW, { offsetMinutes: 300 });
  return late.split("\r\n")[1].split(",")[1] === "2026-11-09";
});
t("a formula is neutered", () => csv.includes(`"'=HYPERLINK(""x"")"`) && !/(^|,)=HYPERLINK/m.test(csv));
t("a comma in a name is quoted", () => csv.includes(`"Northside, Lot 12"`));
t("no site says so", () => rows.some((r) => r.startsWith("Zed,2026-11-10,Not set")));
t("how the site was decided", () => csv.includes("Phone location") && csv.includes("Picked by employee"));
t("lines end CRLF", () => csv.endsWith("\r\n") && !/[^\r]\n/.test(csv));
t("cell leaves ordinary words alone", () => cell("Amy") === "Amy" && cell(null) === "");

/* ----------------------------------------------------------- by site */

const bySite = hoursBySite([
  ...pay,
  { id: "x", staffId: "b", name: "Amy", propertyId: "p1", startedAt: at(9, 13), endedAt: at(9, 14), breaks: [] },
], SITES);
t("hours at a site add across people", () => bySite[0].name === "Lady Viola 3124" && bySite[0].hours === 9);
t("and count the people", () => bySite[0].people === 2);
t("untagged is its own line, last, not spread", () =>
  bySite.at(-1).id === null && bySite.at(-1).hours === 2.25);
// The untagged hours here are the BIGGEST, so "last" and "smallest" differ.
const bigUntagged = hoursBySite([
  { id: "u", staffId: "a", propertyId: null, startedAt: at(9, 6), endedAt: at(9, 18), breaks: [] },
  { id: "v", staffId: "a", propertyId: "p1", startedAt: at(10, 6), endedAt: at(10, 7), breaks: [] },
], SITES);
t("untagged is last even when it is the most hours", () => bigUntagged.at(-1).id === null);
t("open shifts add no site hours", () => !bySite.some((s) => s.name === "Northside 12"));

const bad = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
console.log(`\n${checks.length - bad.length}/${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
