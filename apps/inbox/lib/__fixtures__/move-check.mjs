/**
 * Moving a home has to be easy, and "easy" is not a thing a type checker
 * or a picture can see.
 *
 * It shipped hard. A single-wide is about twelve pixels across at the
 * zoom that shows a whole park, so taking hold of one meant hitting a
 * target smaller than the mouse cursor's own point -- and missing it
 * grabbed the map and panned the park instead. Worse, a click while
 * moving homes did nothing at all: the handler returned early, on the
 * grounds that a card opening over the map was in the way. Which was
 * true, and which also meant there was no way to say WHICH home you
 * meant, so there was nothing for a key or a button to aim at.
 *
 * None of that is visible in a screenshot -- the map looks fine -- and
 * none of it fails a test that asks where the homes are. So the rules
 * themselves are the check.
 *
 *     node lib/__fixtures__/move-check.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const map = readFileSync(join(root, "components/ParkMap.tsx"), "utf8");
const near = readFileSync(join(root, "lib/nearpad.ts"), "utf8");
const screen = readFileSync(join(root, "components/ParkScreen.tsx"), "utf8");

const checks = [];
const t = (name, ok, why) => checks.push([name, ok, why]);

// --- the grab is forgiving -------------------------------------------
t("the pointer is handed over as an array, never as a bare {x, y}",
  /const hit = q\(\[point\.x, point\.y\]\)\[0\];/.test(near)
  && !/\bq\(point\)/.test(near),
  "MapLibre reads anything that is not a Point or an array as its "
  + "options, queries the whole viewport, and hands back the topmost "
  + "home on screen -- which looks like an answer and is not one.");

t("a miss widens into a box",
  /const near = q\(\[\s*\[point\.x - reach, point\.y - reach\],/.test(near),
  "padAt must retry over a box around the point, or a twelve-pixel pad "
  + "is the whole target again.");

t("and takes the nearest pad in it",
  /let far = Infinity;[\s\S]{0,400}?if \(d < far\)/.test(near),
  "Several pads inside the box and the first one in draw order is not "
  + "the one the hand was aiming at.");

t("taking hold of a home goes through padAt",
  /const f = padAt\(m, e\.point\);/.test(map)
  && !/const f = m\.queryRenderedFeatures\(e\.point, \{ layers: \["home-fill"\] \}\)\[0\];/
       .test(map),
  "The drag must not ask only what is exactly under the pointer.");

// --- choosing a home works while arranging ---------------------------
t("a click still chooses a home while the park is being arranged",
  !/m\.on\("click",[\s\S]{0,400}?if \(live\.current\.arranging\) return;/.test(map),
  "Returning here leaves nothing for an arrow key or a nudge button to "
  + "point at: the only way to say which home you meant becomes "
  + "successfully dragging it, which is the thing that was hard.");

t("the click a drag ends with is not a click",
  /if \(hauled\.current\) \{ hauled\.current = false; return; \}/.test(map)
  && /hauled\.current = true;/.test(map),
  "Otherwise the mouseup that ends a drag re-chooses the home, or "
  + "chooses whatever the pointer drifted over.");

t("and the flag is put down even when no click follows",
  /setTimeout\(\(\) => \{ hauled\.current = false; \}, 0\);/.test(map),
  "A drag that ends off the canvas leaves it up, and it eats the next "
  + "real click -- which reads as the map having stopped responding.");

t("taking hold of a home also chooses it",
  /if \(id\) live\.current\.onSelect\(id\);/.test(map),
  "So the buttons are already pointed at the home under the hand.");

// --- a park you can move, whether or not a map had heard of it -------
t("the park is drawn from its own plan when the map has nothing",
  /const real = harvested \?\? asPlanned;/.test(screen)
  && /const asPlanned = useMemo<RealPark \| null>/.test(screen),
  "Pasquotank's basemap carries no buildings for Northside, so the "
  + "harvest came back null -- and everything that works ON a home hung "
  + "off it. Fifty-nine pads drew, no Move homes button appeared, a drag "
  + "saved nothing and a nudge found no home to nudge.");

t("Move homes is offered on either kind of park",
  /\{real && \(\s*\n?\s*<button type="button" className=\{arranging \? "btn pri" : "btn"\}/
    .test(screen),
  "Keyed on the harvest, it never appears on a park the map has not "
  + "heard of -- which is the park that most needs moving by hand.");

t("but what the map actually handed over is still said separately",
  /\{harvested\?\.homes\?\.length \? \(/.test(screen),
  "A park drawn from a description and a park drawn from the map look "
  + "alike on screen and are not the same claim.");

t("and Fit to aerial still only shows when the map found nothing",
  /\{!harvested && \(/.test(screen),
  "It is the way to place a park the map could not find.");

// --- something to aim at ---------------------------------------------
t("the panel takes the card's place while homes are being placed",
  /const pad = arranging \|\| dropping \? here : null;/.test(screen)
  && /const card = arranging \|\| dropping \? null : open;/.test(screen),
  "A card opening over the park being arranged is in the way, which is "
  + "why choosing a home used to do nothing. It has to give way while a "
  + "home is being dropped too, or the one just put down cannot be "
  + "angled without leaving the mode.");

t("four arrows, one per way",
  ["Move north", "Move south", "Move east", "Move west"]
    .every((way) => screen.includes(way)),
  "Arrow keys are not reachable on a tablet in a driveway.");

t("a press is a stated distance, not a guess",
  /const STEP = 0\.5;/.test(screen),
  "Half a metre: small enough that no keystroke loses a home, large "
  + "enough that squaring a pad up is a press or two.");

// --- the keyboard behaves --------------------------------------------
t("the arrow keys give way to a text box",
  /tag === "INPUT" \|\| tag === "TEXTAREA"/.test(screen),
  "Otherwise retyping a lot number walks the home across the park, one "
  + "keystroke at a time.");

t("and give way to the browser's own shortcuts",
  /if \(!way \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey\) return;/.test(screen),
  "Cmd-left is back, not half a metre west.");

t("holding an arrow key does not write once per frame",
  /settling\.current = setTimeout\(/.test(screen)
  && /if \(settling\.current\) clearTimeout\(settling\.current\);/.test(screen),
  "Thirty presses a second is a park's worth of writes to move one pad "
  + "a metre.");

t("the timer is dropped when the screen goes",
  /useEffect\(\(\) => \(\) => \{ if \(settling\.current\) clearTimeout\(settling\.current\); \}, \[\]\);/
    .test(screen),
  "A save firing into a screen that has closed.");

// --- renumbering -----------------------------------------------------
t("a lot can be renumbered",
  /action: "rename"/.test(screen),
  "Labelling the lot numbers was the other half of the ask.");

t("and the plan's copy of the number follows",
  /r\.numbers\.map\(\(x\) => \(x === was \? want : x\)\)/.test(screen),
  "The number is kept twice -- on the unit and in the plan -- so both "
  + "are written or the map and the file disagree.");

t("and so does where the pad was put by hand",
  /next\[now\] = had\[lot\.id\];/.test(screen),
  "The browser's note is keyed by the number, so renaming orphans it "
  + "and the home jumps back to where the layout wants it.");

const route = readFileSync(
  join(root, "app/api/properties/[id]/plan/route.ts"), "utf8");

t("renaming onto a number already here is refused",
  /There is already a \$\{to\} here\./.test(route),
  "Two lots with the same number is a park where nothing can be filed "
  + "against the right one.");

t("and renaming a lot that is not here is not reported as done",
  /There is no lot \$\{from\} here, so there is nothing to rename\./.test(route)
  && /\.update\(\{ label: to \}\)[\s\S]{0,120}?\.select\("id"\)/.test(route),
  "A zero-row update succeeds. That is how an hour of dragging came to "
  + "be held in one browser and nowhere else.");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : "\nnothing obviously wrong");
process.exit(failed ? 1 : 0);
