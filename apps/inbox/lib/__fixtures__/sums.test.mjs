/** Arithmetic in the search bar.  Run: node lib/__fixtures__/sums.test.mjs
 *
 *  Two kinds of check, and the second kind is the important one.
 *
 *  The arithmetic has to be right. And the calculator must NOT ANSWER things
 *  that are not sums -- "3114" is a lot number and "cross creek" is a park,
 *  and a calculator that answers those has stolen the search bar from the
 *  search.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const path = join(here, "..", "sums.ts");
const src = readFileSync(path, "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { sum } = await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};
const v = (q) => sum(q)?.value;

// ---- the sums a property business actually does ----
t("a year of rent", () => v("775 * 12") === 9300);
t("eight homes at a price", () => v("8 * 24500") === 196000);
t("a difference", () => v("1200 - 775") === 425);
t("division", () => v("9300 / 12") === 775);
t("precedence, not left to right", () => v("2 + 3 * 4") === 14);
t("brackets override it", () => v("(2 + 3) * 4") === 20);
t("a negative", () => v("-5 + 12") === 7);
t("commas in a figure", () => v("1,200 * 2") === 2400);
t("a dollar sign", () => v("$775 * 12") === 9300);
t("k for thousands", () => v("24.5k * 8") === 196000);
t("decimals", () => v("775.50 * 2") === 1551);

// ---- per cent, the way a calculator means it ----
// "1200 - 15%" is fifteen per cent OF THE TWELVE HUNDRED. Every pocket
// calculator since the seventies works this way and so does every person who
// types it. Read as fifteen hundredths it would be 1199.85.
t("a discount off a figure", () => v("1200 - 15%") === 1020);
t("and not fifteen hundredths", () => v("1200 - 15%") !== 1199.85);
t("a markup", () => v("1000 + 8%") === 1080);
t("per cent of something, said that way", () => v("20% of 1200") === 240);
t("a bare per cent is a fraction", () => v("15%") === 0.15);
t("and it can be used as one", () => v("1200 * 15%") === 180);

// ---- what it must refuse ----
// Every one of these is something somebody types into a SEARCH bar.
t("a lot number is not a sum", () => sum("3114") === null);
t("a park name is not a sum", () => sum("cross creek") === null);
t("a page name is not a sum", () => sum("timesheets") === null);
t("a person is not a sum", () => sum("alex prieto") === null);
t("an empty box is not a sum", () => sum("") === null);
t("a lone number is not a sum", () => sum("12") === null);
// Two tokens, and it passes the has-an-operator test, so this is the case
// the token-count rule is actually for -- "12" never reaches it.
t("a lone negative number is not a sum either", () => sum("-5") === null);
t("but a bare per cent is, because it answers a real question",
  () => sum("15%").value === 0.15);
t("a phone number is not a sum", () => sum("910 555 0142") === null);
// This one has an operator in it and is still not a sum.
t("a hyphenated name is not a sum", () => sum("cross-creek") === null);
t("a date is not a sum", () => sum("10/21/2026") === null);

// ---- half-typed, which is every keystroke ----
// Somebody typing "775 * 12" passes through "775 *" on the way. An answer
// that flickers to Infinity or NaN underneath the box is worse than none.
t("a trailing operator is not an answer", () => sum("775 *") === null);
t("a leading operator is not an answer", () => sum("* 12") === null);
t("an unclosed bracket is not an answer", () => sum("(2 + 3") === null);
t("a stray bracket is not an answer", () => sum("2 + 3)") === null);
t("divide by zero is not an answer", () => sum("12 / 0") === null);
t("and nor is anything built on it", () => sum("1 + 12 / 0") === null);
t("trailing rubbish is not an answer", () => sum("2 + 2 fish") === null);

// ---- how it reads back ----
t("money in, money out", () => sum("$775 * 12").pretty === "$9,300.00");
t("and it says it was money", () => sum("$775 * 12").money === true);
t("no dollar sign, no dollar sign", () => sum("775 * 12").pretty === "9,300");
t("a long number gets its thousands", () => sum("8 * 24500").pretty === "196,000");
t("a repeating fraction does not run off the end",
  () => sum("10 / 3").pretty.length < 12);

// ---- the rule that is not arithmetic ----
// This runs on whatever anybody types, on every keystroke, in a page holding
// their session. There is no amount of cleaning that makes handing that to
// the JavaScript engine reasonable.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
t("it never reaches for eval", () => !/\beval\s*\(/.test(code));
t("nor for the Function constructor", () => !/\bnew\s+Function\b/.test(code));
t("nor for setTimeout with a string", () => !/setTimeout\s*\(\s*["'`]/.test(code));
t("nor for import()", () => !/\bimport\s*\(/.test(code));

t("a throwing check is named, not fatal", () => { throw new Error("on purpose"); });
if (checks.pop()[0] !== "a throwing check is named, not fatal") {
  console.log("FAIL  the harness does not catch a throwing check");
  process.exit(1);
}

let failed = 0;
for (const [n, ok, note] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${n}${note ? ` (${note})` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
