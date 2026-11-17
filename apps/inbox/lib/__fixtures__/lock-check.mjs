// A locked park layout stays put.
//
// The Retreat's sixty homes were placed by hand, one at a time, and then
// "distorted everywhere". A lock is the owner saying the layout is right,
// and these are the rules that make it mean that. Source rules, because
// the failure is a write that should not happen, and nothing about that
// is visible in a picture of the park.
//
//   node lib/__fixtures__/lock-check.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "..", "..", p), "utf8")
  // Comments explain the rule in the same words the rule uses; strip them
  // so a sentence about a guard is never mistaken for the guard.
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const route = read("app/api/properties/[id]/plan/route.ts");
const screen = read("components/ParkScreen.tsx");

const results = [];
const t = (name, fn) => {
  let ok = false, why = "";
  try { ok = Boolean(fn()); } catch (e) { why = ` (threw: ${e.message})`; }
  results.push(`${ok ? "  ok " : "FAIL"}  ${name}${why}`);
};

// --- the server ---
const refusal = route.indexOf("if (locked && moves.includes(");
const movesList = route.match(/const moves = \[([^\]]*)\]/)?.[1] ?? "";
t("every action that moves a home is in the refused list", () =>
  ["plan", "place", "unplace", "row", "move"].every((a) => movesList.includes(`"${a}"`)));
t("the refusal comes before any action that writes", () => {
  const first = ["\"row\"", "\"move\"", "\"place\"", "\"unplace\"", "\"plan\""]
    .map((a) => route.indexOf(`body.action === ${a}`)).filter((i) => i >= 0);
  return refusal > 0 && first.length === 5 && first.every((i) => refusal < i);
});
t("the lock is read from the database, not from the request", () =>
  /const locked = was\?\.locked === true/.test(route)
  && /from\("properties"\)\s*\.select\("plan"\)\.eq\("id", id\)/.test(route));
t("unlocking writes the flag and not a plan the screen sent", () => {
  const block = route.slice(route.indexOf("body.action === \"lock\""), refusal);
  return /want && given/.test(block);
});

// --- the screen ---
const remember = screen.slice(screen.indexOf("const remember = useCallback"));
const guard = remember.indexOf("if (planNow.current.locked) return;");
t("a locked layout is not changed on screen or saved", () =>
  guard > 0 && guard < remember.indexOf("setPlan(next)")
  && guard < remember.indexOf("writePlan(next)"));
t("a browser's old drags are not drawn over a locked layout", () =>
  /const mine = plan\.locked \? \{\} : moved;/.test(screen)
  && /\?\? mine\[h\.id\]/.test(screen) && !/\?\? moved\[h\.id\]/.test(screen));
t("old drags are not pushed at a locked park", () => {
  const sync = screen.slice(screen.indexOf("syncing.current || !real"));
  return sync.indexOf("planNow.current.locked") >= 0
    && sync.indexOf("planNow.current.locked") < sync.indexOf("fetch(");
});
t("locking saves the layout as it is on screen", () =>
  /action: "lock", locked: true, plan: asOnScreen\(\)/.test(screen));
t("the moving tools are put away while locked", () => {
  const acts = screen.slice(screen.indexOf("className=\"parkacts\""));
  const open = acts.indexOf("{!isLocked && (<>");
  return open > 0 && open < acts.indexOf("Move homes")
    && open < acts.indexOf("Add a home") && open < acts.indexOf("Place rows");
});

console.log(results.join("\n"));
const bad = results.filter((r) => r.startsWith("FAIL")).length;
console.log(bad ? `\n${bad} failed` : "\nlock holds");
process.exit(bad ? 1 : 0);
