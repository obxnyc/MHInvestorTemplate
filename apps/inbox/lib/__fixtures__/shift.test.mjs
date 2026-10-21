/** A day on the clock.  Run:  node lib/__fixtures__/shift.test.mjs
 *
 *  These are somebody's wages. So the checks are weighted towards the ways a
 *  total can be wrong in the employer's favour -- a break deducted that
 *  nobody took, a running shift counted as worked, an abandoned one closed at
 *  a guess -- because those are the ones nobody complains about until a
 *  solicitor does.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "shift.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { worked, nudges, shiftHours, breakMinutesOf, byProperty, dayOf,
        weekStart, week, WEEK_STARTS_ON, RULES } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

const at = (h, m = 0) => `2026-10-21T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
const NOW = new Date(at(17));
const shift = (o) => ({ id: "s", staffId: "w", propertyId: null,
                        startedAt: at(7), endedAt: null, breaks: [], ...o });
const has = (list, key) => list.some((n) => n.key === key);

// ---- the plain day ----
t("seven to three is eight hours",
  () => shiftHours(shift({ endedAt: at(15) })) === 8);
t("a day of one finished shift totals it",
  () => worked([shift({ endedAt: at(15) })], NOW).hours === 8);
t("and nothing is running", () => worked([shift({ endedAt: at(15) })], NOW).running === 0);
t("two shifts add up",
  () => worked([shift({ id: "a", startedAt: at(7), endedAt: at(11) }),
                shift({ id: "b", startedAt: at(12), endedAt: at(15) })], NOW).hours === 7);

// ---- a break nobody took is not deducted ----
// The tempting shortcut is to dock half an hour off any long shift. That is
// deducting pay for something there is no evidence of.
t("a long shift with no break recorded loses nothing",
  () => shiftHours(shift({ startedAt: at(7), endedAt: at(16) })) === 9);
t("a break that was taken comes off",
  () => shiftHours(shift({ startedAt: at(7), endedAt: at(16),
    breaks: [{ startedAt: at(12), endedAt: at(12, 30) }] })) === 8.5);
// A break somebody started and never ended has no measured length, and
// guessing one docks pay for a guess.
t("a break with no end is not deducted",
  () => shiftHours(shift({ startedAt: at(7), endedAt: at(16),
    breaks: [{ startedAt: at(12), endedAt: null }] })) === 9);
t("and it is not counted as minutes taken either",
  () => breakMinutesOf(shift({ breaks: [{ startedAt: at(12), endedAt: null }] })) === 0);
t("two breaks both come off",
  () => shiftHours(shift({ startedAt: at(7), endedAt: at(16), breaks: [
    { startedAt: at(10), endedAt: at(10, 15) },
    { startedAt: at(12), endedAt: at(12, 30) }] })) === 8.25);

// ---- a shift still running is not hours worked ----
// "Six hours so far" and "six hours worked" are different claims, and only
// one of them can be signed off.
const open = worked([shift({ startedAt: at(11) })], NOW);
t("an open shift adds nothing to worked hours", () => open.hours === 0);
t("it accumulates separately", () => open.running === 6);
t("and the day knows somebody is on the clock", () => open.onTheClock === true);
t("a finished shift beside an open one keeps the two apart", () => {
  const w = worked([shift({ id: "a", startedAt: at(7), endedAt: at(11) }),
                    shift({ id: "b", startedAt: at(12) })], NOW);
  return w.hours === 4 && w.running === 5;
});
t("shiftHours says null rather than nought for a running shift",
  () => shiftHours(shift({})) === null);

// ---- a shift nobody closed ----
// Closing it at a guess invents an end time; leaving it open adds sixteen
// hours to the day. It is neither.
const forgot = worked([shift({ startedAt: "2026-10-20T06:00:00Z" })], NOW);
t("a shift open since yesterday is abandoned", () => forgot.abandoned.length === 1);
t("it adds no hours", () => forgot.hours === 0);
t("and no running hours either", () => forgot.running === 0);
t("but it is still somebody on the clock", () => forgot.onTheClock === true);
t("a shift open six hours is not abandoned",
  () => worked([shift({ startedAt: at(11) })], NOW).abandoned.length === 0);
t("the abandoned threshold is the one the screen uses", () => RULES.abandonedAfter === 14);
t("an abandoned shift is said out loud, and urgently", () => {
  const n = nudges(forgot, [shift({ startedAt: "2026-10-20T06:00:00Z" })], NOW);
  return has(n, "left-open") && n.find((x) => x.key === "left-open").urgent === true;
});

// ---- the break nudge ----
// About the stretch they are ON, not the day's total: six hours in one go
// needs lunch, and six hours split across morning and afternoon does not
// mean anybody missed it.
const straight = [shift({ startedAt: at(7), endedAt: at(14) })];
t("seven hours in one stretch with no break is a nudge",
  () => has(nudges(worked(straight, NOW), straight, NOW), "break"));
const split = [shift({ id: "a", startedAt: at(7), endedAt: at(10) }),
               shift({ id: "b", startedAt: at(11), endedAt: at(15) })];
t("the same seven hours in two stretches is not",
  () => !has(nudges(worked(split, NOW), split, NOW), "break"));
const took = [shift({ startedAt: at(7), endedAt: at(14),
                      breaks: [{ startedAt: at(11), endedAt: at(11, 30) }] })];
t("a long stretch with a proper break is not nudged",
  () => !has(nudges(worked(took, NOW), took, NOW), "break"));
const sip = [shift({ startedAt: at(7), endedAt: at(14),
                     breaks: [{ startedAt: at(11), endedAt: at(11, 10) }] })];
t("ten minutes is not the break they are owed",
  () => has(nudges(worked(sip, NOW), sip, NOW), "break"));
// A man who is still out there and past six hours needs telling NOW, not at
// the end of the day when it is too late to do anything about it.
const stillOut = [shift({ startedAt: at(7) })];
t("a running stretch past six hours is nudged while it is still running",
  () => has(nudges(worked(stillOut, NOW), stillOut, NOW), "break"));

// ---- the cap ----
// Telling somebody after they have gone past it is no use.
const long = [shift({ startedAt: at(6) })];                 // 11 hours running
t("the cap counts running time, not only finished time",
  () => has(nudges(worked(long, NOW), long, NOW), "cap"));
t("and it is urgent",
  () => nudges(worked(long, NOW), long, NOW).find((n) => n.key === "cap").urgent === true);
const fine = [shift({ startedAt: at(9), endedAt: at(15) })];
t("a six hour day is not capped",
  () => !has(nudges(worked(fine, NOW), fine, NOW), "cap"));
const exact = [shift({ startedAt: at(7), endedAt: at(17) })];
t("exactly the cap is the cap",
  () => has(nudges(worked(exact, NOW), exact, NOW), "cap"));

// ---- the sign-off ----
t("a finished unsigned day asks to be signed off",
  () => has(nudges(worked(fine, NOW), fine, NOW), "sign-off"));
// A day with nothing finished in it has nothing to sign off whatever the
// rule says, so `stillOut` alone cannot tell the two readings apart -- it
// passed with the on-the-clock test deleted. The case that asks the question
// is a finished stretch AND a running one, which is every man who clocked
// out at lunch and came back.
const backOn = [shift({ id: "a", startedAt: at(7), endedAt: at(12) }),
                shift({ id: "b", startedAt: at(13) })];
t("nothing is asked to be signed off while somebody is still on the clock",
  () => !has(nudges(worked(backOn, NOW), backOn, NOW), "sign-off"));
t("and the finished stretch is there to be signed off once they stop", () => {
  const done = [backOn[0], { ...backOn[1], endedAt: at(16) }];
  return has(nudges(worked(done, NOW), done, NOW), "sign-off");
});
const signed = [shift({ startedAt: at(9), endedAt: at(15), signedOffAt: at(15, 5) })];
t("a day already signed off is not asked again",
  () => !has(nudges(worked(signed, NOW), signed, NOW), "sign-off"));
t("no shifts at all says nothing", () => nudges(worked([], NOW), [], NOW).length === 0);

// ---- which property the hours go against ----
const mixed = [
  shift({ id: "a", propertyId: "p1", startedAt: at(7), endedAt: at(11) }),
  shift({ id: "b", propertyId: "p2", startedAt: at(11), endedAt: at(14) }),
  shift({ id: "c", propertyId: "p1", startedAt: at(14), endedAt: at(15) }),
  shift({ id: "d", propertyId: null, startedAt: at(15), endedAt: at(16) }),
  shift({ id: "e", propertyId: "p1", startedAt: at(16) }),          // running
];
t("hours land on the property they were worked at",
  () => byProperty(mixed).tagged.p1 === 5 && byProperty(mixed).tagged.p2 === 3);
// Labour filed against the wrong house is worse than labour filed against
// none, so an untagged hour is kept out and counted on its own.
t("an untagged hour is not spread across the others",
  () => byProperty(mixed).untagged === 1);
t("a running shift is not attributed to anything yet",
  () => byProperty(mixed).tagged.p1 === 5);

// ---- the day a shift belongs to ----
t("a shift that runs past midnight belongs to the day it started", () =>
  dayOf(shift({ startedAt: "2026-10-21T22:00:00Z", endedAt: "2026-10-22T02:00:00Z" }))
  === "2026-10-21");

// ---- rubbish in ----
t("an end before the start is nought, not a negative",
  () => shiftHours(shift({ startedAt: at(15), endedAt: at(7) })) === 0);
// A date that will not parse makes every arithmetic step NaN, and NaN hours
// go into a wage figure looking like a blank rather than like an error. The
// zero-or-less test is what stops it: Math.max(0, NaN) is NaN.
t("a shift with an unparseable end is nought hours, not NaN",
  () => shiftHours(shift({ startedAt: at(7), endedAt: "sometime tuesday" })) === 0);
t("and a day holding one still totals a real number",
  () => worked([shift({ startedAt: at(7), endedAt: "sometime tuesday" })], NOW).hours === 0);
t("a break longer than the shift does not go negative",
  () => shiftHours(shift({ startedAt: at(9), endedAt: at(10),
    breaks: [{ startedAt: at(9), endedAt: at(14) }] })) === 0);

/* ------------------------------------------------------------------ the week
 * A timesheet is reviewed by the week, and the week is what payroll asks for.
 */
