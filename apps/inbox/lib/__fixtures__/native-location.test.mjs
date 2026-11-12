/** Location from the installed app.  Run: node lib/__fixtures__/native-location.test.mjs
 *
 *  The plugin hands over a fix about once a second; the trail wants one every
 *  two minutes. Every case here is one where the wrong rule gives a different
 *  answer: fixes every thirty seconds (a throttle that restarts its wait on a
 *  DROPPED fix sends once and never again), a fix at exactly two minutes (a
 *  `>` where `>=` belongs waits a whole extra fix), a refusal that arrives
 *  before any fix (resolving anyway would hand the screen a tracker that is
 *  tracking nothing and say nothing), and a fix that lands after stop (the
 *  trail belongs to the shift, not to the phone).
 *
 *  The native plugin is a stand-in on a fake `window.Capacitor`, because the
 *  module only ever reaches it at runtime through that global.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = process.env.NATIVE_LOCATION_SRC ?? join(here, "..", "native-location.ts");
const js = ts.transpileModule(readFileSync(src, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const M = await import("data:text/javascript," + encodeURIComponent(js));
const { makeThrottle, toFix, isNativeApp, startShiftTracking, postPing, nativePlatform, PING_EVERY_MS } = M;

const checks = [];
const t = async (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!(await ok()) : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};
const MIN = 60_000;
const tick = () => new Promise((r) => setTimeout(r, 0));

/* -------------------------------------------------------------- throttle */
const run = (times, every = PING_EVERY_MS) => {
  const due = makeThrottle(every);
  return times.filter((at) => due(at));
};
const every30s = Array.from({ length: 11 }, (_, i) => i * 30_000); // 0 .. 5:00
await t("the interval is two minutes", () => PING_EVERY_MS === 2 * MIN);
await t("the first fix goes at once", () => run([5_000])[0] === 5_000);
await t("a fix a second later does not", () => run([0, 1_000]).join() === "0");
await t("fixes every 30s: one at 0, 2:00, 4:00 -- counted from the last SENT",
  () => run(every30s).join() === [0, 2 * MIN, 4 * MIN].join());
await t("exactly two minutes after the last send goes", () => run([0, 2 * MIN]).join() === `0,${2 * MIN}`);
await t("a minute fifty-nine does not", () => run([0, 2 * MIN - 1000]).join() === "0");
await t("a clock that jumps backwards sends rather than going quiet",
  () => run([10 * MIN, 1 * MIN]).join() === `${10 * MIN},${1 * MIN}`);
await t("one throttle per tracker: a second starts fresh", () => {
  const a = makeThrottle(); a(0); const b = makeThrottle(); return b(1_000) === true;
});

/* ----------------------------------------------------------------- toFix */
await t("plugin location becomes lat/lng/accuracy", () => {
  const f = toFix({ latitude: 35.1, longitude: -78.9, accuracy: 12, altitude: null });
  return f && f.lat === 35.1 && f.lng === -78.9 && f.accuracy === 12 && Object.keys(f).length === 3;
});
await t("no accuracy is null, never zero", () => toFix({ latitude: 1, longitude: 2 }).accuracy === null);
await t("a nonsense accuracy is null", () => toFix({ latitude: 1, longitude: 2, accuracy: NaN }).accuracy === null
  && toFix({ latitude: 1, longitude: 2, accuracy: -5 }).accuracy === null);
await t("an accuracy of exactly zero is kept", () => toFix({ latitude: 1, longitude: 2, accuracy: 0 }).accuracy === 0);
await t("no position is no fix", () => toFix({ accuracy: 10 }) === null && toFix(null) === null);
await t("a position that is not on the earth is no fix",
  () => toFix({ latitude: 95, longitude: 0 }) === null && toFix({ latitude: NaN, longitude: 0 }) === null);
await t("a string where a number belongs is no fix", () => toFix({ latitude: "35", longitude: "-78" }) === null);

/* ------------------------------------------------------------ isNativeApp */
const setWin = (w) => { if (w === undefined) delete globalThis.window; else globalThis.window = w; };
setWin(undefined);
await t("on the server: not native, and does not throw", () => isNativeApp() === false);
setWin({});
await t("in a browser with no Capacitor: not native", () => isNativeApp() === false);
setWin({ Capacitor: { isNativePlatform: () => false, Plugins: {} } });
await t("Capacitor present but on the web: not native", () => isNativeApp() === false);
setWin({ Capacitor: { isNativePlatform: () => true, Plugins: {} } });
await t("inside the app: native", () => isNativeApp() === true);
setWin({ Capacitor: { isNativePlatform: () => { throw new Error("x"); } } });
await t("a bridge that throws reads as not native", () => isNativeApp() === false);

/* --------------------------------------------------------- the tracking */
function stand() {
  const s = { cb: null, opts: null, removed: [], added: 0 };
  s.geo = {
    addWatcher(opts, cb) { s.opts = opts; s.cb = cb; s.added++; return Promise.resolve("w1"); },
    removeWatcher({ id }) { s.removed.push(id); return Promise.resolve(); },
  };
  setWin({ Capacitor: { isNativePlatform: () => true, Plugins: { BackgroundGeolocation: s.geo } } });
  return s;
}
const loc = (lat, acc = 10) => ({ latitude: lat, longitude: -78.9, accuracy: acc });

