/** Owner distributions.  Run: node lib/__fixtures__/distribute.test.mjs
 *
 *  Weighted towards the ways a distribution is wrong quietly: a day over the
 *  Wells Fargo limit, an owner paid a cent more or less than the statement
 *  says, a payment chopped in two when it would have fitted whole, a bank
 *  holiday counted as a day the money moves, and a pasted total read as a
 *  line (which would pay the owner twice).
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(readFileSync(join(here, "..", "distribute.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const D = await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};
const sum = (a) => a.reduce((s, x) => s + x, 0);
const byDay = (plan) => plan.reduce((m, p) => ({ ...m, [p.sendOn]: (m[p.sendOn] ?? 0) + p.cents }), {});
const forOwner = (plan, id) => plan.filter((p) => p.id === id);
const CAP = 2_500_000;

/* bank days */
t("a Sunday start moves to Monday", () => D.bankDayFrom("2026-11-15") === "2026-11-16");
t("Thanksgiving is not a bank day", () => !D.isBankDay("2026-11-26"));
t("the day after the 25th is the 27th, over Thanksgiving", () => D.addBankDays("2026-11-25", 1) === "2026-11-27");
t("Christmas 2027 falls on Saturday and is not moved", () => D.isBankDay("2027-12-24"));
t("New Year 2023 on a Sunday is observed Monday the 2nd", () => !D.isBankDay("2023-01-02"));
t("two bank days from a Friday is Tuesday", () => D.addBankDays("2026-11-20", 2) === "2026-11-24");

/* the plan */
const owed = [
  { id: "shb", name: "SHB", cents: 1_800_000, settleDays: 1 },
  { id: "hab", name: "Habberstad", cents: 1_200_000, settleDays: 1 },
  { id: "big", name: "Big", cents: 6_000_000, settleDays: 1 },
  { id: "slow", name: "Slow bank", cents: 300_000, settleDays: 3 },
  { id: "none", name: "Nothing", cents: 0, settleDays: 1 },
];
const plan = D.planPayments(owed, CAP, "2026-11-16");

t("no day goes over $25,000", () => Object.values(byDay(plan)).every((c) => c <= CAP));
t("every owner is paid exactly what is owed", () =>
  owed.every((o) => sum(forOwner(plan, o.id).map((p) => p.cents)) === o.cents));
t("an owner owed nothing gets no payment", () => forOwner(plan, "none").length === 0);
t("an amount under the limit is kept whole", () =>
  forOwner(plan, "shb").length === 1 && forOwner(plan, "hab").length === 1 && forOwner(plan, "slow").length === 1);
t("$60,000 too big for a day goes as three payments on consecutive bank days", () => {
  const b = forOwner(plan, "big");
  // The slow bank's $3,000 went first on day one, so $22,000 of it fits there.
  return b.length === 3 && b.map((p) => p.cents).join() === "2200000,2500000,1300000"
    && b[1].sendOn === D.addBankDays(b[0].sendOn, 1) && b[2].sendOn === D.addBankDays(b[1].sendOn, 1);
});
t("the slowest bank is sent first", () => forOwner(plan, "slow")[0].sendOn === "2026-11-16");
t("arrival counts the owner's bank days", () =>
  forOwner(plan, "slow")[0].arrivesOn === "2026-11-19");
t("nothing is sent on a weekend or holiday", () => plan.every((p) => D.isBankDay(p.sendOn)));

// What is already paid on a day uses up that day.
const resumed = D.planPayments([{ id: "x", name: "X", cents: 1_000_000, settleDays: 1 }], CAP, "2026-11-16",
  { "2026-11-16": 2_000_000 });
t("a day already part-paid is not overfilled", () => resumed.length === 1 && resumed[0].sendOn === "2026-11-17");

