/** Rent collections: the rules.  Run: node lib/__fixtures__/collections-check.mjs
 *
 *  Every fixture is built so the wrong rule and the right one give
 *  DIFFERENT answers. A fixture that gives one of everything cannot tell
 *  best-of from sum-of-all, and this file has been bitten by that three
 *  times already.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = ts.transpileModule(readFileSync(join(here, "..", "collections.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const C = await import("data:text/javascript," + encodeURIComponent(src));
const P = C.DEFAULT_POLICY;

const checks = [];
const t = (name, fn) => {
  try { checks.push([name, !!fn()]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

const acct = (o) => ({ rmTenantId: 1, name: "Tiffany Jernigan", balanceCents: 125000,
  oldestCharge: "2026-11-01", stage: "current", stageOn: null, courtOn: null, ...o });

/* ---- the calendar */
t("the 5th is not late", () => C.settle(acct({}), "2026-11-05", P).stage === "current");
t("the 6th is late, served that day", () => {
  const s = C.settle(acct({}), "2026-11-06", P);
  return s.stage === "late" && s.stageOn === "2026-11-06";
});
t("somebody first seen on the 9th owing was late from the 6th, not the 9th",
  () => C.settle(acct({}), "2026-11-09", P).stageOn === "2026-11-06");
t("owing from October on Nov 3rd: late since Oct 6th, before this month's 6th", () => {
  const s = C.settle(acct({ oldestCharge: "2026-10-01" }), "2026-11-03", P);
  return s.stage === "late" && s.stageOn === "2026-10-06";
});
t("paid up mid-process goes back to current, and says it was filed",
  () => {
    const s = C.settle(acct({ balanceCents: 0, stage: "filed", stageOn: "2026-11-17" }), "2026-11-20", P);
    return s.stage === "current" && s.paidDuring === "filed";
  });
t("a few cents is not a balance", () => C.settle(acct({ balanceCents: 40 }), "2026-11-10", P).stage === "current");
t("a filing is never inferred from the calendar",
  () => C.settle(acct({ stage: "late", stageOn: "2026-10-06" }), "2026-11-20", P).stage === "late");

/* ---- the next step and its date */
t("demand served the 6th: file on the 17th, after ten full days",
  () => C.nextStep(acct({ stage: "late", stageOn: "2026-11-06" }), "2026-11-10", P).due === "2026-11-17");
t("on the 19th the filing is two days overdue",
  () => C.nextStep(acct({ stage: "late", stageOn: "2026-11-06" }), "2026-11-19", P).overdue === 2);
t("filed with no court date: the next step is to enter it",
  () => /court date/.test(C.nextStep(acct({ stage: "filed", stageOn: "2026-11-17" }), "2026-11-18", P).label));
t("a judgment: the writ is asked for after the appeal days",
  () => C.nextStep(acct({ stage: "judgment", stageOn: "2026-11-27" }), "2026-11-28", P).due === "2026-12-08");

/* ---- plays out by: the line an arrangement has to beat */
t("served Nov 6: out by Dec 13 (file 17th, court +10 = 27th, appeal 10 +1 = Dec 8, writ 5)",
  () => C.playsOutBy(acct({ stage: "late", stageOn: "2026-11-06" }), "2026-11-10", P) === "2026-12-13");
t("a real court date moves it", () =>
  C.playsOutBy(acct({ stage: "filed", stageOn: "2026-11-17", courtOn: "2026-12-01" }), "2026-11-20", P) === "2026-12-17");

/* ---- payments off the balance */
t("a payment is a fall; the 1st's new charge is not a payment going backwards", () => {
  // 1250 at the promise, paid 400 (850), rent charged (2100), paid 600 (1500).
  const r = [{ at: "b", cents: 85000 }, { at: "c", cents: 210000 }, { at: "d", cents: 150000 }];
  // Net change (start minus end) would say -250: wrong. Falls say 1000.
  return C.paidSince(125000, r, "a") === 100000;
});
t("readings before the promise do not count",
  () => C.paidSince(125000, [{ at: "a", cents: 50000 }, { at: "c", cents: 100000 }], "b") === 25000);

