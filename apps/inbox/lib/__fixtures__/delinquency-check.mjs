/** The morning delinquency report.  Run: node lib/__fixtures__/delinquency-check.mjs
 *
 *  What it guards are the ways a daily email can lie quietly: going at 9 or
 *  11 for half the year, reaching somebody before their first day, calling
 *  a record with no balance on it "paid up", and going out looking complete
 *  when it is not -- or not going out at all when it failed.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = ts.transpileModule(readFileSync(join(here, "..", "delinquency.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const D = await import("data:text/javascript," + encodeURIComponent(src));

const checks = [];
const t = (name, fn) => {
  try { checks.push([name, !!fn()]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

/* ---- the clock: the two UTC firings, and which one is 10am */
t("15:00 UTC in November is 10am in New York (EST)",
  () => D.newYork(new Date("2026-11-10T15:00:00Z")).hour === 10);
t("14:00 UTC in November is 9am, so that firing does not send",
  () => D.newYork(new Date("2026-11-10T14:00:00Z")).hour === 9);
t("14:00 UTC in July is 10am in New York (EDT)",
  () => D.newYork(new Date("2026-07-10T14:00:00Z")).hour === 10);
t("15:00 UTC in July is 11am, so that firing does not send",
  () => D.newYork(new Date("2026-07-10T15:00:00Z")).hour === 11);
t("the day is New York's, not UTC's (02:00 UTC is still the evening before)",
  () => D.newYork(new Date("2026-11-11T02:00:00Z")).day === "2026-11-10");
t("every day of the week, weekends included: Saturday still has a 10am",
  () => D.newYork(new Date("2026-11-14T15:00:00Z")).weekday === "Sat"
     && D.newYork(new Date("2026-11-14T15:00:00Z")).hour === 10);

/* ---- who gets it */
const list = [
  { email: "cade@x.com", name: "Cade", starts_on: null, ends_on: null },
  { email: "natashia@x.com", name: "Natashia", starts_on: "2026-11-15", ends_on: null },
  { email: "gone@x.com", name: "Gone", starts_on: null, ends_on: "2026-11-12" },
  { email: "", name: "No address yet", starts_on: null, ends_on: null },
];
const on = (day) => D.activeRecipients(list, day).map((r) => r.email);
t("somebody starting on the 15th gets nothing on the 14th",
  () => !on("2026-11-14").includes("natashia@x.com"));
t("and gets it on the 15th itself",
  () => on("2026-11-15").includes("natashia@x.com"));
t("somebody who stopped on the 12th is still on it the 11th and off it the 12th",
  () => on("2026-11-11").includes("gone@x.com") && !on("2026-11-12").includes("gone@x.com"));
t("a row with no address is never sent to", () => !on("2026-11-20").includes(""));

/* ---- reading a balance */
t("a record with no balance field is NOT a zero balance",
  () => D.readOwed({ TenantID: 1, Name: "A" }, {}) === null);
t("a zero balance is a zero, not missing",
  () => D.readOwed({ TenantID: 1, Balance: 0 }, {})?.balance === 0);
t("a balance written as text with a dollar sign reads",
  () => D.readOwed({ Balance: "$1,250.50" }, {})?.balance === 1250.5);
t("a balance embed that is a little record reads",
  () => D.readOwed({ Balance: { TotalBalance: 310 } }, {})?.balance === 310);

/* AmountDue and Amount-minus-paid DIFFER here on purpose: with them equal,
   reading the wrong one first would pass. */
const recv = {
  OpenReceivables: [
    { Amount: 500, AmountAllocated: 100, AmountDue: 250, TransactionDate: "2026-10-01T00:00:00" },
    { Amount: 75, AmountAllocated: 0, TransactionDate: "2026-09-12T00:00:00" },
    { Amount: 40, AmountAllocated: 40, TransactionDate: "2026-08-01T00:00:00" },
  ],
};
const r = D.readOwed(recv, {});
t("open receivables: what Rent Manager says is still due beats amount-minus-paid",
  () => r && r.balance === 325);
t("open receivables: a charge paid in full does not set the age",
  () => r && r.oldest === "2026-09-12");
t("an empty receivables list is a real zero",
  () => D.readOwed({ OpenReceivables: [] }, {})?.balance === 0);
t("days late counts from the oldest open charge",
  () => D.daysBetween("2026-09-12", "2026-11-10") === 59);

/* ---- what the email says */
const base = { day: "2026-11-10", ok: true, error: null, tenantsRead: 400,
  partial: false, using: "/Tenants?embeds=OpenReceivables", readAs: {} };
const debtors = [
  { rmTenantId: 1, name: "Small", status: "Current", place: "The Retreat · 3", balance: 50, oldest: null, daysLate: 10 },
  { rmTenantId: 2, name: "Large", status: "Current", place: null, balance: 900, oldest: null, daysLate: 95 },
  { rmTenantId: 3, name: "Former", status: "Past", place: null, balance: 300, oldest: null, daysLate: 200 },
];
const m = D.render({ ...base, debtors });
t("the subject says how many and how much",
  () => m.subject.includes("3 owe") && m.subject.includes("$1,250.00"));
t("with no vacancy section asked for, the subject does not invent a count",
  () => !m.subject.includes("vacant"));
