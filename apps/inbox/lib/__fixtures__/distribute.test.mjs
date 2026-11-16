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
const jackCarry = { previousOwedCents: 281985, priorPaidCents: 242871, statedNetCents: 281985, statedOwedCents: 321099, reserveHeldCents: 100000 };
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
t("a combined email heads each block with its place, not the sheet's long title", () =>
  both.includes("1148 Northside Rd · 2 homes") && both.includes("The Retreat at Cross Creek, Lot 3102")
  && !both.includes("Lots #10, #14"));
// The total is what is PAID: a property that came out negative pays nothing
// and must not be netted against the other. -2,626.60 + 908.78 would be
// negative; the right total is 908.78.
// Read the figure ON the total line: $908.78 is also Cross Creek's own row,
// so a check that only asks whether it appears passes on the fault.
const totalLine = (h) => (h.split("Total distribution")[1] ?? "").replace(/<[^>]+>/g, " ").match(/-?\$[\d,]+\.\d\d/)?.[0];
t("the total counts only what is paid, not a negative property against a positive one", () => totalLine(both) === "$908.78");
t("a negative property says there is no distribution for it, and by how much", () =>
  /No distribution/.test(both) && /\$2,626\.60 more than its income/.test(both));
t("the email carries the logo", () => both.includes(D.LOGO) && /<img/.test(both));
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

/* the short place name */
t("an owner's name and the lot list come off the heading", () =>
  D.placeOf("Conor Dolan - The Retreat at Cross Creek, Lady Cheryl Dr, Lots #3117, #3119, #3121, #3123", "x") === "The Retreat at Cross Creek · 4 homes");
t("a spreadsheet's name is never a property", () => D.placeOf("223 Cisco (Dutch doors)", "Conor Dolan — 223 Cisco") === "223 Cisco");
t("one lot says which", () => D.placeOf("Shannon Dist - 1142 Northside Rd, Lots #20", "x") === "1142 Northside Rd, Lot 20");

/* paying as if rented */
const vac = [
  { label: "Mortgage - Lot 3117", cents: -34122 }, { label: "Lot Rent - Lot 3117", cents: -37500 },
  { label: "Mortgage - Lot 3119", cents: -34122 }, { label: "Rent - Lot 3119", cents: 125000 },
];
t("a home with costs and no rent is vacant; one with rent is not", () => D.vacantLots(vac).join() === "3117");
const guaranteed = [...vac, { label: "Guaranteed rent - Lot 3117", cents: 125000, category: "Guaranteed rent" }];
t("guaranteed rent is not counted against the sheet's own figure", () =>
  !D.checks(null, guaranteed, { statedNetCents: D.netCents(vac) }).some((x) => /Monthly Net Cashflow says/.test(x)));
t("but it is said, with the amount", () =>
  D.checks(null, guaranteed, { statedNetCents: D.netCents(vac) }).some((x) => /\$1,250\.00 of adjustments made here/.test(x)));
t("and a vacant home that is paid for is no longer vacant", () => D.vacantLots(guaranteed).length === 0);

/* our own charges */
const lab = D.laborLine(1.5, 6500, "fixed leak", 13);
t("labor is hours times rate, charged as a cost", () => lab.cents === -9750 && /1\.5 hrs @ \$65\.00\/hr - fixed leak - Lot 13/.test(lab.label));
t("no hours or no rate is no line", () => D.laborLine(0, 6500, "x") === null && D.laborLine(2, 0, "x") === null);
const mk = D.markupLine({ label: "Supplies - Lot 10", cents: -417660 }, 15);
t("a markup is a percent of the cost, and names it", () => mk.cents === -62649 && /Markup 15% on Supplies - Lot 10/.test(mk.label));
t("rent cannot be marked up", () => D.markupLine({ label: "Rent", cents: 155000 }, 15) === null);
t("our charges are adjustments, so Alex's figures are still checked without them", () =>
  lab.category === "Adjustment" && mk.category === "Adjustment"
  && D.checks(null, [{ label: "Rent", cents: 155000 }, lab], { statedNetCents: 155000 }).some((x) => /-\$97\.50 of adjustments/.test(x)));

