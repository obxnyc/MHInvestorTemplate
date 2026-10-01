/** Reading an amount, and finding the invoice that counts.
 *  Run: node lib/__fixtures__/invoices.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(readFileSync(join(here, "..", "invoices.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { parseMoney, money, currentOf, chronological, whatChanged, recipients } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (n, ok) => checks.push([n, ok]);

// --- money as somebody types it ---
t("plain dollars", parseMoney("380") === 38000);
t("with cents", parseMoney("380.50") === 38050);
t("one decimal place is two", parseMoney("380.5") === 38050);
t("a trailing point is not an error", parseMoney("380.") === 38000);
t("a dollar sign and a comma are not an error", parseMoney("$1,250.00") === 125000);
t("spaces are not an error", parseMoney("  380 ") === 38000);
t("zero is a real amount", parseMoney("0") === 0);

// Refused rather than guessed. An amount that silently becomes 0 is worse
// than a form that says it cannot read what you typed.
t("three decimal places is not an amount", parseMoney("380.555") === null);
t("words are not an amount", parseMoney("three eighty") === null);
t("a negative is not an amount here -- a credit is its own thing",
  parseMoney("-380") === null);
t("empty is not zero", parseMoney("") === null && parseMoney("   ") === null);

// The one that would quietly round money away.
t("cents survive the trip", parseMoney("0.07") === 7 && money(7) === "$0.07");
t("and so do thousands", money(125000) === "$1,250.00");

// --- which invoice counts ---
const inv = (id, o = {}) => ({
  id, amountCents: o.amount ?? 38000, invoiceNo: o.no ?? null,
  description: o.desc ?? null, filePath: o.file ?? null,
  replaces: o.replaces ?? null, reason: o.reason ?? null,
  createdAt: o.at ?? "2026-10-01T10:00:00Z", emailedAt: null, rmPushedAt: null,
});

{
  const only = [inv("a")];
  t("one invoice is the one that counts", currentOf(only)?.id === "a");
}
{
  // a was replaced by b, b by c. c counts.
  const chain = [
    inv("a", { amount: 38000, at: "2026-10-01T10:00:00Z" }),
    inv("b", { amount: 83000, replaces: "a", at: "2026-10-02T10:00:00Z" }),
    inv("c", { amount: 79000, replaces: "b", at: "2026-10-03T10:00:00Z" }),
  ];
  t("the end of the chain counts", currentOf(chain)?.id === "c");
  t("and the original is still there to read",
    chronological(chain)[0].amountCents === 38000);
  // Order of the rows coming back from the database must not matter.
  t("shuffled rows give the same answer",
    currentOf([chain[2], chain[0], chain[1]])?.id === "c");
}
{
  // Two unrelated invoices on one job -- a plumber's and an electrician's.
  // Neither replaces the other, and the newest is the one being asked about.
  const two = [
    inv("plumber", { at: "2026-10-01T10:00:00Z" }),
    inv("sparks", { at: "2026-10-04T10:00:00Z" }),
  ];
  t("two separate invoices do not confuse each other",
    currentOf(two)?.id === "sparks");
}
t("nothing in, nothing out", currentOf([]) === null);

// --- saying what changed ---
{
  const from = inv("a", { amount: 38000, no: "A-1" });
  const to = inv("b", { amount: 83000, no: "A-1", replaces: "a" });
  const said = whatChanged(from, to);
  t("a price change is said in both directions",
    said.some((s) => s.includes("$380.00") && s.includes("$830.00")));
  t("and nothing else is invented", said.length === 1);
}
{
  const from = inv("a", { amount: 38000, file: null });
  const to = inv("b", { amount: 38000, file: "invoices/x/1.pdf", replaces: "a" });
  t("a newly attached file is noticed",
    whatChanged(from, to).some((s) => s.includes("new file")));
}

// --- who gets told ---
t("one address is one address", recipients("books@x.com").join() === "books@x.com");
// Commas, semicolons or a pasted newline are the same intention, and none of
// them should be why a bookkeeper stops hearing about invoices.
t("commas", recipients("a@x.com, b@x.com").length === 2);
t("semicolons", recipients("a@x.com; b@x.com").length === 2);
t("a pasted newline", recipients("a@x.com\nb@x.com").length === 2);
t("stray spaces are trimmed", recipients("  a@x.com ,  b@x.com  ").join() === "a@x.com,b@x.com");
t("the same person twice is one email", recipients("a@x.com, a@x.com").length === 1);
// A typo that silently becomes a recipient is how a bounce queue starts.
t("something with no @ is not an address", recipients("a@x.com, books").length === 1);
t("and nor is something with a space in it", recipients("a@x.com, b c@x.com").length === 1);
t("unset means nobody, not an empty string",
  recipients(undefined).length === 0 && recipients("").length === 0);

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
