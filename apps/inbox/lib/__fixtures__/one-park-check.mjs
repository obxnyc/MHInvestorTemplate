/**
 * No park is ever drawn as another park.
 *
 * This has now gone wrong three times, each time differently, and each
 * time it looked like the new park being laid out badly rather than the
 * old park still being on screen:
 *
 *   - the screen held Cross Creek as its starting plan, and the map
 *     reads the ground as soon as it loads, so a park in Pasquotank was
 *     harvested as Cross Creek before its own plan arrived;
 *   - fitting the block on harvest went through the same function as
 *     moving a slider, which saved, so opening an undescribed park
 *     wrote Cross Creek's streets onto it and reported it described;
 *   - the sentence above the map named Cross Creek's streets in prose.
 *
 * A picture does not catch these -- the picture looks like a park. What
 * catches them is the rule itself: outside the one line that defines an
 * empty plan, the screen may not mention the park that happens to be
 * written into the code.
 *
 *     node lib/__fixtures__/one-park-check.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const wrong = [];

const screen = readFileSync(join(root, "components/ParkScreen.tsx"), "utf8");

/** Line comments and block comments taken out, so a rule about what the
 *  code DOES is not answered by an explanation of what it used to do. */
function running(src) {
  const out = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let kept = "";
    for (let i = 0; i < line.length; i++) {
      if (inBlock) {
        if (line.startsWith("*/", i)) { inBlock = false; i += 1; }
        continue;
      }
      if (line.startsWith("/*", i)) { inBlock = true; i += 1; continue; }
      if (line.startsWith("//", i)) break;
      kept += line[i];
    }
    out.push(kept);
  }
  return out;
}

// The screen may not name the park written into the code. At all, now:
// the empty plan it starts from used to be `{ ...RETREAT, rows: [] }`,
// which took Cross Creek's rows off and kept its CENTRE, its bearing,
// the end its numbers count from and the road its deed line runs out
// to -- so every park nobody had placed opened on Fayetteville. The
// guard allowed that line by name, which is the fourth time one park
// has been drawn as another and the first time this check waved it
// through.
running(screen).forEach((line, i) => {
  if (!line.includes("RETREAT")) return;
  wrong.push(`ParkScreen.tsx:${i + 1} names the default park: ${line.trim()}`);
});

// Nowhere, and meaning it. A starting centre lifted from any real park
// is that park's ground, whatever else has been stripped off it.
if (!/^  centre: \[0, 0\],$/m.test(screen)) {
  wrong.push("the empty plan does not start at [0, 0] -- a park nobody "
    + "has placed must be nowhere, not somewhere else with the homes "
    + "taken off");
}
if (!/function somewhere\(plan: Plan\): boolean \{/.test(screen)
    || !/\{!somewhere\(plan\) \? \(/.test(screen)) {
  wrong.push("the screen draws a map for a park nobody has placed, which "
    + "means drawing it over whatever ground the starting plan carried");
}

// The map may not be told to harvest, and homes may not be drawn, for a
// park whose own plan has not arrived. `described` is null while that is
// still unknown, so the test has to be "is it true", never "is it false".
if (!/const blank = described !== true;/.test(screen)) {
  wrong.push("ParkScreen.tsx: `blank` must be `described !== true` -- "
    + "`=== false` leaves a window, while the answer is still unknown, "
    + "in which the default park draws.");
}
if (!/onHarvest=\{blank \? undefined : onHarvest\}/.test(screen)) {
  wrong.push("ParkScreen.tsx: the map must not harvest while blank.");
}

// Street names belong to the park, not to the source file. Comments may
// name them -- explaining why something is the way it is means naming
// the park it went wrong on -- but no line that runs may.
// A proper enough stripper: line comments, and block comments across
// however many lines they run -- which is what the first attempt at
// this missed, and it flagged its own explanation of the bug.
const code = [];
let inBlock = false;
for (const line of screen.split("\n")) {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    if (inBlock) {
      if (line.startsWith("*/", i)) { inBlock = false; i += 1; }
      continue;
    }
    if (line.startsWith("/*", i)) { inBlock = true; i += 1; continue; }
    if (line.startsWith("//", i)) break;
    out += line[i];
  }
  code.push(out);
}
code.forEach((line, i) => {
  for (const name of ["Lady Viola", "Lady Cheryl", "Pamalee", "pamalee"]) {
    if (line.includes(name)) {
      wrong.push(`ParkScreen.tsx:${i + 1} names "${name}" in code -- a street `
        + `of one park, on a screen that draws all of them: ${line.trim()}`);
    }
  }
});

// The frontage road the line runs out to is a fact about a park, and
// lived in the screen as a regular expression that ran on every one.
if (/\/pamalee\/i/.test(code.join("\n"))) {
  wrong.push("ParkScreen.tsx matches a road by name -- that belongs on the plan.");
}

// The browser's cached position must never outlive the park's own plan.
// That cache was written by the fitting that runs on load, while the
// screen still held the default park, so it held the DEFAULT park's
// centre -- and applying it over a plan fetched from the database put a
// park in Pasquotank back in Fayetteville on every single reload.
if (!/localStorage\.setItem\(key, JSON\.stringify\(\{\s*\n\s*centre: mine\.centre/.test(screen)) {
  wrong.push("ParkScreen.tsx: loading a park's plan must overwrite the "
    + "browser's cached position, or a stale centre comes back on reload.");
}
const seed = screen.match(/const saved = localStorage\.getItem\(key\);[\s\S]*?\}, \[([^\]]*)\]\);/);
if (!seed) {
  wrong.push("ParkScreen.tsx: could not find the cached-position effect.");
} else if (seed[1].replace(/\s/g, "") !== "key") {
  wrong.push("ParkScreen.tsx: the cached position must be seeded once, on the "
    + `way in. Re-running it puts the stale centre back. Deps are [${seed[1].trim()}].`);
}

const map = readFileSync(join(root, "components/ParkMap.tsx"), "utf8");
if (!/if \(!live\.current\.onHarvest\) return;/.test(map)) {
  wrong.push("ParkMap.tsx: a harvest attempt with nobody listening must not "
    + "count against the allowance, or the allowance is gone before the "
    + "park's plan arrives.");
}

if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
