/** What work has cost before. Run: node lib/__fixtures__/prices.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(readFileSync(join(here, "..", "prices.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { benchmark, money, parseMoney } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (n, ok) => checks.push([n, ok]);
const NOW = new Date("2026-09-25T00:00:00Z").getTime();
const p = (cents, on, what = "job", who = "A Plumber") => ({ cents, on, what, who });

t("no history is null, not a zero", benchmark([], NOW) === null);
t("prices that are not prices are ignored",
  benchmark([p(0, "2026-01-01"), p(-5, "2026-01-01")], NOW) === null);

// The median, not the mean. One emergency call-out at triple rate drags an
// average to a number nobody has ever actually been charged, and the office
// person holding the invoice would then be told that number is normal.
{
  const b = benchmark([
    p(42000, "2026-01-10"), p(45500, "2026-02-10"), p(48000, "2026-03-10"),
    p(51000, "2026-04-10"), p(180000, "2026-05-10"),
  ], NOW);
  t("the middle of what was paid, not the average", b.median === 48000);
  t("the range is the real range", b.low === 42000 && b.high === 180000);
  t("every price counts toward the total", b.count === 5);
}

t("an even count takes the midpoint of the middle two",
  benchmark([p(40000, "2026-01-01"), p(50000, "2026-02-01")], NOW).median === 45000);

// Recency, because a four-year-old price quoted as current is worse than none.
{
  const b = benchmark([
    p(40000, "2019-01-01"), p(41000, "2019-02-01"),
  ], NOW);
  t("old prices are flagged stale", b.stale === true);

  const fresh = benchmark([p(40000, "2026-06-01")], NOW);
  t("a recent price is not", fresh.stale === false);

  // Two years rather than one: these parts get replaced rarely enough that a
  // twelve-month window would mark almost everything stale and train people to
  // ignore the warning.
  const eighteen = benchmark([p(40000, "2025-04-01")], NOW);
  t("eighteen months still counts as current", eighteen.stale === false);

  t("a price with no date cannot vouch for itself",
    benchmark([p(40000, null)], NOW).stale === true);
}

t("the most recent five are shown, newest first", (() => {
  const b = benchmark([
    p(1, "2020-01-01"), p(2, "2021-01-01"), p(3, "2022-01-01"),
    p(4, "2023-01-01"), p(5, "2024-01-01"), p(6, "2025-01-01"),
  ], NOW);
  return b.recent.length === 5 && b.recent[0].cents === 6 && b.recent[4].cents === 2;
})());

// What a person types into a box with a dollar sign on it.
t("a bare number is dollars", parseMoney("450") === 45000);
t("a dollar sign is fine", parseMoney("$450") === 45000);
t("so are commas and cents", parseMoney("$1,250.00") === 125000);
t("cents are kept", parseMoney("12.34") === 1234);
t("nothing typed is nothing", parseMoney("") === null && parseMoney("$") === null);
// A minus sign is dropped rather than honoured. There is no such thing as a
// negative price here, and reading "-50" as fifty dollars is closer to what
// the person meant than refusing the whole entry.
t("a stray minus sign is ignored", parseMoney("-50") === 5000);

t("money reads as money", money(45000) === "$450");
t("no price shows as a dash, not $0", money(null) === "—" && money(undefined) === "—");

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
