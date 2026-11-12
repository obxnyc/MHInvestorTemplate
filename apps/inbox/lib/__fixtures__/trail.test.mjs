/** A day's trail.  Run: node lib/__fixtures__/trail.test.mjs
 *
 *  A real-shaped morning: on site, a drive north to a store, twenty-five
 *  minutes there, back. Every rule here gives a different picture if it is
 *  wrong: a stop not found, a store mistaken for the job, a phone that sat
 *  still drawn as a zig-zag of arrows, a cold-start fix inventing a detour.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const tr = (f) => ts.transpileModule(readFileSync(join(here, "..", f), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const fenceUrl = "data:text/javascript," + encodeURIComponent(tr("fence.ts"));
const js = tr("trail.ts").replace(/from\s+["']\.\/fence["']/, `from "${fenceUrl}"`);
const { trail, bearing } = await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

const N = (m) => m / (6_371_000 * Math.PI / 180);
const BASE = { lat: 35.1, lng: -78.9 };
const at = (h, m) => new Date(Date.UTC(2026, 10, 12, h + 5, m)).toISOString();
const p = (north, h, m, kind = "ping", accuracy = 15) =>
  ({ lat: BASE.lat + N(north), lng: BASE.lng, at: at(h, m), accuracy, kind });

const SITE = { id: "s1", name: "Lady Viola 3124", lat: BASE.lat, lng: BASE.lng, radius: 75 };
// On site 7:30-8:30, drive north 3km 8:30-8:40, store 8:40-9:05, back by 9:15.
const day = [
  p(0, 7, 30, "in"), ...[32, 34, 40, 50, 60, 70, 80, 90].map((m) => p(10, 7 + Math.floor(m / 60), m % 60)),
  p(1000, 8, 34), p(2000, 8, 37),
  ...[40, 45, 50, 55, 60, 65].map((m) => p(3000 + (m % 2) * 20, 8 + Math.floor(m / 60), m % 60)),
  p(1500, 9, 10), p(5, 9, 15), p(0, 9, 40, "out"),
];
const tr0 = trail(day, [SITE]);

t("points come back in time order whatever order they arrive in",
  () => trail([...day].reverse(), [SITE]).points[0].kind === "in");
t("two stops: the job and the store, then back to the job", () => tr0.stops.length === 3);
t("the first stop is the job site", () => tr0.stops[0].site?.id === "s1");
t("the store is a stop that is NOT a job site", () => tr0.stops[1].site === null);
t("and it says how long: 25 minutes", () => tr0.stops[1].minutes === 25);
t("the drive north points north", () => {
  const leg = tr0.legs.find((l) => l.to.at === at(8, 34));
  return leg && (leg.bearing < 10 || leg.bearing > 350);
});
t("the drive back points south", () => {
  const leg = tr0.legs.find((l) => l.to.at === at(9, 10));
  return leg && Math.abs(leg.bearing - 180) < 10;
});
t("sitting still makes no arrows", () =>
  !tr0.legs.some((l) => l.from.at === at(7, 50) && l.to.at === at(8, 0)));
t("distance is the drive, about 6km out and back", () => tr0.metres > 5500 && tr0.metres < 6500);

// A cold-start fix 1.5km off, a kilometre wide, in the middle of the job: it
// is drawn, but it must not split the job stop in two.
const cold = [...day.slice(0, 5), p(1500, 7, 55, "ping", 1000), ...day.slice(5)];
t("a kilometre-wide fix does not split a stop", () =>
  trail(cold, [SITE]).stops[0].minutes === tr0.stops[0].minutes);
t("but it is still drawn", () => trail(cold, [SITE]).points.length === cold.length);

t("a drive past without stopping is not a stop", () =>
  trail([p(0, 7, 0), p(10, 7, 2), p(1000, 7, 5)], []).stops.length === 0);
t("nothing in, nothing out", () => {
  const r = trail([], []); return r.points.length === 0 && r.stops.length === 0 && r.metres === 0;
});
t("bearing: due east is 90", () => Math.round(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })) === 90);

const bad = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
console.log(`\n${checks.length - bad.length}/${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
