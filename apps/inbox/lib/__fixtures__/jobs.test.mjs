/** Urgency, and reading a place out of a Rent Manager subject line.
 *  Run: node lib/__fixtures__/jobs.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(readFileSync(join(here, "..", "jobs.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { jobStatus, jobTone, urgencyLabel, urgencyFromText, lotDigits, propertyHint, byWorst } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (n, ok) => checks.push([n, ok]);

// --- what a status is called ---
t("needs_parts is said the way a person says it", jobStatus("needs_parts") === "Waiting on parts");
t("an unknown status is still readable", jobStatus("some_new_thing") === "some new thing");
t("waiting on somebody is one tone", jobTone("new") === "waiting" && jobTone("assigned") === "waiting");
t("under way is another", jobTone("in_progress") === "moving" && jobTone("scheduled") === "moving");
t("stuck is its own", jobTone("needs_parts") === "stuck");
t("only the top two urgencies are named",
  urgencyLabel(1) === "Emergency" && urgencyLabel(2) === "Urgent"
  && urgencyLabel(3) === null && urgencyLabel(null) === null);

// --- how urgent it sounds ---
t("a gas leak is an emergency", urgencyFromText("I can smell gas in the kitchen") === 1);
t("so is no heat", urgencyFromText("No heat since last night") === 1);
t("so is sewage", urgencyFromText("Sewage backing up into the tub") === 1);
t("no hot water is urgent, not an emergency", urgencyFromText("No hot water") === 2);
t("a leak is urgent", urgencyFromText("Kitchen sink leaking from riser") === 2);
// The whole point of the conservative list: most things stay at 3 so the
// dashboard's top is worth reading.
t("a sticking door is neither", urgencyFromText("Back door sticks in the rain") === 3);
t("case does not matter", urgencyFromText("SMELL GAS") === 1);

// --- reading the place out of the subject ---
const SUBJECT = "1140 Northside #51, 1140 Northside Rd, Lot #51";
t("the lot number comes out of the real subject line", lotDigits(SUBJECT) === "51");
// The one that would quietly file every request against lot 1140.
t("the street number is not mistaken for the lot", lotDigits("1140 Northside Rd") === null);
t("'Lot 7' with no hash still reads", lotDigits("Evergreen, Lot 7") === "7");
t("so does Unit and Apt", lotDigits("Unit 3B") === "3" && lotDigits("Apt #12") === "12");
t("nothing in, nothing out", lotDigits(null) === null && lotDigits("") === null);

t("the property comes out without the lot on the end",
  propertyHint(SUBJECT) === "1140 Northside");
t("and without a bare Lot marker",
  propertyHint("Evergreen Pines Lot 7, 300 Pines Rd") === "Evergreen Pines");

// --- worst first ---
const job = (o) => ({ id: o.id, summary: "x", status: "new", urgency: o.urgency ?? 3,
  scheduledFor: o.scheduledFor ?? null, createdAt: o.createdAt ?? "2026-09-01T00:00:00Z",
  conversationId: null, where: null });
const NOW = Date.parse("2026-10-01T12:00:00Z");
{
  const sorted = [
    job({ id: "old", createdAt: "2026-08-01T00:00:00Z" }),
    job({ id: "late", scheduledFor: "2026-09-20T00:00:00Z" }),
    job({ id: "emergency", urgency: 1, createdAt: "2026-09-30T00:00:00Z" }),
    job({ id: "urgent", urgency: 2 }),
  ].sort(byWorst(NOW)).map((j) => j.id);
  t("an emergency outranks everything, however new", sorted[0] === "emergency");
  t("then anything past its date, however ordinary", sorted[1] === "late");
  t("then by urgency", sorted[2] === "urgent");
  t("and the forgotten one is not left to the bottom by age alone", sorted[3] === "old");
}
{
  // A date in the future is not late.
  const sorted = [
    job({ id: "booked", scheduledFor: "2026-10-20T00:00:00Z" }),
    job({ id: "plain", createdAt: "2026-07-01T00:00:00Z" }),
  ].sort(byWorst(NOW)).map((j) => j.id);
  t("a job scheduled for next week is not overdue", sorted[0] === "plain");
}

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