// 21 October 2026 is a Wednesday. In Eastern Daylight Time the offset is 240
// minutes -- what getTimezoneOffset() gives, minutes to subtract from UTC.
const ET = 240;
const wk = (shifts, start, o = {}) =>
  week(shifts, start, NOW, { offsetMinutes: ET, ...o });

t("the week starts on Monday", () => WEEK_STARTS_ON === 1);
t("a Wednesday belongs to its Monday",
  () => weekStart(new Date("2026-10-21T12:00:00Z"), ET) === "2026-10-19");
t("a Monday is its own week start",
  () => weekStart(new Date("2026-10-19T12:00:00Z"), ET) === "2026-10-19");
// The plain subtraction goes negative on Sunday, which is why the +7 is there.
t("a Sunday belongs to the Monday before it, not the one after",
  () => weekStart(new Date("2026-10-25T12:00:00Z"), ET) === "2026-10-19");

// A week built from the shifts that exist shows four rows and reads as four
// days worked. The days off have to be there, empty, or the shape of the
// week is a guess.
t("a week is always seven days", () => wk([], "2026-10-19").days.length === 7);
t("even with nothing in it", () => wk([], "2026-10-19").hours === 0);
t("and they run Monday to Sunday", () => {
  const d = wk([], "2026-10-19").days.map((x) => x.day);
  return d[0] === "2026-10-19" && d[6] === "2026-10-25";
});

