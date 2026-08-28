/** Rules engine tests.  Run:  node lib/__fixtures__/prequal.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "prequal.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const M = await import("data:text/javascript," + encodeURIComponent(js));
const { evaluate, DEFAULT_RULE_SET: RS, declineMessage, tenantShareOfRent } = M;

const base = {
  monthly_income: 4500, other_monthly_income: 0, household_income: 0,
  monthly_assistance: 0, rent: 1200, credit_score: 700,
  rental_history_months: 36, years_since_eviction: null, has_cosigner: false,
};
const ev = (o) => evaluate({ ...base, ...o }, RS);

const checks = [];
const t = (name, ok) => checks.push([name, ok]);

// ---- the three outcomes ----
t("strong applicant books straight through", ev({}).outcome === "auto_approve");
t("thin credit goes to a human, not a decline",
  ev({ credit_score: 580 }).outcome === "manual_review");
t("well below threshold declines",
  ev({ credit_score: 480 }).outcome === "declined");
t("one fail outranks other passes",
  ev({ credit_score: 480, monthly_income: 99999 }).outcome === "declined");
t("marginal on two criteria is still just review",
  ev({ credit_score: 580, rental_history_months: 18 }).outcome === "manual_review");

// ---- the voucher case: the whole compliance argument ----
// Rent 1200, voucher covers 840, applicant pays 360, earns 1400/mo.
const voucher = ev({ monthly_income: 1400, monthly_assistance: 840, rent: 1200,
                     credit_score: 650, rental_history_months: 30 });
t("voucher: ratio computed on the tenant's share", voucher.tenantShareRent === 360);
t("voucher: 1400/360 = 3.89x, qualifies", voucher.incomeRatio === 3.89);
t("voucher: applicant is approved", voucher.outcome === "auto_approve");
// The same person judged against FULL rent would be 1.17x -> declined.
t("voucher: full-rent math would have declined them",
  Math.round((1400 / 1200) * 100) / 100 === 1.17);
t("assistance covering all rent cannot fail on income",
  ev({ monthly_income: 400, monthly_assistance: 1200, rent: 1200 }).outcome === "auto_approve");

// ---- all lawful income counts ----
const ssi = ev({ monthly_income: 1800, other_monthly_income: 1800, rent: 1100 });
t("second income source counts in full", ssi.countedIncome === 3600);
t("counting it qualifies them", ssi.outcome === "auto_approve");
t("ignoring it would have failed them",
  1800 / 1100 < 2.5);

// ---- missing data ----
t("unanswered credit goes to review, never auto-decline",
  ev({ credit_score: null }).outcome === "manual_review");
t("never-evicted is treated as the best answer, not missing",
  ev({ years_since_eviction: null }).results.find((r) => r.key === "years_since_eviction").verdict === "pass");
t("a recent eviction judgment declines",
  ev({ years_since_eviction: 1 }).outcome === "declined");

// ---- explanation quality ----
const declined = ev({ credit_score: 480, rental_history_months: 4 });
const msg = declineMessage(declined, "1140 Northside Rd, Lot 51", "https://larabeehomesllc.com/criteria");
t("decline names every criterion missed",
  msg.includes("credit score of 620") && msg.includes("24 months"));
t("decline never claims the home is unavailable",
  !/no longer available|not available|already (rented|taken)|nothing (available|open)/i.test(msg));
t("decline offers a real path forward",
  msg.includes("guarantor") && msg.includes("another adult"));
t("reason codes name the criteria", declined.reasonCodes.includes("credit_score"));
t("passing criteria are not in the reason codes",
  !declined.reasonCodes.includes("income_ratio"));
t("every criterion gets a recorded verdict",
  ev({}).results.length === RS.criteria.length);

// ---- income from another adult on the lease ----
// Alone, 2200 against 1200 rent is 1.83x -> declined.
t("one income alone falls short",
  ev({ monthly_income: 2200 }).outcome === "declined");
const two = ev({ monthly_income: 2200, household_income: 2000 });
t("a co-applicant's income is added in", two.countedIncome === 4200);
t("together they qualify", two.outcome === "auto_approve");
t("co-applicant income also lands on the tenant's share, not full rent",
  ev({ monthly_income: 800, household_income: 900, monthly_assistance: 700, rent: 1200 })
    .incomeRatio === 3.4);

// ---- guarantor ----
// A guarantor is an unverified checkbox at this stage, so it can move a hard
// fail to review, but must never produce an approval on its own.
const shortNoGuarantor = ev({ monthly_income: 2000 });
const shortWithGuarantor = ev({ monthly_income: 2000, has_cosigner: true });
t("short on income without a guarantor is declined",
  shortNoGuarantor.outcome === "declined");
t("the same applicant with a guarantor goes to review",
  shortWithGuarantor.outcome === "manual_review");
t("a guarantor never produces an auto-approval",
  shortWithGuarantor.outcome !== "auto_approve");
t("the reason says a guarantor was offered and needs verifying",
  shortWithGuarantor.results.find((r) => r.key === "income_ratio")
    .reason.includes("guarantor was offered"));
t("a guarantor also covers a failed credit score",
  ev({ credit_score: 480, has_cosigner: true }).outcome === "manual_review");
t("a guarantor does NOT cure a recent eviction judgment",
  ev({ years_since_eviction: 1, has_cosigner: true }).outcome === "declined");
t("a guarantor changes nothing for an applicant who already passes",
  ev({ has_cosigner: true }).outcome === "auto_approve");
t("decline copy offers the guarantor route",
  declineMessage(ev({ credit_score: 300, years_since_eviction: 1 }), "x", "y")
    .includes("guarantor"));

// ---- helper ----
t("tenant share floors at zero", tenantShareOfRent(1000, 1500) === 0);

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
