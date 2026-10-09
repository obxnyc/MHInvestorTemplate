/**
 * A home put down where the finger lands.
 *
 * Northside is not rows. It is a loop with homes along it, a cluster in
 * the middle at its own angle, and three that never fit any pattern --
 * the office, the laundry, the one turned sideways at the end. Every
 * attempt to say that with one bearing and one spacing produced a park
 * that was wrong in a way no slider could fix, and the last attempt
 * stacked fifty-nine pads on top of each other.
 *
 * So a home can be dropped on the map, and then given its own angle and
 * its own rectangle. This checks the arithmetic of that: it lands where
 * you tapped, it points where you said, it is the size you typed, and
 * doing any of it to one home does not move its neighbours.
 *
 *     node lib/__fixtures__/drop-check.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of ["footprint", "parkplan"]) {
  const src = readFileSync(join(here, `${f}.ts`), "utf8").replace(/^import type .*$/gm, "");
  writeFileSync(join(here, `${f}.gen.mjs`),
    ts.transpileModule(src, { compilerOptions: { target: 99, module: 99 } }).outputText
      .replace(/from "\.\/(\w+)"/g, `from "${join(here, "$1.gen.mjs")}"`));
}
const { layOut, homeAt, nextLabel, filedAs, placed } =
  await import(join(here, "parkplan.gen.mjs"));
const { metresBetween, SINGLE_WIDE, middleOfRing, footprint } =
  await import(join(here, "footprint.gen.mjs"));

const checks = [];
const t = (name, ok, why) => checks.push([name, ok, why]);
const near = (a, b, e) => Math.abs(a - b) < e;

/** Northside, as it is described: one street, two rows down the loop. */
const PARK = {
  naming: "lot", address: "1140 Northside Rd",
  centre: [-76.28638, 36.37140], bearing: 177.8, size: SINGLE_WIDE,
  padSpacing: 9.6, pairGap: 45, streetGap: 60, homeTurn: 0,
  rows: [
    { street: "1140 Northside Rd", side: "N",
      numbers: Array.from({ length: 30 }, (_, i) => String(i + 1)) },
    { street: "1140 Northside Rd", side: "S",
      numbers: Array.from({ length: 29 }, (_, i) => String(i + 31)) },
  ],
};

// --- the next number ---------------------------------------------------
t("the next number carries on from the highest", nextLabel(PARK) === "60");
t("a gap in the middle does not get re-used", nextLabel({
  ...PARK,
  rows: [{ ...PARK.rows[0], numbers: ["1", "2", "4"] }],
}) === "5", "A park where 3 was taken out still wants 5 next, not a second 4.");
t("a park of no numbers at all still counts", nextLabel({
  ...PARK, rows: [{ ...PARK.rows[0], numbers: ["A", "B"] }],
}) === "3");
t("and an empty park starts at one", nextLabel({ ...PARK, rows: [] }) === "1");

// --- where it lands ----------------------------------------------------
const TAP = [-76.2872, 36.3706];
const dropped = { ...PARK, rows: [...PARK.rows, homeAt(PARK, TAP, nextLabel(PARK))] };
const all = layOut(dropped);
const mine = all.find((h) => h.label === "60");

t("the home is there", Boolean(mine));
t("it lands exactly where the finger did",
  near(metresBetween([mine.lng, mine.lat], TAP), 0, 0.01),
  `${metresBetween([mine.lng, mine.lat], TAP).toFixed(2)} m away`);
t("it is filed the way this park files a lot",
  mine.filed === "1140 Northside Rd Lot 60",
  `filed as ${mine.filed}`);
t("it is a row placed by its own ends, owing nothing to the grid",
  placed(dropped.rows[dropped.rows.length - 1]));
t("it starts square to the park, like every other home",
  near(mine.bearing, all[0].bearing, 0.01),
  `${mine.bearing.toFixed(1)} against ${all[0].bearing.toFixed(1)}`);
t("and nothing else moved", PARK.rows.flatMap((r) => r.numbers).every((num) => {
  const was = layOut(PARK).find((h) => h.label === num);
  const now = all.find((h) => h.label === num);
  return was && now && metresBetween([was.lng, was.lat], [now.lng, now.lat]) < 1e-6;
}));

// --- its own angle -----------------------------------------------------
{
  const turned = { ...dropped, rows: dropped.rows.map((r) =>
    (r.numbers.length === 1 && r.numbers[0] === "60" ? { ...r, turn: 37 } : r)) };
  const homes = layOut(turned);
  const it = homes.find((h) => h.label === "60");
  t("turning it turns it by exactly that much",
    near(((it.bearing - mine.bearing) + 720) % 360, 37, 0.01),
    `moved ${(((it.bearing - mine.bearing) + 720) % 360).toFixed(1)}°`);
  t("turning it does not move it",
    near(metresBetween([it.lng, it.lat], TAP), 0, 0.01));
  t("and leaves every other home square",
    homes.filter((h) => h.label !== "60")
      .every((h) => near(h.bearing, mine.bearing, 0.01)));
}

