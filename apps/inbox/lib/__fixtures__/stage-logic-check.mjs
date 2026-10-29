/**
 * Where we got to, and whose move it is.
 *   Run:  node lib/__fixtures__/stage-logic-check.mjs
 *
 * The migration is checked against a real Postgres in stage-check.mjs. This
 * is the arithmetic and the three-way answer.
 *
 * THE SAME NUMBER OF DAYS HAS TO GIVE DIFFERENT ANSWERS, or the per-stage
 * patience is not being tested at all. Two days is late on a lead nobody has
 * answered and perfectly fine on a showing booked for next week -- so both
 * are asked with two days, and a version where every stage shared one window
 * would fail. Asking only about 'new' would pass on that version, which is
 * the "fixture that cannot tell two answers apart" fault this suite has now
 * hit four times.
 */
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadTs } from "./tsload.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { waiting, chaseOrder, daysSince, isStage, stageLabel, stageSays, STAGES,
        STAGE_INFO } = await loadTs(join(here, "..", "stage.ts"));

const NOW = new Date(Date.UTC(2026, 9, 29, 12, 0, 0));
const ago = (days) => new Date(NOW.getTime() - days * 864e5).toISOString();

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

/* ---- the same two days, two different answers ---- */

const newTwoDays = waiting({ stage: "new", stageAt: ago(2) }, NOW);
const tourTwoDays = waiting({ stage: "tour_booked", stageAt: ago(2) }, NOW);
t("two days unanswered is late", newTwoDays.late === true);
t("two days with a showing booked is NOT late", tourTwoDays.late === false);
t("and it is the stage that made the difference, not the days",
  () => newTwoDays.days === tourTwoDays.days);

t("the late one says how long and what to do",
  () => /2 days/.test(newTwoDays.why) && /repl/i.test(newTwoDays.why));

/* ---- three answers, not two ---- */

const unsaid = waiting({ stage: null, stageAt: null }, NOW);
t("a lead with no stage is not reported as late", unsaid.late === false);
t("nor as a lead that is fine and N days old", unsaid.days === null);
t("it is reported as nobody having said", () => unsaid.unknown === true);
t("and says so in words", () => /nobody has said/i.test(unsaid.why));

/* A stage with no date is the same gap in a different column: the stage_at
   column arrived after the rows did, so a stage can be set with no date. */
const dateless = waiting({ stage: "applied", stageAt: null }, NOW);
t("a stage with no date cannot be late either", dateless.late === false);
t("and names which half is missing", () => /but not when/i.test(dateless.why));

/* Treating an unset stage as 'new' failed only the wording check above,
   because a 'new' with no date falls into the dateless branch and comes back
   wearing the same shape -- late false, days null, unknown true. So this asks
   the one thing only the unset rule can answer: an unset stage must not claim
   a stage was ever marked. */
t("an unset stage does not claim some stage was marked",
  () => !/marked/i.test(unsaid.why));

/* ---- the clock ---- */

t("a stage_at in the future is nought days, not minus two",
  daysSince(new Date(NOW.getTime() + 2 * 864e5).toISOString(), NOW) === 0);
t("an unparseable date is unknown, not nought",
  daysSince("not a date", NOW) === null);
t("a missing date is unknown", daysSince(null, NOW) === 0 ? false : daysSince(null, NOW) === null);
t("exactly at the limit is not yet late",
  waiting({ stage: "replied", stageAt: ago(STAGE_INFO.replied.waitDays) }, NOW).late === false);
t("and one day past it is",
  waiting({ stage: "replied", stageAt: ago(STAGE_INFO.replied.waitDays + 1) }, NOW).late === true);

/* ---- the order the board works in ---- */

const rows = [
  { id: "fresh", stage: "replied", stageAt: ago(0) },
  { id: "unsaid", stage: null, stageAt: null },
  { id: "late-a-bit", stage: "new", stageAt: ago(3) },
  { id: "late-a-lot", stage: "new", stageAt: ago(14) },
  { id: "also-fine", stage: "tour_booked", stageAt: ago(1) },
  /* THE PAIR THAT TELLS THE TWO SORTS APART, and the reason the rest of this
     list cannot. Dropping the overdue-first rule and sorting on days alone
     still put the longest-waiting row on top, so every check above passed on
     the fault. These two are the other way round: the late one has waited
     TWO days and the one that is perfectly fine has waited SIX, so only a
     sort that asks whether something is overdue puts them in this order. */
  { id: "late-but-recent", stage: "new", stageAt: ago(2) },
  { id: "fine-but-old", stage: "tour_booked", stageAt: ago(6) },
];
const order = chaseOrder(rows, NOW).map((r) => r.id);

t("the overdue ones come first", () => order[0].startsWith("late"));
/* TWO late rows on purpose. With one, "late first" and "longest first" are
   the same answer and the second rule is untested. */
t("and the longest-overdue of them is first", order[0] === "late-a-lot");
t("the one nobody has said anything about comes after the overdue ones",
  () => order.indexOf("unsaid") > order.indexOf("late-a-bit"));
t("but before the ones that are fine",
  () => order.indexOf("unsaid") < order.indexOf("fresh")
     && order.indexOf("unsaid") < order.indexOf("also-fine"));
t("a lead overdue by two days outranks a fine one waiting six",
  () => order.indexOf("late-but-recent") < order.indexOf("fine-but-old"));
t("and it is not simply that it waited longer, because it did not",
  () => daysSince(ago(2), NOW) < daysSince(ago(6), NOW));

t("nothing is lost or duplicated by sorting", order.length === rows.length
  && new Set(order).size === rows.length);
t("and the array it was given is not reordered underneath it",
  () => rows[0].id === "fresh");

/* ---- the enum, and what the screen calls it ---- */

t("every stage has a label, a meaning, a next move and a window",
  () => STAGES.every((s) => STAGE_INFO[s].label && STAGE_INFO[s].meaning
     && STAGE_INFO[s].next && STAGE_INFO[s].waitDays > 0));
t("the windows are not all the same, or the per-stage rule does nothing",
  () => new Set(STAGES.map((s) => STAGE_INFO[s].waitDays)).size > 1);
t("'leased' is not a stage: that is an outcome, in one column only",
  isStage("leased") === false);
t("nor is anything else somebody might type", isStage("Applied") === false
  && isStage("") === false && isStage(null) === false);

t("an unset stage is NOT labelled as not-answered-yet",
  () => stageLabel(null) !== STAGE_INFO.new.label);
t("and says it is unset", () => /not set/i.test(stageLabel(null)));
t("the sentence for an unset stage says nobody has said",
  () => /nobody has said/i.test(stageSays(null)));
t("and a real stage gets its own sentence",
  () => stageSays("applied") === STAGE_INFO.applied.meaning);

// A check that throws is reported like any other failure, and says so.
t("a throwing check is named, not fatal", () => { throw new Error("on purpose"); });
if (checks.pop()[0] !== "a throwing check is named, not fatal") {
  console.log("FAIL  the harness does not catch a throwing check");
  process.exit(1);
}

let failed = 0;
for (const [n, ok, note] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${n}${note ? ` (${note})` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
