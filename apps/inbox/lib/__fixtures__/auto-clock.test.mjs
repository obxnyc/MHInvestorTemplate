/** Clocking in and out by where the phone is.  Run: node lib/__fixtures__/auto-clock.test.mjs
 *
 *  Each case is built so the wrong rule gives a DIFFERENT answer: driving
 *  past a site (no dwell would clock him in), a vague fix on the pin (no
 *  vagueness rule would count it), a Lowe's run shorter than the away time,
 *  a Sunday arrival, a shift his lead started (not this phone's to end), and
 *  the clock-in time being when he ARRIVED, not when it was sure.
 *
 *  AUTO_CLOCK_SRC points it at another copy, to see a fault caught.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const tr = (p) => ts.transpileModule(readFileSync(p, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const fenceUrl = "data:text/javascript," + encodeURIComponent(tr(join(here, "..", "fence.ts")));
const src = process.env.AUTO_CLOCK_SRC ?? join(here, "..", "auto-clock.ts");
const js = tr(src).replace(/from\s+["']\.\/fence["']/, `from "${fenceUrl}"`);
const { step, inWindow, FRESH, ARRIVE_MS, AWAY_MS } = await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

const N = (m) => m / (6_371_000 * Math.PI / 180);
const BASE = { lat: 35.1, lng: -78.9 };
const A = { id: "A", name: "Northside", lat: BASE.lat, lng: BASE.lng, radius: 75 };
const B = { id: "B", name: "Cross Creek", lat: BASE.lat + N(3000), lng: BASE.lng, radius: 75 };
const NOPIN = { id: "X", name: "No pin", lat: null, lng: null, radius: 75 };
const SITES = [A, B, NOPIN];
const at = (north, accuracy = 15) => ({ lat: BASE.lat + N(north), lng: BASE.lng, accuracy });

const W = { tz: "America/New_York", days: [1, 2, 3, 4, 5, 6], from: "05:00", until: "18:00" };
// Tuesday 17 Nov 2026, 07:00 Eastern = 12:00Z.
const T0 = Date.parse("2026-11-17T12:00:00Z");
const MIN = 60_000;
const OFF = { on: false, auto: false, startedAt: null };

/** Feed fixes [minutesAfterT0, fix] through, return every decision made. */
function run(fixes, clock = OFF, sites = SITES, w = W) {
  let mem = FRESH; const out = [];
  for (const [m, f] of fixes) {
    const r = step(f, T0 + m * MIN, sites, w, clock, mem);
    mem = r.mem;
    if (r.decision) out.push(r.decision);
  }
  return out;
}

/* ------------------------------------------------------------- arriving */
const arrive = run([[0, at(2000)], [5, at(10)], [6, at(5)], [7, at(12)], [8, at(8)], [9, at(3)]]);
t("arriving and staying clocks him in at that site", () =>
  arrive.length === 1 && arrive[0].act === "in" && arrive[0].siteId === "A");
t("at the moment he ARRIVED, not when it was sure", () => arrive[0].at === T0 + 5 * MIN);
t("once, not on every fix after", () => arrive.length === 1);

const drivePast = run([[0, at(2000)], [1, at(40)], [2, at(500)], [3, at(1500)], [10, at(2000)]]);
t("driving past a site does not clock him in", () => drivePast.length === 0);

const vague = run([[0, at(0, 400)], [2, at(0, 400)], [5, at(0, 400)], [9, at(0, 400)]]);
t("a fix vaguer than 150m standing on the pin is not arriving", () => vague.length === 0);

const nopin = run([[0, at(0)], [5, at(0)]], OFF, [NOPIN]);
t("a site with no pin can never be arrived at", () => nopin.length === 0);

const edge = run([[0, at(105)], [4, at(105)]]);
t("just past the radius (pin on the address, home at the back) still counts", () =>
  edge.length === 1 && edge[0].siteId === "A");

const switched = run([[0, at(0)], [2, at(3000)], [4, at(3000)], [6, at(3000)]]);
t("moving to another site restarts the wait at the new one", () =>
  switched.length === 1 && switched[0].siteId === "B" && switched[0].at === T0 + 2 * MIN);

/* ---------------------------------------------------------- the window */
const SUN = Date.parse("2026-11-15T15:00:00Z"); // Sunday 10:00 Eastern
const TUE_NIGHT = Date.parse("2026-11-17T23:30:00Z"); // Tuesday 18:30 Eastern
const TUE_EARLY = Date.parse("2026-11-17T09:30:00Z"); // Tuesday 04:30 Eastern
t("Tuesday 7am is in the window", () => inWindow(T0, W));
t("Sunday is not a work day", () => !inWindow(SUN, W));
t("after the clock's own close is not", () => !inWindow(TUE_NIGHT, W));
t("before five in the morning is not", () => !inWindow(TUE_EARLY, W));
t("Saturday is, when Saturday is a day they sometimes work",
  () => inWindow(Date.parse("2026-11-21T14:00:00Z"), W));
{
  let mem = FRESH; let d = null;
  for (const m of [0, 4]) { const r = step(at(0), SUN + m * MIN, SITES, W, OFF, mem); mem = r.mem; d = d ?? r.decision; }
  t("arriving on a Sunday clocks nobody in", () => d === null);
}

/* ----------------------------------------------------------- leaving */
const AUTO = { on: true, auto: true, startedAt: T0 };
const leave = run([[0, at(0)], [120, at(0)], [125, at(4000)], [150, at(4000)], [171, at(4000)]], AUTO);
t("away from every site for 45 minutes clocks him out", () => leave.length === 1 && leave[0].act === "out");
t("at the last moment he was at a site", () => leave[0].at === T0 + 120 * MIN);

const lowes = run([[0, at(0)], [120, at(0)], [125, at(4000)], [150, at(4000)], [160, at(0)], [300, at(0)]], AUTO);
t("a Lowe's run shorter than that does not", () => lowes.length === 0);

const sitehop = run([[0, at(0)], [30, at(3000)], [200, at(3000)]], AUTO);
t("going from one job to another is not leaving", () => sitehop.length === 0);

const lead = run([[0, at(0)], [10, at(4000)], [200, at(4000)]], { on: true, auto: false, startedAt: T0 });
t("a shift his lead or the office started is never closed by the phone", () => lead.length === 0);

// South, well clear of both sites: the only thing that can keep him on is the
// vagueness rule (B lies north, and a fix near it would hide the rule).
const fog = run([[0, at(0)], [10, at(-4000, 400)], [200, at(-4000, 400)]], AUTO);
t("vague fixes are never evidence that he left", () => fog.length === 0);

const fromHome = run([[0, at(4000)], [100, at(4000)]], AUTO);
t("never earlier than the shift began", () => fromHome.length === 1 && fromHome[0].at === T0);

t("the waits are the ones described to the owner", () => ARRIVE_MS === 3 * MIN && AWAY_MS === 45 * MIN);

const bad = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
console.log(`\n${checks.length - bad.length}/${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