/* markups and changed amounts, on the line */
const marked = [
  { label: "Rent", cents: 154000 },
  { label: "Supplies - Lot 10", cents: -2917, markupPct: 15 },
  { label: "Mortgage - Lot 10", cents: -47449 },
  { label: "Cleaning - Lot 10", cents: -20000, sheetCents: -16500 },
];
t("a markup is on its line and counts in the total", () => D.markupCents(marked[1]) === -438 && D.netCents(marked) === 154000 - 2917 - 438 - 47449 - 20000);
t("a markup on rent is nothing", () => D.markupCents({ label: "Rent", cents: 154000, markupPct: 15 }) === 0);
// Alex's own figure is what is checked: his amounts, no markups. Without
// sheetCents the changed line would read as Alex's sheet being wrong.
t("Alex's figures are checked without our markup or our change to his amount", () =>
  D.sheetNetCents(marked) === 154000 - 2917 - 47449 - 16500
  && !D.checks(null, marked, { statedNetCents: 154000 - 2917 - 47449 - 16500 }).some((x) => /Monthly Net Cashflow says/.test(x)));
t("and the difference is said, to the cent", () =>
  D.checks(null, marked, { statedNetCents: D.sheetNetCents(marked) }).some((x) => /-\$39\.38 of adjustments/.test(x)));
t("a blanket markup takes repairs, not the loan, lot rent or fees", () =>
  D.markupable(marked[1]) && D.markupable(marked[3]) && !D.markupable(marked[2]) && !D.markupable(marked[0])
  && !D.markupable({ label: "Consultant Fee - Lot 10", cents: -5000 }) && !D.markupable({ label: "Property Management Fees MTD", cents: -15400, category: "Management" }));
t("the email shows the markup under its line", () => {
  const h = D.statementHtml({ month: "2026-11-01", payee: "X", lines: marked });
  return /Markup 15%/.test(h) && h.includes("-$4.38");
});

/* the rent agreement -- Ben Jackson, November, as Alex's sheet has it */
const ben = [
  { label: "Monthly Rent - Lot 3104", cents: 114800, category: "Rent" },
  { label: "Mortgage - Lot 3104 Lady Viola Dr", cents: -34122 },
  { label: "Consultant Fee - Lot 3104 Lady Viola Dr", cents: -4500 },
  { label: "Lot Rent - Benjamin Jackson - Lot 3104 Lady Viola Dr", cents: -37500 },
];
const benG = D.withGuarantee(ben, 125000);
// The case the first version missed: a home WITH a tenant paying under the
// agreement. Filling only empty homes added nothing here.
t("a tenant paying under the agreement is topped up to it", () =>
  benG.filter((l) => l.category === "Guaranteed rent").map((l) => l.cents).join() === "10200"
  && D.netCents(benG) === 38678 + 10200);
const twoEmpty = [{ label: "Mortgage - Lot 3117", cents: -34122 }, { label: "Mortgage - Lot 3119", cents: -34122 },
  { label: "Rent - Lot 3121", cents: 130000 }];
t("an empty home gets the whole agreed rent; one paying more gets nothing", () =>
  D.withGuarantee(twoEmpty, 125000).filter((l) => l.category === "Guaranteed rent").map((l) => `${l.label}=${l.cents}`).join()
  === "Guaranteed rent - Lot 3117 (vacant)=125000,Guaranteed rent - Lot 3119 (vacant)=125000");
t("applying it twice is the same as once", () => JSON.stringify(D.withGuarantee(benG, 125000)) === JSON.stringify(benG));
t("a changed rent changes the top-up, never leaving the old one", () =>
  D.withGuarantee([{ ...ben[0], cents: 120000 }, ...ben.slice(1), ...benG.slice(4)], 125000)
    .filter((l) => l.category === "Guaranteed rent").map((l) => l.cents).join() === "5000");
t("no agreement takes any top-up back off", () => D.withGuarantee(benG, null).length === ben.length);
t("a credit we added is not counted as rent", () =>
  D.withGuarantee([...ben, { label: "Credit - Lot 3104", cents: 20000, category: "Adjustment" }], 125000)
    .filter((l) => l.category === "Guaranteed rent").map((l) => l.cents).join() === "10200");

/* reserves */
t("no reserves held is not met, even with no requirement on file", () =>
  D.checks(null, ben, { reserveHeldCents: null }).some((x) => /Reserves not met: we hold no reserves/.test(x)));
