/** What to pay.  Run: node lib/__fixtures__/pay.test.mjs
 *
 *  Weighted, like shift.test, towards the ways a wage is wrong quietly: an
 *  open shift paid at a guess, overtime missed, a man with no rate shown as
 *  owed nothing.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const tr = (f) => ts.transpileModule(readFileSync(join(here, "..", f), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const shiftUrl = "data:text/javascript," + encodeURIComponent(tr("shift.ts"));
const js = tr("pay.ts").replace(/from\s+["']\.\/shift["']/, `from "${shiftUrl}"`);
const { payWeek, payLink } = await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

const day = (d, h0, h1, staffId, extra = {}) => ({
  id: `${staffId}${d}${h0}`, staffId, propertyId: "p",
  startedAt: new Date(Date.UTC(2026, 10, d, h0)).toISOString(),
  endedAt: h1 === null ? null : new Date(Date.UTC(2026, 10, d, h1)).toISOString(),
  breaks: [], signedOffAt: "x", ...extra,
});

// Juan: five 9-hour days = 45 hours, 5 of them overtime.
// Luis: 3 x 8 = 24, plus one shift nobody closed.
// Ana: 10 hours, no rate set.
// Ray: no crew, 8 hours, one unsigned.
const shifts = [
  ...[2, 3, 4, 5, 6].map((d) => day(d, 12, 21, "juan")),
  ...[2, 3, 4].map((d) => day(d, 12, 20, "luis")),
  day(5, 12, null, "luis"),
  day(2, 12, 22, "ana"),
  day(3, 12, 20, "ray", { signedOffAt: null }),
];
const payees = [
  { id: "juan", name: "Juan", leadId: "jose", rateCents: 2000, method: "cashapp", handle: "$JuanR" },
  { id: "luis", name: "Luis", leadId: "jose", rateCents: 1800, method: "zelle", handle: "9105550103" },
  { id: "ana", name: "Ana", leadId: "jose", rateCents: null, method: "cash", handle: null },
  { id: "ray", name: "Ray", leadId: null, rateCents: 2500, method: "venmo", handle: "@ray-d" },
];
const out = payWeek(payees, shifts, { jose: "Jose Beltran" });
const L = (id) => out.lines.find((l) => l.staffId === id);

t("hours add up", () => L("juan").hours === 45);
t("overtime past 40", () => L("juan").regular === 40 && L("juan").overtime === 5);
t("overtime paid at time and a half: 40x20 + 5x30 = 950", () => L("juan").amountCents === 95000);
t("no overtime when switched off", () =>
  payWeek(payees, shifts, {}, { overtime: false }).lines.find((l) => l.staffId === "juan").amountCents === 90000);
t("an open shift is not paid", () => L("luis").hours === 24 && L("luis").amountCents === 43200);
t("and is counted", () => L("luis").openShifts === 1);
t("no rate is no amount, not zero", () => L("ana").amountCents === null);
t("and is counted as a question", () => out.missingRates === 1);
t("unsigned shifts counted", () => L("ray").unsigned === 1);
t("crew named for its lead", () => L("juan").crew === "Jose Beltran's crew");
t("crew totals", () => {
  const j = out.crews.find((c) => c.id === "jose");
  return j.amountCents === 95000 + 43200 && j.hours === 79 && j.people === 3;
});
t("no crew is last", () => out.crews.at(-1).id === null && out.crews.at(-1).amountCents === 20000);
t("grand total", () => out.totalCents === 95000 + 43200 + 20000);

t("Cash App link carries the amount", () => L("juan").payLink === "https://cash.app/$JuanR/950.00");
t("Venmo link carries the amount", () => L("ray").payLink.startsWith("https://venmo.com/ray-d?txn=pay&amount=200.00"));
t("Zelle has no link", () => L("luis").payLink === null);
t("no link for a junk cashtag", () => payLink("cashapp", "$juan r/../x", 100) === null);
t("no link for nothing owed", () => payLink("cashapp", "$a", 0) === null);

// A shift the clock closed is PAID (it is finished) and FLAGGED.
const withAuto = payWeek(payees, [...shifts, day(7, 12, 20, "ray", { autoOut: true })], {});
const ray = withAuto.lines.find((l) => l.staffId === "ray");
t("a shift the clock closed is paid", () => ray.hours === 16 && ray.amountCents === 40000);
t("and counted as closed by the clock", () => ray.autoClosed === 1 && L("ray").autoClosed === 0);

const bad = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
console.log(`\n${checks.length - bad.length}/${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