t("largest balance first",
  () => m.text.indexOf("Large") < m.text.indexOf("Small"));
t("moved-out tenants are their own group, not mixed in with current ones",
  () => m.text.indexOf("Moved out") < m.text.indexOf("Former")
     && m.text.indexOf("Small") < m.text.indexOf("Moved out"));
t("aging buckets are shown", () => m.text.includes("Over 90 days: 2, $1,200.00"));
t("a tenant not matched to a unit still appears, saying so",
  () => m.html.includes("Large") && m.html.includes("not matched to a unit"));
t("names are escaped in the html",
  () => !D.render({ ...base, debtors: [{ ...debtors[0], name: "<b>x</b>" }] }).html.includes("<b>x</b>"));

const partial = D.render({ ...base, debtors, partial: true });
t("a cut-short report says so in the subject", () => partial.subject.includes("incomplete"));
t("and in the body", () => /NOT complete/.test(partial.text));

const none = D.render({ ...base, debtors: [] });
t("nobody owing says how many records were read, so it is not mistaken for nothing read",
  () => none.subject.includes("nobody owes") && none.text.includes("400 tenant records"));

const failed = D.render({ ...base, ok: false, error: "Rent Manager would not accept the sign-in." });
t("a failed report is still an email, and says it failed",
  () => failed.subject.includes("could not be read") && failed.text.includes("would not accept"));
t("and says plainly it is not a clean bill",
  () => failed.text.includes("not a report saying nobody owes"));

/* ---- vacancies: what the office marked, for rent and upcoming */
const v = (place, status, extra = {}) => ({ place, status, rent: 850, beds: 3, baths: 2,
  daysListed: null, readyOn: null, blocker: null,
  upcomingShowings: 0, recentShowings: 0, nextShowing: null, ...extra });
/* The days and dates are deliberately NOT in the order the names are, so a
   sort by name and a sort by the right thing give different answers. */
const vac = { note: null, list: [
  v("A Street", "for_rent", { daysListed: 3 }),
  v("B Street", "for_rent", { daysListed: 40,
    upcomingShowings: 2, nextShowing: "2026-11-12T19:00:00Z" }),
  v("C Street", "for_rent"),
  v("D Street", "upcoming", { readyOn: "2026-12-22" }),
  v("E Street", "upcoming", { readyOn: "2026-11-12", blocker: "Being cleaned Nov 11" }),
  v("F Street", "upcoming", { readyOn: "2026-11-01" }),
] };
const both = D.render({ ...base, debtors }, vac);
const at = (x) => both.text.indexOf(x);
t("the subject counts for rent and upcoming separately",
  () => both.subject.includes("3 for rent, 3 upcoming"));
t("for rent: longest on the market first",
  () => at("B Street") < at("A Street"));
t("for rent: a home nobody measured goes last, not first as zero days",
  () => at("A Street") < at("C Street") && !/C Street -- [^\n]*listed/.test(both.text));
t("upcoming: soonest ready first",
  () => at("F Street") < at("E Street") && at("E Street") < at("D Street"));
t("every for-rent home comes before the upcoming list",
  () => at("C Street") < at("UPCOMING") && at("UPCOMING") < at("D Street"));
t("what an upcoming home is waiting on is said",
  () => both.text.includes("Waiting on: Being cleaned Nov 11"));
t("a booked showing is said, with when",
  () => both.text.includes("2 showings booked, next Thu, Nov 12"));
t("a for-rent home with nothing booked says so",
  () => /A Street[^\n]*\n\s+no showings booked/.test(both.text));
t("a ready date in the past on a home still upcoming is called overdue",
  () => /F Street[^\n]*overdue/.test(both.text) && !/D Street[^\n]*overdue/.test(both.text));
t("ready dates read as distance from today",
  () => D.readyText("2026-11-12", "2026-11-10") === "ready about Nov 12 (2 days)"
     && D.readyText("2026-12-01", "2026-11-10") === "ready about Dec 1 (3 weeks)");
t("balances failing does not take the vacancy list down with it",
  () => D.render({ ...base, ok: false, error: "x" }, vac).text.includes("B Street"));
t("a note about the list not being read reaches the email",
  () => D.render({ ...base, debtors }, { ...vac, note: "could not be read" }).text.includes("could not be read"));
t("empty lists say so rather than vanishing",
  () => { const e = D.render({ ...base, debtors }, { note: null, list: [] }).text;
          return e.includes("Nothing is marked for rent") && e.includes("Nothing is marked upcoming"); });
t("names are escaped in the vacancy html",
  () => !D.render({ ...base, debtors }, { note: null, list: [v("<i>x</i>", "for_rent")] }).html.includes("<i>x</i>"));

t("one day late is a day, not days",
  () => D.render({ ...base, debtors: [{ ...debtors[0], daysLate: 1 }] }).text.includes("-- 1 day\n")
     || D.render({ ...base, debtors: [{ ...debtors[0], daysLate: 1 }] }).text.match(/-- 1 day$/m));

let bad = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${why ? `  (${why})` : ""}`);
  if (!ok) bad++;
}
console.log(`\n${checks.length - bad}/${checks.length} passed`);
process.exit(bad ? 1 : 0);
