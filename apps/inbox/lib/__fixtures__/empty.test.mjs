/** How long a lot has been empty.  Run:  node lib/__fixtures__/empty.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "empty.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { spell, howLong, worrying, longestFirst, STALE } =
  await import("data:text/javascript," + encodeURIComponent(js));

const TODAY = new Date(Date.UTC(2026, 9, 21));          // 21 October 2026
const s = (since, o = {}) => spell(since, { today: TODAY, ...o });

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

t("a day is a day", s("2026-10-20").days === 1);
t("ninety-four days", s("2026-07-19").days === 94);
t("today is zero", s("2026-10-21").days === 0);

// No clock is not a clock at zero. This is the distinction the whole file is
// for: a lot nobody has measured must not be drawn as empty since this
// morning, which is the state every lot would be in the day 037 is run.
t("no start date is no answer, not zero", s(null) === null);
t("an empty string is no answer", s("") === null);
t("rubbish is no answer", s("whenever") === null);
t("and no answer has no words", howLong(null) === null);

t("a date in the future is not a negative spell", s("2026-12-01").days === 0);

// The estimate has to read as one. Ninety-four days that is a guess gets
// planned around exactly like a measured one unless the screen says.
t("a measured spell says the number plainly",
  howLong(s("2026-07-19")) === "Empty 3 months");
t("and does not say about",
  !howLong(s("2026-07-19")).includes("about"));
t("an estimated spell says about",
  howLong(s("2026-07-19", { estimated: true })) === "Empty about 3 months");
t("an estimated spell of no length says the start date is unsure",
  howLong(s("2026-10-21", { estimated: true })) === "Empty, start date unsure");
t("a measured spell of no length says today",
  howLong(s("2026-10-21")) === "Empty since today");

t("one day reads as a day", howLong(s("2026-10-20")) === "Empty 1 day");
t("under two months counts days", howLong(s("2026-09-10")) === "Empty 41 days");
t("over two months counts months", howLong(s("2026-06-01")) === "Empty 5 months");
t("over eighteen months counts years",
  howLong(s("2024-06-01")) === "Empty 2 years 5 months");
t("a round year says no months", howLong(s("2024-10-21")) === "Empty 2 years");

t("forty-five days is worrying", worrying(s("2026-09-06")) === true);
t("a fortnight is not", worrying(s("2026-10-07")) === false);
t("no clock is not worrying either", worrying(null) === false);
t("the threshold is the one the screen uses", STALE === 45);

// Sorting is where a null quietly becomes a zero and ruins the list.
const lots = [
  { id: "a", since: "2026-10-20" },
  { id: "b", since: null },
  { id: "c", since: "2026-01-04" },
  { id: "d", since: "2026-09-01" },
];
const order = longestFirst(lots, (l) => s(l.since)).map((l) => l.id);
t("longest empty first", order.slice(0, 3).join("") === "cda");
t("a lot with no clock sorts last, not first", order[3] === "b");
t("sorting does not mutate the list", lots[0].id === "a");
t("all-null sorts without throwing",
  longestFirst([{ since: null }, { since: null }], (l) => s(l.since)).length === 2);

let failed = 0;
for (const [n, ok, note] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${n}${note ? ` (${note})` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