/* ---- promises */
const pr = (o) => ({ id: "p1", amountCents: 40000, dueOn: "2026-11-20", madeAt: "2026-11-10T15:00:00Z",
  balanceAtCents: 125000, paidNowCents: 0, status: "open", ...o });
t("due today and unpaid is still open, not broken",
  () => C.judge(pr({}), [], "2026-11-20").status === "open");
t("the day after, it is broken", () => C.judge(pr({}), [], "2026-11-21").status === "broken");
t("$399.50 on a $400 promise is kept", () =>
  C.judge(pr({}), [{ at: "2026-11-19T00:00:00Z", cents: 85050 }], "2026-11-21").status === "kept");
t("paid late turns broken into kept", () =>
  C.judge(pr({}), [{ at: "2026-11-23T00:00:00Z", cents: 85000 }], "2026-11-24").status === "kept");
t("half paid by the day is still broken, with what was paid said", () => {
  const j = C.judge(pr({}), [{ at: "2026-11-19T00:00:00Z", cents: 105000 }], "2026-11-21");
  return j.status === "broken" && j.paidCents === 20000;
});
t("cancelled stays cancelled even if the money came", () =>
  C.judge(pr({ status: "cancelled" }), [{ at: "2026-11-19T00:00:00Z", cents: 0 }], "2026-11-21").status === "cancelled");

/* ---- who to worry about */
const late = acct({ stage: "late", stageOn: "2026-11-06" }); // plays out Dec 13
const J = (o) => ({ ...pr(o), judged: o.judged ?? "open", paidCents: o.paidCents ?? 0 });
t("a promise before it plays out is arranged",
  () => C.standing(late, [J({ dueOn: "2026-12-01" })], null, "2026-11-10", P, 0).standing === "arranged");
t("a promise AFTER it plays out, nothing paid, is not arranged",
  () => C.standing(late, [J({ dueOn: "2026-12-20" })], null, "2026-11-10", P, 0).standing === "talking");
t("the same late promise WITH half paid is arranged (significant payment and a plan)",
  // owed at late = 1250 + 1250 paid = 2500; 50% exactly.
  () => C.standing(late, [J({ dueOn: "2026-12-20" })], null, "2026-11-10", P, 125000).standing === "arranged");
t("49% is not significant", () =>
  C.standing(late, [J({ dueOn: "2026-12-20" })], null, "2026-11-10", P, 120000).standing === "talking");
t("broken and nothing since is a worry",
  () => C.standing(late, [J({ judged: "broken" })], "2026-11-21T10:00:00Z", "2026-11-22", P, 0).standing === "broken");
t("broken, then a NEW promise, is arranged again", () =>
  C.standing(late, [J({ judged: "broken" }), J({ id: "p2", madeAt: "2026-11-22T00:00:00Z", dueOn: "2026-11-28" })],
    null, "2026-11-22", P, 0).standing === "arranged");
t("heard from two days ago, nothing arranged: talking",
  () => C.standing(late, [], "2026-11-08T12:00:00Z", "2026-11-10", P, 0).standing === "talking");
t("heard from five days ago: silent (quiet days is 3)",
  () => C.standing(late, [], "2026-11-05T12:00:00Z", "2026-11-10", P, 0).standing === "silent");

/* ---- expected money */
t("expected counts only what is left to pay, on its day, and skips kept and broken", () => {
  const e = C.expected([
    { ...J({ dueOn: "2026-11-12", paidCents: 10000 }), rmTenantId: 1, name: "A" },
    { ...J({ id: "p2", dueOn: "2026-11-12", amountCents: 25000 }), rmTenantId: 2, name: "B" },
    { ...J({ id: "p3", dueOn: "2026-11-12", judged: "kept" }), rmTenantId: 3, name: "C" },
    { ...J({ id: "p4", dueOn: "2026-11-12", judged: "broken" }), rmTenantId: 4, name: "D" },
  ], "2026-11-10", 7);
  return e[2].cents === 30000 + 25000 && e[2].who.length === 2 && e[0].cents === 0;
});

