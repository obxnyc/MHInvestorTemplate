/**
 * Prequalification rules engine.
 *
 * Pure functions, no I/O, so every decision is reproducible from its inputs
 * plus the ruleset version that produced it. That reproducibility is the whole
 * point: when someone asks why an applicant was declined last March, you replay
 * the exact rules that ran rather than reading today's code and hoping.
 *
 * Deliberately NOT a weighted composite score. One number is harder to explain,
 * harder to defend, and hides which criterion actually drove the outcome.
 * Per-criterion verdicts route just as well and come with a real explanation.
 */

export type Verdict = "pass" | "marginal" | "fail";
export type Outcome = "auto_approve" | "manual_review" | "declined";

export type Criterion = {
  key: string;
  label: string;
  /** Comparator against the derived value, e.g. ">= 3.0". */
  pass: string;
  /** Anything below `pass` but meeting this goes to a human. Omit to make the
   *  criterion pass-or-fail. */
  marginal?: string;
  /** Shown to the applicant when they miss it. Must state the threshold, never
   *  imply the home is unavailable. */
  explain: string;
};

export type RuleSet = {
  version: number;
  criteria: Criterion[];
  /**
   * Criteria a guarantor can rescue. A guarantor downgrades a FAIL to review —
   * never to a pass. At prescreen the guarantor is a checkbox, not a verified
   * person: their own income and credit have not been looked at, so approving
   * on the strength of one would be approving on an unverified claim.
   * Applied identically to every applicant, like every other rule here.
   */
  guarantor_rescues?: string[];
};

export type Answers = {
  /** Gross monthly income from employment. */
  monthly_income: number;
  /** Every other lawful monthly source: SSI, disability, child support,
   *  pension, second job. Counted in full — many states protect source of
   *  income, and excluding these screens out protected classes. */
  other_monthly_income: number;
  /**
   * Income from other adults who will sign the lease.
   *
   * Asked as income from co-applicants, never as household composition. "Who
   * else lives with you" invites disclosure of familial status; "which other
   * adults will be on the lease, and what do they earn" is about the people
   * legally responsible for the rent.
   */
  household_income: number;
  /** Rental assistance (a Housing Choice Voucher, say) paid directly to the
   *  landlord. NOT added to income; it reduces what the tenant pays. */
  monthly_assistance: number;
  /** Full contract rent for the home they are applying to. */
  rent: number;
  /** Self-reported. Because it is not a pulled consumer report, a decline here
   *  is not an FCRA adverse action. FCRA attaches later, at application. */
  credit_score: number | null;
  rental_history_months: number;
  /** null = never had an eviction judgment. */
  years_since_eviction: number | null;
  /** Unverified at this stage — see RuleSet.guarantor_rescues. */
  has_cosigner: boolean;
};

export type CriterionResult = {
  key: string;
  label: string;
  verdict: Verdict;
  value: number | null;
  threshold: string;
  reason: string;
};

export type Evaluation = {
  outcome: Outcome;
  results: CriterionResult[];
  reasonCodes: string[];
  /** Total counted income and the rent the applicant personally pays. */
  countedIncome: number;
  tenantShareRent: number;
  incomeRatio: number | null;
};

/** "gte:3" / ">= 3" / ">=3" all mean the same thing. */
function compare(value: number, expr: string): boolean {
  const m = /^\s*(>=|<=|>|<|==)?\s*(-?\d+(?:\.\d+)?)\s*$/.exec(expr.replace(/^gte:/, ">="));
  if (!m) throw new Error(`unparseable threshold: ${expr}`);
  const op = m[1] ?? ">=";
  const n = parseFloat(m[2]);
  switch (op) {
    case ">=": return value >= n;
    case "<=": return value <= n;
    case ">":  return value > n;
    case "<":  return value < n;
    case "==": return value === n;
    default:   return false;
  }
}

/**
 * The rent an applicant personally pays.
 *
 * This is the single most consequential line in the file. Applying a 3x
 * multiplier to the FULL rent for someone whose voucher covers most of it
 * screens out nearly every voucher holder — a textbook disparate-impact
 * problem, and already non-compliant in states that require minimum-income
 * tests to use the tenant's share.
 */
export function tenantShareOfRent(rent: number, assistance: number): number {
  return Math.max(0, rent - Math.max(0, assistance));
}

/** Every lawful source counts, from every adult who will be on the lease. */
export function countedIncome(a: Answers): number {
  return Math.max(0, a.monthly_income)
       + Math.max(0, a.other_monthly_income)
       + Math.max(0, a.household_income ?? 0);
}

