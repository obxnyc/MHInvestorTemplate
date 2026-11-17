/** Clocking in at a job.  Run: node lib/__fixtures__/clockin.test.mjs
 *
 *  The owner clocked in at a job he was not at and nothing asked. Every case
 *  here is one where the wrong rule gives a DIFFERENT answer: the vague fix
 *  five miles off (the fence says "cannot tell", far must say far), the two
 *  sites both near (only the nearer is suggested), the fix just outside the
 *  radius but inside its own error bar (not far -- asking an honest man
 *  "are you sure?" every morning teaches him to tap yes without reading).
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
const js = tr("clockin.ts").replace(/from\s+["']\.\/fence["']/, `from "${fenceUrl}"`);
const { suggest, check, howFar } = await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

// Metres to degrees of latitude on the same sphere metresBetween uses
// (R = 6,371,000 m), so a distance put in is the distance read back.
const N = (m) => m / (6_371_000 * Math.PI / 180);
const BASE = { lat: 35.1, lng: -78.9 };
const site = (id, north, radius = 75, extra = {}) => ({
  id, name: `Site ${id}`, address: `${id} Main St`, lat: BASE.lat + N(north), lng: BASE.lng, radius, ...extra,
});
const A = site("A", 0), B = site("B", 400), FAR = site("F", 8000), NOPIN = site("X", 0, 75, { lat: null, lng: null });
const PLACES = [FAR, B, A, NOPIN];
const fix = (north, accuracy = 15) => ({ lat: BASE.lat + N(north), lng: BASE.lng, accuracy });

/* --------------------------------------------------------------- suggest */
const s0 = suggest(fix(20), PLACES);
t("standing at A: A is suggested", () => s0.here?.place.id === "A");
t("nearby is nearest first", () => s0.nearby.map((n) => n.place.id).join() === "A,B,F");
t("a job with no pin is never in nearby", () => !s0.nearby.some((n) => n.place.id === "X"));
t("between A and B but nearer B: B, not both", () => suggest(fix(350), PLACES).here?.place.id === "B");
t("in a field a mile from anything: nothing suggested", () => suggest(fix(-1600), PLACES).here === null);
t("but nearby still lists the closest", () => suggest(fix(-1600), PLACES).nearby[0]?.place.id === "A");
t("no position: nothing suggested, nothing nearby", () => {
  const r = suggest(null, PLACES); return r.here === null && r.nearby.length === 0;
});
t("a job 100 miles off is not 'nearby'", () =>
  !suggest(fix(0), [...PLACES, site("Z", 160_000)]).nearby.some((n) => n.place.id === "Z"));

/* ----------------------------------------------------------------- check */
t("at the job: ok", () => check(fix(20), A).kind === "ok");
t("5 miles away, accurate: far", () => check(fix(8000), A).kind === "far");
t("5 miles away, fix only good to 900m: STILL far (the fence would say cannot-tell)",
  () => check(fix(8000, 900), A).kind === "far");
t("just outside the radius but inside the error bar: not far", () => check(fix(120, 60), A).kind === "ok");
t("just outside the radius with a tight fix: far", () => check(fix(120, 10), A).kind === "far");
t("far carries the distance", () => {
  const c = check(fix(8000), A); return c.kind === "far" && Math.abs(c.metres - 8000) < 5;
});
t("no position: says so", () => check(null, A).kind === "nofix");
t("a job with no pin: says so rather than ok", () => check(fix(0), NOPIN).kind === "nopin");
t("a park's big radius is honoured: 200m into a 250m park is ok",
  () => check(fix(200), site("P", 0, 250)).kind === "ok");

/* ---------------------------------------------------------------- howFar */
t("five miles reads as miles", () => howFar(8047) === "5.0 mi");
t("a short way reads as feet", () => howFar(100) === "350 ft");
t("never '0 ft'", () => howFar(1) === "50 ft");
t("long way, whole miles", () => howFar(40_000) === "25 mi");

const bad = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
console.log(`\n${checks.length - bad.length}/${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