// Whole-if-it-fits vs fill-every-day: 18k then 12k. Filling greedily would
// send 7k of the 12k on day one; keeping whole sends it the next day.
const two = D.planPayments([
  { id: "a", name: "A", cents: 1_800_000, settleDays: 1 },
  { id: "b", name: "B", cents: 1_200_000, settleDays: 1 },
], CAP, "2026-11-16");
t("a payment that would fit tomorrow is not split today", () =>
  two.length === 2 && two.find((p) => p.id === "b").sendOn === "2026-11-17");
// ...but a smaller one that fits today's leftover room goes today.
const three = D.planPayments([
  { id: "a", name: "A", cents: 1_800_000, settleDays: 1 },
  { id: "b", name: "B", cents: 1_200_000, settleDays: 1 },
  { id: "c", name: "C", cents: 500_000, settleDays: 1 },
], CAP, "2026-11-16");
t("a small payment fills the room left on the first day", () =>
  three.find((p) => p.id === "c").sendOn === "2026-11-16");

/* money */
t("parses Excel money", () =>
  D.parseMoney("$4,125.00") === 412500 && D.parseMoney("(375.00)") === -37500
  && D.parseMoney("-45") === -4500 && D.parseMoney("45.5") === 4550 && D.parseMoney("Lot rent") === null);

/* the paste */
const owners = [
  { id: "shb", name: "SHB INVESTMENTS" },
  { id: "art", name: "Artun Investments LLC" },
  { id: "con", name: "Conor Dolan" },
];
const block = [
  "SHB Investments",
  "Rent collected\t$9,900.00",
  "Lot rent\t(4,125.00)",
  "Management fee\t-495.00",
  "Net owed\t$5,280.00",
  "",
  "Artun Investments\tRent collected\t7,200.00",
  "Artun Investments\tLot rent\t(3,000.00)",
  "Somebody Else",
  "Rent collected 1,000.00",
].join("\n");
const p = D.readPaste(block, owners);
t("lines under an owner's name go to that owner", () =>
  p.byOwner.shb.lines.length === 3 && D.netCents(p.byOwner.shb.lines) === 528000);
t("a Net row is kept as the stated figure, not added as a line", () =>
  p.byOwner.shb.statedNetCents === 528000 && !p.byOwner.shb.lines.some((l) => /net/i.test(l.label)));
t("owner-label-amount rows are read", () =>
  p.byOwner.art.lines.map((l) => `${l.label}=${l.cents}`).join() === "Rent collected=720000,Lot rent=-300000");
t("an unknown name is reported, not guessed", () => p.unmatched.includes("Somebody Else"));
t("lines under an unknown name do not land on the previous owner", () =>
  D.netCents(p.byOwner.art.lines) === 420000);

/* the statement */
const html = D.statementHtml({ month: "2026-11-01", payee: "A <b>& Co", lines: p.byOwner.shb.lines,
  payments: [{ sendOn: "2026-11-16", cents: 528000, arrivesOn: "2026-11-17" }] });
t("the statement shows the net", () => html.includes("$5,280.00"));
t("deductions show with a minus", () => html.includes("-$4,125.00"));
t("an owner's name cannot inject markup", () => !html.includes("<b>&") && html.includes("A &lt;b&gt;&amp; Co"));
t("the subject names the month", () => D.subjectFor("2026-11-01") === "November 2026 Owner Distribution");