// --- its own rectangle -------------------------------------------------
{
  // A double-wide: 28 by 60 rather than 16 by 60.
  const WIDE = { width: 8.53, length: 18.29 };
  const big = { ...dropped, rows: dropped.rows.map((r) =>
    (r.numbers.length === 1 && r.numbers[0] === "60" ? { ...r, size: WIDE } : r)) };
  const homes = layOut(big);
  const it = homes.find((h) => h.label === "60");
  t("the pad carries the size it was given",
    it.size && near(it.size.width, WIDE.width, 1e-9));
  const ring = footprint(it.lat, it.lng, it.bearing, it.size ?? big.size);
  t(`and draws at it (${metresBetween(ring[0], ring[1]).toFixed(2)} m wide)`,
    near(metresBetween(ring[0], ring[1]), WIDE.width, 0.05));
  t("its middle is still where the finger landed",
    near(metresBetween(middleOfRing(ring), TAP), 0, 0.01));
  const other = homes.find((h) => h.label === "1");
  t("every other home is still the park's own size", other.size === undefined,
    "A size on a row is that row's. Nothing else should pick it up.");
}

// --- a home taken out of a row keeps where and how it stands -----------
{
  const row = PARK.rows[0];
  const was = layOut(PARK).find((h) => h.label === "5");
  const rest = { ...row, numbers: row.numbers.filter((x) => x !== "5") };
  const split = {
    ...PARK,
    rows: [rest, PARK.rows[1], homeAt(PARK, [was.lng, was.lat], "5", {
      street: row.street, head: was.bearing - 90 - (PARK.homeTurn ?? 0),
    })],
  };
  const now = layOut(split).find((h) => h.label === "5");
  t("a home given its own shape does not move",
    near(metresBetween([now.lng, now.lat], [was.lng, was.lat]), 0, 0.01),
    `${metresBetween([now.lng, now.lat], [was.lng, was.lat]).toFixed(2)} m`);
  t("and does not turn", near(now.bearing, was.bearing, 0.01),
    `${now.bearing.toFixed(1)} against ${was.bearing.toFixed(1)}`);
  t("the row it left closes up to 29", rest.numbers.length === 29);
  t("and the park still has every lot",
    layOut(split).length === layOut(PARK).length);
}

// --- a home taken off the map ------------------------------------------
{
  const gone = {
    ...PARK,
    rows: PARK.rows.flatMap((r) => {
      const left = { ...r, numbers: r.numbers.filter((x) => x !== "5") };
      return left.numbers.length ? [left] : [];
    }),
  };
  t("taking one off the map leaves the rest", layOut(gone).length === 58);
  t("and it is not drawn", !layOut(gone).some((h) => h.label === "5"));
  t("the number it had is not handed out again", nextLabel(gone) === "60",
    "Re-using a number puts two homes on one lot's paperwork.");
}

// --- the screen offers it ----------------------------------------------
const screen = readFileSync(join(here, "../components/ParkScreen.tsx"), "utf8");
t("Add a home is a button",
  /\{dropping \? "Done" : "Add a home"\}/.test(screen));
t("and a tap in that mode drops one",
  /if \(dropping\) \{[\s\S]{0,400}?homeAt\(plan, at, label\)/.test(screen));
t("the homes already drawn can be cleared out of the way",
  /Clear all \{countOf\(plan\)\} first/.test(screen)
  && /remember\(\{ \.\.\.plan, rows: \[\] \}\);/.test(screen),
  "Fifty-nine pads stacked on each other are in the way of the ones "
  + "being put down, and taking them off one at a time is fifty-nine "
  + "confirmations.");

t("and clearing them is offered where it is needed, not in the header",
  /\{dropping && \([\s\S]{0,1400}?\{countOf\(plan\) > 0 && \([\s\S]{0,900}?Clear all/
    .test(screen),
  "A destructive button in the header is a button somebody presses by "
  + "accident; inside Add a home it is the step before the next one.");

t("clearing says what it does not touch",
  /every lot stays on file with[\s\S]{0,120}?recorded against it/.test(screen),
  "Taking a home off the drawing is not deleting the lot, and somebody "
  + "about to lose an afternoon needs to be told which it is.");

t("a park with no rows is not asked of the map",
  /if \(!base\.rows\.length\) return;/.test(screen),
  "With no rows there are no streets to look for, and the screen said "
  + "\"the map here has no\" with nothing after it.");

t("the angle and the size are offered in feet and degrees",
  /Wide \(ft\)/.test(screen) && /Long \(ft\)/.test(screen) && /Angle/.test(screen),
  "A home is 16 by 60 to everyone who has stood next to one.");
t("a cleared size field does not shrink the home to nothing",
  /if \(v >= 4 && v <= 200\)/.test(screen),
  "A field emptied on the way to a new number reads as zero, and a pad "
  + "of no width is a pad nobody can find again.");
t("and the destructive button does not borrow .btn.danger",
  /className="moveoff"/.test(screen) && !/className="btn danger"/.test(screen),
  "`.btn.danger` is the filled red button, so overriding only its "
  + "colour gives red on red: a block with the words invisible in it.");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : "\nnothing obviously wrong");
process.exit(failed ? 1 : 0);
