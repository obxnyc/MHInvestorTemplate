/** Clock-in photos.  Run: node lib/__fixtures__/clock-photos.test.mjs
 *
 *  "I need to make sure they can't have a buddy who is there take a picture
 *  and send it to them." Each case here is one way round the rule, and each
 *  must be refused for its own reason -- a check that refuses them all for
 *  one reason cannot tell you which hole it is plugging.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(readFileSync(join(here, "..", "clock-photos.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { checkPhotos, PHOTO_FRESH_MS } = await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

const ME = "11111111-1111-1111-1111-111111111111";
const BUDDY = "22222222-2222-2222-2222-222222222222";
const NOW = Date.UTC(2026, 10, 12, 13, 0);
const ph = (who, msAgo, kind, ext = "jpg") => `clock/${who}/${NOW - msAgo}-${kind}.${ext}`;

const good = [ph(ME, 60_000, "face"), ph(ME, 30_000, "site")];
t("his own face and site, a minute old: ok", () => checkPhotos(good, ME, NOW).ok === true);
t("returns which is which", () => {
  const r = checkPhotos(good, ME, NOW); return r.ok && r.face === good[0] && r.site === good[1];
});
t("a buddy's upload is refused, and says why", () => {
  const r = checkPhotos([ph(BUDDY, 1000, "face"), ph(ME, 1000, "site")], ME, NOW);
  return !r.ok && /somebody else/.test(r.why);
});
t("yesterday's photo is refused, and says why", () => {
  const r = checkPhotos([ph(ME, 864e5, "face"), ph(ME, 1000, "site")], ME, NOW);
  return !r.ok && /too old/.test(r.why);
});
t("just inside fifteen minutes is fine", () =>
  checkPhotos([ph(ME, PHOTO_FRESH_MS - 1000, "face"), ph(ME, 1000, "site")], ME, NOW).ok === true);
t("just outside it is not", () =>
  checkPhotos([ph(ME, PHOTO_FRESH_MS + 1000, "face"), ph(ME, 1000, "site")], ME, NOW).ok === false);
t("a 'photo' from the future is refused", () =>
  checkPhotos([ph(ME, -5 * 60_000, "face"), ph(ME, 1000, "site")], ME, NOW).ok === false);
t("a path not made by our upload is refused", () =>
  checkPhotos(["dm/abc/0-face.jpg", ph(ME, 1000, "site")], ME, NOW).ok === false);
t("a path trying to climb out is refused", () =>
  checkPhotos([`clock/${ME}/../${BUDDY}/${NOW}-face.jpg`, ph(ME, 1000, "site")], ME, NOW).ok === false);
t("only a selfie: asks for the job too", () => {
  const r = checkPhotos([ph(ME, 1000, "face")], ME, NOW); return !r.ok && /job/.test(r.why);
});
t("only the job: asks for a selfie", () => {
  const r = checkPhotos([ph(ME, 1000, "site")], ME, NOW); return !r.ok && /selfie/.test(r.why);
});
t("nothing at all: asks for a selfie", () => checkPhotos(undefined, ME, NOW).ok === false);

const bad = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
console.log(`\n${checks.length - bad.length}/${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