/* the sheet's arithmetic -- Jack Curran, November 2026, as the sheet has it */
const jack = [
  ...[42539, 42539, 42539, 47449, 47449].map((c, i) => ({ label: `Mortgage - Lot ${[14, 15, 16, 17, 19][i]}`, cents: -c })),
  ...[14, 15, 16, 17, 19].map((n) => ({ label: `Consultant Fee - Lot ${n}`, cents: -5000 })),
  ...[14, 15, 16, 17, 19].map((n) => ({ label: `Lots rent - Jack Curran - Lot ${n}`, cents: -50000 })),
  ...[155000, 155000, 155000, 158000, 156500].map((c, i) => ({ label: `Monthly Rent - Lot ${[14, 15, 16, 17, 19][i]}`, cents: c })),
];
const jackCarry = { previousOwedCents: 281985, priorPaidCents: 242871, statedNetCents: 281985, statedOwedCents: 321099 };
t("net is revenue less expenses", () => D.netCents(jack) === 281985);
// With last month fully paid, owed and net are the same number and a rule
// that ignored the carry would pass. Jack was short-paid $391.14.
t("owed carries what last month was short", () => D.owedCents(jack, jackCarry) === 321099);
t("a sheet that adds up raises nothing but the carry", () => {
  const c = D.checks("Jack Curran Lot - 1140 Northside Rd, Lots #14, #15, #16, #17, #19", jack, jackCarry);
  return c.length === 1 && /carries into this month/.test(c[0]);
});
t("a stated Owed that disagrees is said", () =>
  D.checks(null, jack, { ...jackCarry, statedOwedCents: 281985 }).some((x) => /Owed line says \$2,819\.85/.test(x)));
t("a stated net that disagrees is said", () =>
  D.checks(null, jack, { statedNetCents: 280000 }).some((x) => /Monthly Net Cashflow says/.test(x)));
// PerryRd: title says Lots #32, #33; the costs are for 34 and 35.
const perry = [
  { label: "Mortgage - Lot 34", cents: -47449 }, { label: "Mortgage - Lot 35", cents: -47449 },
  { label: "Monthly Rent - Lot 32", cents: 155000 }, { label: "Monthly Rent - Lot 33", cents: 155000 },
];
t("lots the title does not list are said", () =>
  D.checks("PerryRd Distro - 1140 Northside Rd, Lots #32, #33", perry).some((x) => /lots 34, 35, which the title/.test(x)));
t("a month that comes out negative says nothing is paid", () =>
  D.checks(null, [{ label: "Supplies - Lot 10", cents: -417660 }]).some((x) => /Nothing to pay/.test(x)));
const jackHtml = D.statementHtml({ month: "2026-11-01", payee: "Jack Curran", lines: jack, ...jackCarry, priorPaidOn: "10/14/2026" });
t("the statement shows the carried balance and the owed total", () =>
  jackHtml.includes("$391.14") && jackHtml.includes("$3,210.99"));

/* against last month's */
t("an ordinary month is quiet", () => {
  const v = D.versusLast(221844, { sentCents: 229844 }, []);
  return !v.loud && v.diffCents === -8000 && v.says.length === 0;
});
// SHB: $2,709.45 sent in October, -$2,059.65 this month.
t("a big drop is loud and says by how much", () => {
  const v = D.versusLast(-205965, { sentCents: 270945 }, []);
  return v.loud && /Down \$4,769\.10/.test(v.says[0]);
});
// $300 on $10,000 is 3%: over $250, under 20%. Either rule alone would fire.
t("$300 on a $10,000 owner is not loud", () => !D.versusLast(1030000, { sentCents: 1000000 }, []).loud);
// $200 on $400 is 50%: over 20%, under $250.
t("$200 on a $400 owner is not loud", () => !D.versusLast(20000, { sentCents: 40000 }, []).loud);
const octLines = [
  { label: "Monthly Rent - Lot 13", cents: 155000 }, { label: "Monthly Rent - Lot 32", cents: 155000 },
  { label: "Mortgage - Lot 13", cents: -42539 }, { label: "Mortgage - Lot 32", cents: -42539 },
];
const novLines = [
  { label: "Monthly Rent - Lot 13", cents: 155000 }, { label: "Monthly Rent - Lot 33", cents: 158000 },
  { label: "Mortgage - Lot 13", cents: -42539 }, { label: "Mortgage - Lot 13", cents: -42539 },
];
const v = D.versusLast(200000, { sentCents: 220000, lines: octLines }, novLines);
t("a lot that stopped paying rent is said", () => v.says.some((x) => /No rent line this month for lot 32/.test(x)));
t("a lot that started paying rent is said", () => v.says.some((x) => /A rent line for lot 33/.test(x)));
t("a lot that lost its loan line is said", () => v.says.some((x) => /No loan line this month for lot 32/.test(x)));
t("the same line twice is said", () => v.says.some((x) => /appears 2 times/.test(x)));
t("anything said makes it loud even when the total barely moved", () => v.loud);
t("a changed rent is said", () =>
  D.versusLast(0, { sentCents: 0, lines: [{ label: "Monthly Rent - Lot 17", cents: 155000 }] },
    [{ label: "Monthly Rent - Lot 17", cents: 158000 }]).says.some((x) => /Lot 17 rent is \$1,580\.00; it was \$1,550\.00/.test(x)));

