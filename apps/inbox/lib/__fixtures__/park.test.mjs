/** Laying a park out as a plan. Run: node lib/__fixtures__/park.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(readFileSync(join(here, "..", "park.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { layRow, clamp, angleOf, nextLabel, HOME } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (n, ok) => checks.push([n, ok]);
const near = (a, b) => Math.abs(a - b) < 1e-6;

// Lady Cheryl, odds, fourteen pads across the middle of the plan.
const cheryl = layRow({
  count: 14, startAt: 3101, step: 2,
  from: { x: 0.15, y: 0.60 }, to: { x: 0.80, y: 0.45 }, rot: 30,
});

t("fourteen pads", cheryl.length === 14);
t("the first is numbered as asked", cheryl[0].label === "3101");
t("and they step in twos", cheryl[1].label === "3103" && cheryl[13].label === "3127");

// The one that looks fine until somebody drags the last home to close a gap
// that was never theirs to close.
t("the first sits exactly on the start",
  near(cheryl[0].x, 0.15) && near(cheryl[0].y, 0.60));
t("and the last sits exactly on the end",
  near(cheryl[13].x, 0.80) && near(cheryl[13].y, 0.45));

{
  const gaps = cheryl.slice(1).map((l, i) => l.x - cheryl[i].x);
  t("the spacing is even all the way down",
    gaps.every((g) => Math.abs(g - gaps[0]) < 1e-4));
}
t("every home carries the row's angle", cheryl.every((l) => l.rot === 30));

// Degenerate rows must not divide by zero or vanish.
t("one pad is one pad, on the start point", (() => {
  const one = layRow({ count: 1, startAt: 5, step: 2,
    from: { x: 0.2, y: 0.2 }, to: { x: 0.9, y: 0.9 }, rot: 0 });
  return one.length === 1 && near(one[0].x, 0.2) && one[0].label === "5";
})());
t("no pads is no pads, not a crash",
  layRow({ count: 0, startAt: 1, step: 1,
    from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, rot: 0 }).length === 0);

// Positions are stored to five places; the screen and the database should
// agree rather than differ in the last one and look like the plan moved.
t("positions are rounded to what the column holds",
  cheryl.every((l) => String(l.x).replace(/^\d+\.?/, "").length <= 5));

// --- keeping homes on the canvas ---
t("dragged off the left edge, it stops at the edge", clamp(-0.3) === 0);
t("dragged off the right, likewise", clamp(1.4) === 1);
t("and an ordinary position is left alone", near(clamp(0.42), 0.42));

// --- the angle comes from the street ---
// A row running left to right: homes stand across it, facing the road.
t("a horizontal street gives homes a quarter turn",
  angleOf({ x: 0, y: 0 }, { x: 1, y: 0 }) === 90);
t("a vertical street gives them none",
  angleOf({ x: 0, y: 0 }, { x: 0, y: 1 }) === 180);
t("and Lady Cheryl's slight rise is a slight angle", (() => {
  const a = angleOf({ x: 0.15, y: 0.60 }, { x: 0.80, y: 0.45 });
  return a > 60 && a < 90;
})());

// --- adding one more pad to a street ---
t("the next pad keeps the row's own step",
  nextLabel(["3101", "3103", "3105"]) === "3107");
t("a park numbered plainly steps by one",
  nextLabel(["1", "2", "3"]) === "4");
t("a lone pad gets the next number up", nextLabel(["12"]) === "13");
t("an empty street starts at one", nextLabel([]) === "1");
t("a label with a hash on it is still a number",
  nextLabel(["#7", "#9"]) === "11");

// Homes are all one size. A drawing that varies them implies a difference
// that is not there.
t("there is exactly one home size", typeof HOME.w === "number" && typeof HOME.h === "number");
t("and it is taller than it is wide, like a single-wide seen from above",
  HOME.h > HOME.w);

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
