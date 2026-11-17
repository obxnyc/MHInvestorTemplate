/** Hours entered by the office.  Run: node lib/__fixtures__/office-hours.test.mjs
 *
 *  The cases that matter are the ones a wrong rule answers differently: a
 *  summer day and a winter day (a fixed -5 is right in one and an hour out
 *  in the other), the morning daylight saving ends (the clock reads 1:30
 *  twice), an end before a start, a day in the future, and a break longer
 *  than the day.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = process.env.OFFICE_HOURS_SRC ?? join(here, "..", "office-hours.ts");
const js = ts.transpileModule(readFileSync(src, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { wallToUtc, checkEntry, overlaps } = await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};
const NY = "America/New_York";
const NOW = new Date("2026-11-17T22:00:00Z");

t("7am on a November day is 12:00 UTC (EST)", () => wallToUtc("2026-11-17", "07:00", NY).toISOString() === "2026-11-17T12:00:00.000Z");
t("7am on a July day is 11:00 UTC (EDT)", () => wallToUtc("2026-07-14", "07:00", NY).toISOString() === "2026-07-14T11:00:00.000Z");
t("the morning the clocks go back still lands on a real moment", () => {
  const d = wallToUtc("2026-11-01", "07:00", NY); return d.toISOString() === "2026-11-01T12:00:00.000Z";
});
t("31 November is not a day", () => wallToUtc("2026-11-31", "07:00", NY) === null);
t("25:00 is not a time", () => wallToUtc("2026-11-17", "25:00", NY) === null);

const day = { day: "2026-11-16", from: "07:00", to: "16:30", breakMinutes: 30 };
t("an ordinary day goes in", () => {
  const r = checkEntry(day, NY, NOW);
  return r.ok && r.startedAt === "2026-11-16T12:00:00.000Z" && r.endedAt === "2026-11-16T21:30:00.000Z" && r.breakMinutes === 30;
});
t("finishing before starting is refused", () => !checkEntry({ ...day, to: "06:00" }, NY, NOW).ok);
t("more than sixteen hours is refused", () => !checkEntry({ ...day, from: "05:00", to: "22:00" }, NY, NOW).ok);
t("tomorrow is refused", () => !checkEntry({ ...day, day: "2026-11-18" }, NY, NOW).ok);
t("later today than now is refused", () => !checkEntry({ ...day, day: "2026-11-17", to: "18:00" }, NY, NOW).ok);
t("earlier today is fine", () => checkEntry({ ...day, day: "2026-11-17", to: "16:00" }, NY, NOW).ok);
t("a break as long as the day is refused", () => !checkEntry({ ...day, breakMinutes: 570 }, NY, NOW).ok);
t("a negative break is refused", () => !checkEntry({ ...day, breakMinutes: -10 }, NY, NOW).ok);

t("overlap: inside another shift", () => overlaps("2026-11-16T13:00:00Z", "2026-11-16T14:00:00Z", "2026-11-16T12:00:00Z", "2026-11-16T21:00:00Z"));
t("overlap: an open shift runs on", () => overlaps("2026-11-16T13:00:00Z", "2026-11-16T14:00:00Z", "2026-11-16T12:00:00Z", null));
t("touching ends do not overlap", () => !overlaps("2026-11-16T12:00:00Z", "2026-11-16T13:00:00Z", "2026-11-16T13:00:00Z", "2026-11-16T14:00:00Z"));

const bad = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
console.log(`\n${checks.length - bad.length}/${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