/* one email per entity */
const shb1148 = { month: "2026-11-01", payee: "SHB Investments", title: "SHB Investments - 1148 Northside Rd, Lots #10, #14",
  lines: [{ label: "Monthly Rent - Lot 10", cents: 155000 }, { label: "Supplies - Lot 10", cents: -417660 }] };
const shbCC = { month: "2026-11-01", payee: "SHB Investments LLC — Cross Creek", title: "SHB Investments LLC - The Retreat at Cross Creek, Lots #3102",
  lines: [{ label: "Rent - Lot 3102", cents: 125000 }, { label: "Mortgage - Lot 3102", cents: -34122 }] };
const both = D.ownerEmailHtml("2026-11-01", "SHB Investments LLC", [shb1148, shbCC]);
t("a combined email heads each block with its property", () =>
  both.includes("1148 Northside Rd, Lots #10, #14") && both.includes("The Retreat at Cross Creek, Lots #3102"));
// The total is what is PAID: a property that came out negative pays nothing
// and must not be netted against the other. -2,621.60 + 908.78 would be
// negative; the right total is 908.78.
// Read the figure ON the total line: $908.78 is also Cross Creek's own row,
// so a check that only asks whether it appears passes on the fault.
const totalLine = (h) => (h.split("Total distribution")[1] ?? "").replace(/<[^>]+>/g, " ").match(/-?\$[\d,]+\.\d\d/)?.[0];
t("the total counts only what is paid, not a negative property against a positive one", () => totalLine(both) === "$908.78");
t("a negative property says nothing is paid on it", () => /nothing paid/.test(both));
t("one statement alone has no summary", () => !/Total distribution/.test(D.statementHtml(shbCC)));
const txt = D.ownerEmailText("2026-11-01", "SHB Investments LLC", [shb1148, shbCC]);
t("the plain-text version has both blocks", () => txt.includes("1148 Northside") && txt.includes("Cross Creek") && txt.includes("$908.78"));
t("an entity set groups; an empty one is the payee alone", () =>
  D.entityOf({ entity: "Beaga LLC", payee: "Beaga LLC — 412 Bank" }) === "Beaga LLC"
  && D.entityOf({ entity: "  ", payee: "Rentham LLC — 800 cale" }) === "Rentham LLC — 800 cale");

t("dates in the sheet's several spellings are read", () =>
  ["2026-11-14", "11/1/2026", "09-11-2026", "September 28, 2026"].every((d) => D.readDate(d) !== null)
  && D.readDate("September 28, 2026").getUTCDate() === 28 && D.readDate("09-11-2026").getUTCMonth() === 8);
t("a spreadsheet serial is not read as a date, and is said", () =>
  D.readDate("46033") === null && D.checks(null, [{ label: "Rent", cents: 154000, date: "46033" }]).some((x) => /"46033" on Rent/.test(x)));

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` -- ${why}` : ""}`);
console.log(`\n${checks.length - failed.length}/${checks.length} distribution checks pass`);
process.exit(failed.length ? 1 : 0);