setWin({});
await t("outside the app: rejects not-native and starts nothing", async () => {
  try { await startShiftTracking(() => {}); return false; } catch (e) { return e.message === "not-native"; }
});

{
  const s = stand();
  let clock = 0; const sent = [];
  const p = startShiftTracking((f) => sent.push(f), { now: () => clock, settleMs: 60_000 });
  await tick();
  await t("asks the plugin with the agreed options", () =>
    s.opts.backgroundTitle === "On the clock"
    && s.opts.backgroundMessage === "Larabee is recording your location while you're clocked in."
    && s.opts.requestPermissions === true && s.opts.stale === false && s.opts.distanceFilter === 0);
  for (let i = 0; i <= 10; i++) { clock = i * 30_000; s.cb(loc(35 + i / 1000)); }
  const stop = await p;
  await t("the first fix goes at once and resolves the start", () => sent[0]?.lat === 35);
  await t("a fix every 30s for five minutes sends three", () => sent.length === 3);
  await t("the second sent is the one at two minutes", () => sent[1]?.lat === 35.004);
  await t("an error that is not a refusal is ignored", () => { s.cb(undefined, { code: "OTHER" }); return s.removed.length === 0; });
  stop();
  await tick();
  await t("stop removes the watcher by its id", () => s.removed.join() === "w1");
  clock = 60 * MIN; s.cb(loc(36));
  await t("a fix after stop is not sent", () => sent.length === 3);
  stop(); await tick();
  await t("stopping twice removes once", () => s.removed.length === 1);
}

{
  const s = stand();
  const sent = [];
  const p = startShiftTracking((f) => sent.push(f), { now: () => 0, settleMs: 60_000 });
  await tick();
  s.cb(undefined, { code: "NOT_AUTHORIZED", message: "Permission denied." });
  let why = null;
  try { await p; } catch (e) { why = e.message; }
  await tick();
  await t("refused before any fix: rejects with location-denied", () => why === "location-denied");
  await t("and the watcher is removed", () => s.removed.join() === "w1");
  await t("and nothing was sent", () => sent.length === 0);
}

{
  // The id comes back AFTER the refusal: it must still be removed.
  const s = stand();
  let release;
  s.geo.addWatcher = (opts, cb) => { s.cb = cb; return new Promise((r) => { release = r; }); };
  const p = startShiftTracking(() => {}, { settleMs: 60_000 });
  s.cb(undefined, { code: "NOT_AUTHORIZED" });
  await p.catch(() => null);
  release("late-id"); await tick(); await tick();
  await t("refused before the id arrived: the late id is still removed", () => s.removed.join() === "late-id");
}

{
  const s = stand();
  let denied = 0;
  const p = startShiftTracking(() => {}, { now: () => 0, settleMs: 5, onDenied: () => denied++ });
  // Settles on the timer with no fix at all. Raced against a deadline so a
  // start that never settles is a named failure, not a run that dies silent.
  const stop = await Promise.race([p, new Promise((r) => setTimeout(() => r("hung"), 500))]);
  await t("no fix and no answer: still hands back a stop", () => typeof stop === "function");
  s.cb(undefined, { code: "NOT_AUTHORIZED" });
  await tick();
  await t("a refusal after that is reported through onDenied", () => denied === 1);
  await t("and stops the watcher", () => s.removed.join() === "w1");
}

/* ---------------------------------------------------------- postPing */
// On iPhone the sign-in cookie is in WKWebView's store and native HTTP does
// not send it, so the ping must go by fetch there. On Android, native HTTP,
// because the WebView is throttled in the background.
{
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { sent.push(["fetch", String(url)]); return { ok: true }; };
  const http = { request: async (o) => { sent.push(["native", o.url]); return { status: 200 }; } };
  const fix = { lat: 35, lng: -78.9, accuracy: 10 };
  const as = (platform) => setWin({
    location: { href: "https://app.larabeehomesllc.com/clock" },
    Capacitor: { isNativePlatform: () => true, getPlatform: () => platform, Plugins: { CapacitorHttp: http } },
  });

  as("android"); sent.length = 0; await postPing(fix);
  await t("android: the ping goes by native HTTP", () => sent.length === 1 && sent[0][0] === "native"
    && sent[0][1] === "https://app.larabeehomesllc.com/api/clock/ping");
  as("ios"); sent.length = 0; await postPing(fix);
  await t("iphone: the ping goes by fetch, never native HTTP", () => sent.length === 1 && sent[0][0] === "fetch");
  setWin({ location: { href: "https://x/clock" }, Capacitor: { isNativePlatform: () => false, Plugins: { CapacitorHttp: http } } });
  sent.length = 0; await postPing(fix);
  await t("a browser: fetch", () => sent.length === 1 && sent[0][0] === "fetch");
  as("ios");
  await t("nativePlatform names the phone", () => nativePlatform() === "ios");
  globalThis.fetch = realFetch;
}

const bad = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
console.log(`\n${checks.length - bad.length}/${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