/* ---- reminder texts */
const person = (o) => ({ rmTenantId: 7, name: "Tiffany Jernigan", phone: "+19105550100", balanceCents: 125000,
  rentCents: 125000, lateFeeCents: 6250, status: "Current", ...o });
const all = new Set(C.REMINDERS);
t("three days before the 1st, everybody gets the before-due text, even paid up", () => {
  const d = C.remindersDue("2026-11-28", [person({ balanceCents: 0 })], [], new Set(), all, P);
  return d.length === 1 && d[0].kind === "before_due" && /December rent of \$1,250\.00/.test(d[0].body);
});
t("the 6th: the late text names the demand", () => {
  const d = C.remindersDue("2026-11-06", [person({})], [], new Set(), all, P);
  return d.length === 1 && d[0].kind === "late" && /10-day demand/.test(d[0].body);
});
t("the 6th: nobody paid up is texted that they are late",
  () => C.remindersDue("2026-11-06", [person({ balanceCents: 0 })], [], new Set(), all, P).length === 0);
t("a text already in the ledger does not go twice",
  () => C.remindersDue("2026-11-06", [person({})], [], new Set(["late:7:2026-11"]), all, P).length === 0);
t("no phone, no draft", () => C.remindersDue("2026-11-06", [person({ phone: null })], [], new Set(), all, P).length === 0);
t("a past tenant is not texted about rent",
  () => C.remindersDue("2026-11-06", [person({ status: "Past" })], [], new Set(), all, P).length === 0);
t("a kind switched off is not drafted", () =>
  C.remindersDue("2026-11-06", [person({})], [], new Set(), new Set(["before_due"]), P).length === 0);
t("the day before a promise, and the day after a broken one", () => {
  const ps = [{ ...J({ dueOn: "2026-11-20" }), rmTenantId: 7 }];
  const eve = C.remindersDue("2026-11-19", [person({})], ps, new Set(), all, P);
  const missed = C.remindersDue("2026-11-21", [person({})],
    [{ ...J({ dueOn: "2026-11-20", judged: "broken" }), rmTenantId: 7 }], new Set(), all, P);
  return eve.length === 1 && eve[0].kind === "promise_eve" && missed.length === 1 && /eviction process continues/.test(missed[0].body);
});

/* ---- reading a promise out of a text */
const RP = (s) => C.readPromise(s, "2026-11-17"); // a Tuesday
t("'I can pay 400 on Friday' is $400 on Fri Nov 20", () => {
  const r = RP("I can pay 400 on Friday"); return r && r.cents === 40000 && r.dueOn === "2026-11-20";
});
t("'$1,250.50 tomorrow'", () => { const r = RP("I'll send $1,250.50 tomorrow"); return r && r.cents === 125050 && r.dueOn === "2026-11-18"; });
t("a date before the amount: 'on 11/27 I'll pay 300'", () => {
  const r = RP("on 11/27 I'll pay 300"); return r && r.cents === 30000 && r.dueOn === "2026-11-27";
});
t("'the 3rd' after the 17th is next month's 3rd", () => {
  const r = RP("I get paid and can pay 600 on the 3rd"); return r && r.dueOn === "2026-12-03" && r.cents === 60000;
});
t("an hour is not money: 'pay at 11 friday' has no amount", () => RP("I will pay at 11 friday") === null);
t("a year is not money: 'pay friday, 2026'", () => RP("I will pay friday 2026") === null);
t("Friday said ON a Friday means next Friday, not today",
  () => C.readPromise("pay 200 friday", "2026-11-20").dueOn === "2026-11-27");
t("an amount with no day is not a promise", () => RP("I can pay 400") === null);
t("no talk of paying is not a promise", () => RP("the water heater broke on friday, 40 gallon") === null);

/* ---- report */
let failed = 0;
for (const [name, ok, why] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
}
console.log(`\n${checks.length - failed} of ${checks.length} passed`);
process.exit(failed ? 1 : 0);