t("short of the requirement is not met, and says by how much it is held", () =>
  D.checks(null, ben, { reserveHeldCents: 50000, reserveRequiredCents: 200000 }).some((x) => /hold \$500\.00 of the \$2,000\.00/.test(x)));
t("at or over the requirement is met", () =>
  !D.checks(null, ben, { reserveHeldCents: 200000, reserveRequiredCents: 200000 }).some((x) => /Reserves not met/.test(x)));
t("the email says what we hold, deposits and reserves, even when nothing", () => {
  const h = D.statementHtml({ month: "2026-11-01", payee: "Benjamin Jackson", lines: benG, depositsCents: 0, reserveHeldCents: 0, reserveRequiredCents: 200000 });
  return /Held for you/.test(h) && /Security deposits/.test(h) && /of \$2,000\.00 required/.test(h);
});

/* taking a line off */
const off = [{ label: "Rent - Lot 9", cents: 155000 }, { label: "Supplies - Lot 9", cents: -60547, removed: true, markupPct: 15 },
  { label: "Mortgage - Lot 9", cents: -47449 }];
t("a line taken off does not count, nor does its markup", () => D.netCents(off) === 155000 - 47449);
t("Alex's figure still includes it, and the difference is said", () =>
  D.sheetNetCents(off) === 155000 - 60547 - 47449
  && D.checks(null, off, { statedNetCents: 155000 - 60547 - 47449, reserveHeldCents: 1 }).some((x) => /\$605\.47 of adjustments/.test(x))
  && !D.checks(null, off, { statedNetCents: 155000 - 60547 - 47449, reserveHeldCents: 1 }).some((x) => /Monthly Net Cashflow says/.test(x)));
t("the owner's email never shows it", () => !D.statementHtml({ month: "2026-11-01", payee: "X", lines: off }).includes("Supplies - Lot 9"));
t("a home whose only rent line was taken off is topped up in full", () =>
  D.withGuarantee([{ label: "Rent - Lot 9", cents: 155000, removed: true }, { label: "Mortgage - Lot 9", cents: -47449 }], 125000)
    .filter((l) => l.category === "Guaranteed rent").map((l) => l.cents).join() === "125000");

/* Wells Fargo: $5,000 a payment, $25,000 a day */
const many = [
  { id: "rnmk", name: "RNMK Homes", cents: 1720408, settleDays: 2 },
  { id: "habb", name: "Habberstad Norse", cents: 488780, settleDays: 2 },
  { id: "meg", name: "Meg Larabee", cents: 483400, settleDays: 2 },
  { id: "jack", name: "Jack Curran", cents: 321099, settleDays: 2 },
  { id: "eli", name: "Eli Wacht", cents: 105102, settleDays: 2 },
];
const wf = D.planPayments(many, 2500000, "2026-11-16", {}, 500000);
t("no payment is over $5,000", () => wf.every((p) => p.cents <= 500000));
t("no day is over $25,000", () => Object.values(byDay(wf)).every((c) => c <= 2500000));
t("everybody is paid exactly what is owed", () => many.every((o) => sum(forOwner(wf, o.id).map((p) => p.cents)) === o.cents));
t("RNMK's $17,204.08 is three of $5,000 and $2,204.08", () =>
  forOwner(wf, "rnmk").map((p) => p.cents).sort((a, b) => b - a).join() === "500000,500000,500000,220408");
// An owner under the cap is still one payment: the cap must not chop it.
t("an owner under $5,000 is one payment", () => forOwner(wf, "habb").length === 1 && forOwner(wf, "eli").length === 1);
// Without the per-payment cap the same money is fewer, bigger payments --
// so the cap is what is doing the splitting, not the daily limit.
t("without the cap, RNMK is one payment", () => forOwner(D.planPayments(many, 2500000, "2026-11-16"), "rnmk").length === 1);

