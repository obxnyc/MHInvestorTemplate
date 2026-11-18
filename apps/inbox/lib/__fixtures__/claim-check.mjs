/**
 * Answering "which property is it?" must not teach the app something false.
 *
 *     node lib/__fixtures__/claim-check.mjs
 *
 * The owner texted his PLUMBER about a leak at 128 Sunflower Ln, and the
 * screen asked which property the thread was about. Two things would have
 * happened behind that answer, and both are wrong in a way nobody would
 * notice for weeks.
 *
 * AN ALIAS UNDER AN EMPTY KEY. `placeKey("")` is `""`, and this thread has
 * no place_hint -- neither does every single request the Rent Manager pull
 * files, which is most of the three hundred on the books. The route wrote
 * the alias regardless, so the answer meant "a request that said NOTHING
 * about where it is means this house", and the next answer overwrote it
 * with a different house. One such row is on the live database already,
 * written 2 November, pointing at a house.
 *
 * Nothing reads it today because every caller happens to pass a truthy
 * hint. That is luck. One unguarded lookup and three hundred unplaced
 * requests file themselves against whichever house was answered last.
 *
 * AND THE ADDRESS WRITTEN ONTO THE PERSON. The route stamped the chosen
 * unit onto whoever the thread names, with no test of who that is -- so
 * the plumber would be recorded as living at 128 Sunflower Ln, and he
 * works at every house on the books.
 *
 * `intake.ts` already refuses exactly this, in so many words: "a tenant
 * reports a leak at their neighbour's as readily as their own, and writing
 * an address onto a person from one request is how somebody's record
 * quietly becomes wrong." The rule was written down, in that file, and
 * this route did it anyway. **Writing it down is not the fix.**
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");

const gen = join(here, "alias-key.gen.mjs");
writeFileSync(gen, ts.transpileModule(
  readFileSync(join(lib, "alias.ts"), "utf8")
    .replace(/^import\b[\s\S]*?from\s*"[^"]*";/gm, ""),
  { compilerOptions: { target: 99, module: 99 } }).outputText);
const { placeKey } = await import(gen);

const checks = [];
const t = (name, fn, why) => checks.push([name, fn, why]);

/* ------------------------------------- the fact the whole guard rests on */

t("a hint of nothing makes a key of nothing", () =>
  ["", "   ", "\n", ",", " #, . ", "..."].every((h) => placeKey(h) === ""),
  "every one of these is a thread with no place on it, and they all collapse "
  + "to the same empty key -- which is why an alias under it is a claim "
  + "about EVERY such request rather than about one address");

t("a real hint still makes a key", () =>
  placeKey("1140 Northside Rd, Lot #45").length > 0);

/* ------------------------------------------------- what the route does */

const claim = readFileSync(
  join(lib, "..", "app/api/places/claim/route.ts"), "utf8");
const running = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/** The body of a `if (<cond>) {` block, and nothing after it. Matching
 *  across the whole file would let some later block answer for this one. */
function block(src, open) {
  const at = src.indexOf(open);
  if (at < 0) return null;
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}

t("an alias is written only under a key that says something", () => {
  const src = running(claim);
  const guarded = block(src, "if (key) {");
  return guarded !== null && /place_aliases"?\)?\s*\.upsert|from\("place_aliases"\)/.test(guarded)
      && (src.match(/place_aliases/g) ?? []).length
         === (guarded.match(/place_aliases/g) ?? []).length;
}, "cut to the block first, and then check there is no OTHER mention of the "
 + "table outside it -- a second write further down would be the same bug in "
 + "a new place and a match-anywhere test would never see it");

t("the key is derived, not assumed truthy", () =>
  /const key = placeKey\(hint\)/.test(running(claim)),
  "derived from the code rather than written into the check, so a rename "
  + "moves the guard with it");

t("the unit is written onto a CURRENT TENANT only", () => {
  const src = running(claim);
  const at = src.indexOf('from("contacts").update({ unit_id: unitId })');
  if (at < 0) return false;
  const around = src.slice(at, at + 260);
  return /\.eq\("party",\s*"current_tenant"\)/.test(around);
}, "a plumber, a neighbour, an investor and a lettings enquiry all reach "
 + "this route, and none of them live at the house being filed");

t("and only when they have no home on file yet", () => {
  const src = running(claim);
  const at = src.indexOf('from("contacts").update({ unit_id: unitId })');
  if (at < 0) return false;
  return /\.is\("unit_id",\s*null\)/.test(src.slice(at, at + 260));
}, "fill a blank, never an answer -- a tenant whose home is already recorded "
 + "has an answer, and one request about a neighbour's leak must not move it");

/* ------------------------------------------------- and nothing reads one */

const intake = readFileSync(join(lib, "intake.ts"), "utf8");

t("an empty key is never looked up either", () => {
  const src = running(intake);
  const at = src.indexOf('from("place_aliases")');
  if (at < 0) return false;
  /* Look BACK from the read, not forward: the guard has to be in front of
     it to do anything. */
  const before = src.slice(Math.max(0, at - 220), at);
  return /if\s*\(!\w+\)\s*return null;/.test(before);
}, "the write is guarded now, but the row written on 2 November is still "
 + "there -- the read has to refuse it too, or the fix depends on nobody "
 + "ever having typed the wrong thing before today");

/* ---------------------------------------------------------------- report */

let failed = 0;
for (const [name, fn, why] of checks) {
  let ok = false, blew = null;
  try { ok = (await fn()) === true; } catch (e) { blew = e.message; }
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${blew ? `threw: ${blew}` : why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : `\nnothing obviously wrong (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