function derive(key: string, a: Answers): number | null {
  switch (key) {
    case "income_ratio": {
      const share = tenantShareOfRent(a.rent, a.monthly_assistance);
      // Assistance covers the whole rent: nothing to afford, so this cannot fail.
      if (share <= 0) return Number.POSITIVE_INFINITY;
      return countedIncome(a) / share;
    }
    case "credit_score":
      return a.credit_score;
    case "rental_history_months":
      return a.rental_history_months;
    case "years_since_eviction":
      // Never evicted is the best possible answer, not a missing one.
      return a.years_since_eviction === null ? Number.POSITIVE_INFINITY : a.years_since_eviction;
    default:
      return null;
  }
}

export function evaluate(a: Answers, ruleSet: RuleSet): Evaluation {
  const results: CriterionResult[] = [];

  for (const c of ruleSet.criteria) {
    const value = derive(c.key, a);

    // An unanswered criterion is a question for a human, never an automatic
    // decline: silence is not evidence against an applicant.
    if (value === null || Number.isNaN(value)) {
      results.push({
        key: c.key, label: c.label, verdict: "marginal", value: null,
        threshold: c.pass, reason: `${c.label} not provided`,
      });
      continue;
    }

    let verdict: Verdict;
    if (compare(value, c.pass)) verdict = "pass";
    else if (c.marginal && compare(value, c.marginal)) verdict = "marginal";
    else verdict = "fail";

    // An offered guarantor turns a hard fail into a question for a person.
    // It never turns one into an approval: nobody has verified the guarantor.
    let rescued = false;
    if (verdict === "fail" && a.has_cosigner
        && (ruleSet.guarantor_rescues ?? []).includes(c.key)) {
      verdict = "marginal";
      rescued = true;
    }

    results.push({
      key: c.key, label: c.label, verdict,
      value: Number.isFinite(value) ? Math.round(value * 100) / 100 : null,
      threshold: c.pass,
      reason: rescued
        ? `${c.label} is short of ${c.pass}, but a guarantor was offered — needs verifying`
        : verdict === "pass" ? `${c.label} meets ${c.pass}` : c.explain,
    });
  }

  const outcome: Outcome =
    results.some((r) => r.verdict === "fail") ? "declined"
    : results.some((r) => r.verdict === "marginal") ? "manual_review"
    : "auto_approve";

  const share = tenantShareOfRent(a.rent, a.monthly_assistance);
  return {
    outcome,
    results,
    reasonCodes: results.filter((r) => r.verdict !== "pass").map((r) => r.key),
    countedIncome: countedIncome(a),
    tenantShareRent: share,
    incomeRatio: share > 0 ? Math.round((countedIncome(a) / share) * 100) / 100 : null,
  };
}

/**
 * What the applicant is told when they miss a criterion.
 *
 * Never says or implies the home is unavailable. Telling a qualified applicant
 * a home is taken when it is not is an availability misrepresentation and the
 * single most common thing fair-housing testers are sent to catch — and your
 * own logs would show the unit was open.
 */
export function declineMessage(
  ev: Evaluation, address: string, criteriaUrl: string,
): string {
  const missed = ev.results.filter((r) => r.verdict === "fail").map((r) => r.reason);
  return [
    `Thanks for your interest in ${address}.`,
    ``,
    `Based on what you shared, this home isn't a match for our current rental criteria:`,
    ...missed.map((m) => `  • ${m}`),
    ``,
    `You're welcome to apply again with a guarantor who can sign for the lease,`,
    `with income from another adult who would be on the lease, or with`,
    `additional income documentation.`,
    `Our full criteria are published at ${criteriaUrl}.`,
  ].join("\n");
}

/** The ruleset shipped in seed.sql. Published, versioned, applied identically
 *  to everyone — which is the thing you actually have to be able to prove. */
export const DEFAULT_RULE_SET: RuleSet = {
  version: 2,
  // Income and credit are the two a guarantor conventionally backstops.
  // A recent eviction judgment is not something a guarantor cures.
  guarantor_rescues: ["income_ratio", "credit_score"],
  criteria: [
    {
      key: "income_ratio",
      label: "Household income vs. the rent you would pay",
      pass: ">= 3.0",
      marginal: ">= 2.5",
      explain: "we look for monthly household income of at least 3x the rent you would pay",
    },
    {
      key: "credit_score",
      label: "Credit score",
      pass: ">= 620",
      marginal: ">= 560",
      explain: "we look for a credit score of 620 or above",
    },
    {
      key: "rental_history_months",
      label: "Verifiable rental history",
      pass: ">= 24",
      marginal: ">= 12",
      explain: "we look for at least 24 months of verifiable rental history",
    },
    {
      key: "years_since_eviction",
      label: "Time since any eviction judgment",
      pass: ">= 5",
      marginal: ">= 3",
      explain: "we look for at least 5 years since any eviction judgment",
    },
  ],
};