/* what Rent Manager does not know yet */
{
  const lines = [
    { label: "Monthly Rent - Lot 10", cents: 155000, date: "11/1/2026" },
    { label: "Supplies - Lot 10", cents: -4000, removed: true },                        // a cost deleted: owner +$40
    { label: "Plumbing - Lot 10", cents: -30000, sheetCents: -20000 },                 // raised from $200 to $300: owner -$100
    { label: "Water heater - Lot 16", cents: -50000, markupPct: 15 },                  // 15% markup: owner -$75
    { label: "Trip fee - Lot 16", cents: -2500, category: "Adjustment", markupPct: 10 }, // added with its own markup: -$27.50 in one
    { label: "Guaranteed rent - Lot 16", cents: 10200, category: "Guaranteed rent" },
    { label: "Mortgage - Lot 10", cents: -47449, sheetLabel: "Mortgage" },              // renamed only: moves no money
    { label: "Mistake", cents: -999, category: "Adjustment", removed: true },           // ours, taken off: never in RM
  ];
  const pays = [{ id: "p1", cents: 500000, paidAt: "2026-11-17", sendOn: "2026-11-17", confirmation: "WF1" },
                { id: "p2", cents: 220408, paidAt: null, sendOn: "2026-11-18" }];
  const ch = D.changesOf("st", lines, pays);
  const of = (k) => ch.filter((c) => c.kind === k);
  t("a deleted sheet line raises the payout by what Alex had", () => of("deleted").length === 1 && of("deleted")[0].cents === 4000);
  t("a changed amount is the difference, not the new amount", () => of("amount")[0].cents === -10000);
  t("a markup on a sheet line is its own change", () => of("markup").length === 1 && of("markup")[0].cents === -7500);
  t("a charge added here carries its markup inside it, not as a second change", () => of("added").length === 1 && of("added")[0].cents === -2750);
  t("a rent-agreement top-up is listed", () => of("topup")[0].cents === 10200);
  t("a rename alone is not something to record", () => !ch.some((c) => c.label.startsWith("Mortgage")));
  t("a line we added and took off again is not listed", () => !ch.some((c) => c.label === "Mistake"));
  t("only a payment marked paid is listed", () => of("paid").length === 1 && of("paid")[0].cents === 500000);
  t("every change has its own key", () => new Set(ch.map((c) => c.key)).size === ch.length);
  // Changing a change after it was ticked is a new thing to enter.
  const again = D.changesOf("st", lines.map((l) => (l.label === "Plumbing - Lot 10" ? { ...l, cents: -35000 } : l)), pays);
  t("changing an amount again gives it a new key", () =>
    !again.some((c) => c.key === of("amount")[0].key) && again.filter((c) => c.kind !== "amount").every((c) => ch.some((x) => x.key === c.key)));
  // The key must follow the change, not where the line sits on the list.
  t("reordering lines keeps every key", () => {
    const k2 = new Set(D.changesOf("st", [...lines].reverse(), pays).map((c) => c.key));
    return ch.every((c) => k2.has(c.key));
  });
}

/* next month's sheet against this month as it was left here */
{
  const R = (last, now) => D.reconcile({ month: "2026-11-01", unrecorded: 0, ...last }, now);
  t("matching carry and payment says nothing", () => R({ owedCents: 220408, paidCents: 220408 }, { previousOwedCents: 220408, priorPaidCents: 220408 }).length === 0);
  t("a $180 charge Rent Manager never got is found", () => {
    const said = R({ owedCents: 220408 - 18000, paidCents: 202408 }, { previousOwedCents: 220408, priorPaidCents: 202408 });
    return said.length === 1 && /\$180\.00 more/.test(said[0]);
  });
  t("a payment that differs from the sheet is found", () => R({ owedCents: 100, paidCents: 720408 }, { previousOwedCents: 100, priorPaidCents: 600000 }).some((x) => /\$7,204\.08 was paid here/.test(x)));
  t("an unknown is not a mismatch", () => R({ owedCents: null, paidCents: null }, { previousOwedCents: 5, priorPaidCents: 5 }).length === 0
    && R({ owedCents: 5, paidCents: 5 }, {}).length === 0);
  t("unticked changes from last month are said", () => /2 changes from November 2026/.test(D.reconcile({ month: "2026-11-01", owedCents: null, paidCents: null, unrecorded: 2 }, {})[0]));
}

