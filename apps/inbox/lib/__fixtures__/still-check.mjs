/**
 * The map holds still while somebody is working on it.
 *
 * Putting fifty-nine homes down by hand meant zooming in on a corner of
 * the park and tapping. Between every pair of taps the map re-framed --
 * a four-hundred-millisecond zoom out, back to the whole parcel, so the
 * next tap had to begin by zooming in again. "It would fidget and
 * unzoom."
 *
 * The cause was one word in a cache key: the NUMBER of homes. Every home
 * changed it. What the framing is actually for is the park arriving on
 * screen, and that happens once.
 *
 *     node lib/__fixtures__/still-check.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(join(here, "reframe.gen.mjs"), ts.transpileModule(
  readFileSync(join(here, "reframe.ts"), "utf8").replace(/^export type [\s\S]*?\n\};\n/m, ""),
  { compilerOptions: { target: 99, module: 99 } }).outputText);
const { reframe, frameKey } = await import(join(here, "reframe.gen.mjs"));

const checks = [];
const t = (name, ok, why) => checks.push([name, ok, why]);

const AT = [-76.28638, 36.37140];
const park = (homes, centre = AT, boundary = true) => ({ boundary, homes, centre });

// --- the afternoon, tap by tap -----------------------------------------
{
  // The first home already down, dropping the rest. Nothing about the
  // park is changing except how many homes it has, which is the thing
  // the old key counted. Asked with nobody working, so that it is the
  // key being tested and not the guard in front of it -- either fix
  // alone stops the fidget, and a check that cannot tell them apart
  // cannot tell you which one broke.
  let was = frameKey(park(1));
  let moved = 0;
  for (let i = 2; i <= 59; i++) {
    const { key, now } = reframe(was, park(i), false);
    was = key;
    if (now) moved += 1;
  }
  t("one more home is not news, fifty-eight times over", moved === 0,
    `the map re-framed ${moved} times`);
}

{
  // And from an empty park: the first home IS the park arriving, but
  // not while somebody is standing on the map placing it.
  let was = frameKey(park(0));
  let moved = 0;
  for (let i = 1; i <= 59; i++) {
    const { key, now } = reframe(was, park(i), true);
    was = key;
    if (now) moved += 1;
  }
  t("and not even the first one, because nobody asked it to", moved === 0,
    `the map re-framed ${moved} times`);
}

{
  // The same taps with nobody working -- which is what the old key did
  // on every single one of them.
  let was = frameKey(park(0));
  let moved = 0;
  for (let i = 1; i <= 59; i++) {
    const { key, now } = reframe(was, park(i), false);
    was = key;
    if (now) moved += 1;
  }
  t("even idle, only the first home is the park arriving", moved === 1,
    `${moved} re-frames; going from none to some is one event, and `
    + "one to two is not an event at all");
}

// --- but the park arriving is still framed -----------------------------
t("a park that has just arrived is framed",
  reframe("", park(59), false).now);
t("and a park that moves county is framed again",
  reframe(frameKey(park(59)), park(59, [-78.91932, 35.09249]), false).now,
  "Keyed on the homes alone, a park re-described three hundred miles "
  + "away kept the same key and went on showing the old ground.");
t("and the county's own line arriving is framed",
  reframe(frameKey(park(59, AT, false)), park(59, AT, true), false).now);

// --- none of it while the tools are out --------------------------------
t("a park moving while the block is being fitted does not re-frame",
  !reframe(frameKey(park(59)), park(59, [-78.91932, 35.09249]), true).now,
  "Fitting the block to a photograph moves the centre on every drag, "
  + "and re-framing on each one is the map fighting the hand.");
t("but it is remembered as framed, so putting the tools down is calm",
  (() => {
    const moved = reframe(frameKey(park(59)), park(60), true);
    return !reframe(moved.key, park(60), false).now;
  })(),
  "Otherwise leaving the mode yanks the view to whatever arrived while "
  + "it was in use.");

// --- the rules the arithmetic cannot see -------------------------------
const map = readFileSync(join(here, "../components/ParkMap.tsx"), "utf8");

t("the map knows when somebody is working on it",
  /const working = Boolean\(fitting \|\| arranging \|\| drawing\);/.test(map),
  "Placing, moving, drawing the line and fitting the block are all "
  + "somebody having chosen a view.");

t("the framing decision is the one in lib/reframe",
  /const \{ key, now \} = reframe\(framed\.current, \{/.test(map)
  && !/real\?\.homes\?\.length \?\? 0\}:\$\{where\}/.test(map),
  "Two copies of this rule is one of them drifting back to the count.");

t("the panel opening does not re-zoom while the map is being worked on",
  /requestAnimationFrame\(\(\) => \(working \? m\.resize\(\) : frame\(\)\)\)/.test(map),
  "The box narrows when the panel opens, and MapLibre has to be told -- "
  + "but telling it its new size is the whole of what is needed. "
  + "Re-fitting as well zoomed the park out on the first tap of every "
  + "session and again every time the panel shut.");

t("and Fit view is still there for when they want it back",
  /onClick=\{frame\}>Fit view</.test(map));

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : "\nnothing obviously wrong");
process.exit(failed ? 1 : 0);
