/** Classifier tests (deterministic layers only — no API calls).
 *  Run: node lib/__fixtures__/classify.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
// Strip the SDK imports so the pure layers can be exercised without network.
const src = readFileSync(join(here, "..", "classify.ts"), "utf8")
  .replace(/^import .*$/gm, "")
  .replace(/export async function classifyWithModel[\s\S]*?\n}\n/, "")
  .replace(/const Result = z[\s\S]*?\n\}\);\n/, "")
  .replace(/\?\? \(await classifyWithModel\(body, ctx\)\)\n/, "");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const M = await import("data:text/javascript," + encodeURIComponent(js));
const { classifySync: c, needsReview, REVIEW_THRESHOLD } = M;

const TENANT = { party: "current_tenant", hasUnit: true, priorConversations: 4 };
const STRANGER = { party: null, hasUnit: false, priorConversations: 0 };

const checks = [];
const t = (n, ok) => checks.push([n, ok]);

// --- source is the answer, not a guess ---
t("Rent Manager work order is maintenance, no guessing",
  c("anything at all", "zego").category === "maintenance"
  && c("x", "zego").confidence === 1 && c("x", "zego").basis === "source");
t("Zillow lead is a prospect regardless of wording",
  c("my sink is broken", "zillow").category === "prospect");

// --- emergencies never reach the model ---
for (const [phrase, label] of [
  ["No heat and it's 54 degrees in here", "no heat"],
  ["there is a gas leak", "gas leak"],
  ["water heater burst, water everywhere", "burst"],
  ["I'm locked out", "lockout"],
]) {
  const r = c(phrase, "sms", TENANT);
  t(`emergency routed instantly: ${label}`,
    r.category === "maintenance" && r.urgent && r.basis === "emergency");
}
t("ordinary repair is maintenance but not urgent",
  c("the kitchen faucet drips", "sms", TENANT).urgent === false);

// --- the case keywords get backwards ---
// "Is it still available?" is a leasing enquiry from a stranger and something
// else entirely from a sitting tenant. Sender identity decides it.
const strangerAsks = c("Hi is this still available?", "sms", STRANGER);
const tenantAsks   = c("Hi is this still available?", "sms", TENANT);
t("stranger asking availability is a prospect", strangerAsks.category === "prospect");
t("tenant asking availability is NOT filed as a prospect",
  tenantAsks.category !== "prospect");
t("the stranger's case is decided by sender identity",
  strangerAsks.basis === "known-tenant");
// A sitting tenant asking "is it still available" is genuinely ambiguous — a
// parking spot, a neighbouring unit, a storage shed. The heuristics decline to
// guess and it goes to a human, which is the correct outcome.
t("the tenant's case declines to guess and goes to review",
  tenantAsks.basis === "fallback" && needsReview(tenantAsks));

// --- known tenant with a repair ---
t("known tenant reporting a repair is maintenance",
  c("the toilet won't stop running", "sms", TENANT).category === "maintenance");
t("stranger describing a repair is not auto-filed as maintenance",
  c("does the toilet work in the 3 bedroom?", "sms", STRANGER).category !== "maintenance");

// --- ambiguity fails into review, not into a confident guess ---
const vague = c("hey", "sms", STRANGER);
t("a vague message is not confidently categorised", needsReview(vague));
t("a vague message lands in 'other', not a team inbox", vague.category === "other");
t("review threshold is a real gate", REVIEW_THRESHOLD > 0.5 && REVIEW_THRESHOLD < 1);
t("high-confidence results clear the gate",
  !needsReview(c("no heat", "sms", TENANT)) && !needsReview(c("x", "zego")));

// --- every result is traceable ---
t("every decision records which layer made it",
  ["source","emergency","known-tenant","model","fallback"]
    .includes(c("hey", "sms", STRANGER).basis));

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