/* across several months */
{
  const st = (payeeId, lines, paidCents = 0, extra = {}) => ({ payeeId, payee: payeeId, title: "", lines, paidCents, ...extra });
  const oct = { month: "2026-10", statements: [
    st("a", [{ label: "Rent - Lot 10", cents: 150000 }, { label: "Mortgage - Lot 10", cents: -40000 }, { label: "Rent - Lot 12", cents: 120000 }], 230000),
    st("t", [{ label: "Rent - Lot 1", cents: 99900 }], 0, { source: { group: "Test" } }),
  ] };
  const nov = { month: "2026-11", statements: [
    st("a", [{ label: "Rent - Lot 10", cents: 150000 }, { label: "Repair - Lot 10", cents: -10000, markupPct: 15 },
      { label: "Supplies - Lot 12", cents: -5000, removed: true }, { label: "Insurance", cents: -3000 }], 135000,
      { previousOwedCents: 230000, priorPaidCents: 230000 }),
    st("cc", [{ label: "Lot Rent - Lot 3117", cents: -34122 }], 0, { notStarted: true }),
  ] };
  const [a, ...rest] = D.summarize([oct, nov]);
  t("one row per property, test and not-started left out", () => rest.length === 0 && a.payeeId === "a");
  t("both months are counted", () => a.months.join() === "2026-10,2026-11");
  t("revenue adds up", () => a.revenueCents === 150000 + 120000 + 150000);
  // 400 + 100 + 15 markup + 30; the deleted $50 is not there.
  t("expenses include markups and leave deleted lines out", () => a.expenseCents === -(40000 + 10000 + 1500 + 3000));
  t("net is revenue plus expenses", () => a.netCents === a.revenueCents + a.expenseCents);
  // Paid is what was paid; adding up each month's owed would count Oct's carry again in Nov.
  t("paid out is what was paid, not each month's owed added up", () => a.paidCents === 365000);
  const lot = (n) => a.lots.find((l) => l.lot === n);
  t("each house has its own totals", () => lot(10).netCents === 150000 - 40000 + 150000 - 11500 && lot(12).netCents === 120000);
  t("a line with no lot is property-wide, not a guessed house", () => lot(null).netCents === -3000);
  t("the houses add up to the property", () => a.lots.reduce((x, l) => x + l.netCents, 0) === a.netCents);

  t("a whole year reads as the year", () => D.rangeLabel("2025-01", "2025-12", "2026-11-16") === "2025");
  t("January to now reads as year to date", () => D.rangeLabel("2026-01", "2026-11", "2026-11-16") === "Year to date 2026");
  t("a range across a new year names both", () => D.rangeLabel("2025-11", "2026-02", "2026-11-16") === "Nov 2025 – Feb 2026");
  t("months between crosses the year", () => D.monthsBetween("2025-11", "2026-02").join() === "2025-11,2025-12,2026-01,2026-02");
  t("months between a month and itself is that month", () => D.monthsBetween("2026-03", "2026-03").join() === "2026-03");
  const rows = D.summaryRangeRows("2026", [a]);
  t("the spreadsheet total is the property total", () => {
    const tot = rows[rows.length - 1];
    return tot[0].v === "Total" && tot[6].v === a.netCents / 100 && tot[7].v === a.paidCents / 100;
  });
}

/* the statement in Excel says what the email says */
{
  const s = { month: "2026-11-01", payee: "Wren", title: "1148 Northside Rd", note: "",
    lines: [{ label: "Rent - Lot 10", cents: 155000, date: "2026-11-01" }, { label: "Repair - Lot 10", cents: -20000, markupPct: 10 },
      { label: "Gone - Lot 10", cents: -99999, removed: true }],
    previousOwedCents: 50000, priorPaidCents: 20000, payments: [] };
  const rows = D.statementRows(s);
  const amounts = rows.flatMap((r) => r.filter((c) => c && typeof c === "object" && c.money).map((c) => c.v));
  const labelled = (txt) => rows.find((r) => r.some((c) => (typeof c === "object" && c ? c.v : c) === txt));
  t("a deleted line is not in the spreadsheet", () => !rows.some((r) => r.includes("Gone - Lot 10")));
  t("a markup is its own row", () => rows.some((r) => r[2] === "Markup 10% on Repair - Lot 10" && r[3].v === -20));
  t("the distribution in the spreadsheet is the statement's", () => labelled("Distribution")[3].v === D.owedCents(s.lines, s) / 100);
  t("money is numbers, not text", () => amounts.length > 4 && amounts.every((v) => typeof v === "number"));
}

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` -- ${why}` : ""}`);
console.log(`\n${checks.length - failed.length}/${checks.length} distribution checks pass`);
process.exit(failed.length ? 1 : 0);