const WEEK = [
  // Monday, 7am-3pm Eastern = 11:00-19:00 UTC
  shift({ id: "m", startedAt: "2026-10-19T11:00:00Z", endedAt: "2026-10-19T19:00:00Z",
          signedOffAt: "2026-10-19T19:05:00Z" }),
  // Tuesday, 7am-12pm, not signed off
  shift({ id: "t", startedAt: "2026-10-20T11:00:00Z", endedAt: "2026-10-20T16:00:00Z" }),
  // Tuesday again, 1pm-4pm, with a break
  shift({ id: "t2", startedAt: "2026-10-20T17:00:00Z", endedAt: "2026-10-20T20:00:00Z",
          breaks: [{ startedAt: "2026-10-20T18:00:00Z", endedAt: "2026-10-20T18:30:00Z" }] }),
];
const W = wk(WEEK, "2026-10-19");
t("the week adds up", () => W.hours === 15.5);
t("Monday has its eight", () => W.days[0].hours === 8);
t("Tuesday has both of its stretches", () => W.days[1].hours === 7.5);
t("and both of its shifts", () => W.days[1].shifts.length === 2);
t("Wednesday is empty and still there", () => W.days[2].hours === 0);
t("the break minutes are the week's", () => W.breakMinutes === 30);

// Signed off is about the day, and a day nobody worked is not a day somebody
// agreed -- `every` on an empty list is true, which would mark every day off
// as signed and make the count meaningless.
t("a day whose shifts are all agreed is signed off", () => W.days[0].signedOff === true);
t("a day with an unagreed shift is not", () => W.days[1].signedOff === false);
t("a day nobody worked is not 'signed off'", () => W.days[2].signedOff === false);
t("the week counts what is left to agree", () => W.toSign === 2);

// A shift that runs past midnight belongs to the day it started, which is
// the same rule the day view uses and the one a week can quietly break.
const LATE = [shift({ id: "n", startedAt: "2026-10-20T02:00:00Z",      // 10pm Mon ET
                      endedAt: "2026-10-20T06:00:00Z" })];             // 2am Tue ET
const L = wk(LATE, "2026-10-19");
t("a night shift is filed on the evening it began", () => L.days[0].hours === 4);
t("and not on the morning it ended", () => L.days[1].hours === 0);

// The offset is the whole reason the local day is knowable, so it has to
// change the answer. The same shift read in UTC lands on a different day.
const U = week(LATE, "2026-10-19", NOW, { offsetMinutes: 0 });
t("read in UTC the same shift lands on the Tuesday", () => U.days[1].hours === 4);
t("which is the point of passing an offset at all", () => L.days[0].hours !== U.days[0].hours);

// Running time is kept out of the week's worked total for the same reason it
// is kept out of the day's: it is not hours worked until it stops.
const RUN = [shift({ id: "r", startedAt: at(13) })];
const R = wk(RUN, "2026-10-19");
t("a running shift is not in the week's hours", () => R.hours === 0);
t("it is in the week's running total", () => R.running === 4);
t("and the day it is running on knows it", () => R.days[2].running === 4);
// Nothing still running can be agreed, because the number is still moving --
// and the week with no running shift in it cannot tell the two readings
// apart, so it has to be asked here.
t("a shift still running is not waiting to be agreed", () => R.toSign === 0);
t("and once it stops it is",
  () => wk([{ ...RUN[0], endedAt: at(16) }], "2026-10-19").toSign === 1);

t("a week outside the shifts' range is empty, not a throw",
  () => wk(WEEK, "2025-01-06").hours === 0);

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
