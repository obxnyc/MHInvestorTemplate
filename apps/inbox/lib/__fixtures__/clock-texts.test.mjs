/** Texts about the clock.  Run: node lib/__fixtures__/clock-texts.test.mjs
 *
 *  The fixture is a real-shaped day in North Carolina: one man in on site,
 *  one in off site, one on lunch, one who clocked out for lunch, one who never
 *  came. Each of those is a different line in a different report, so a rule
 *  that lumps two of them together gives a different text.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const tr = (f) => ts.transpileModule(readFileSync(join(here, "..", f), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const shiftUrl = "data:text/javascript," + encodeURIComponent(tr("shift.ts"));
const js = tr("clock-texts.ts").replace(/from\s+["']\.\/shift["']/, `from "${shiftUrl}"`);
const { plan, dueKinds, localOf, DEFAULTS, GRACE } =
  await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

// Tuesday 10 November 2026. Eastern Standard Time, UTC-5.
const et = (h, m = 0, d = 10) => new Date(Date.UTC(2026, 10, d, h + 5, m)).toISOString();
const S = { ...DEFAULTS, base: "https://example.test" };

const JOSE = "jose", OFFICE = "sam";
const people = [
  { id: JOSE, name: "Jose Beltran", phone: "+19105550100", onClock: true, leadId: null, allReports: false },
  { id: OFFICE, name: "Samantha Graber", phone: "+19105550101", onClock: false, leadId: null, allReports: true },
  { id: "juan", name: "Juan Ruiz", phone: "+19105550102", onClock: true, leadId: JOSE, allReports: false },
  { id: "luis", name: "Luis Mora", phone: "+19105550103", onClock: true, leadId: JOSE, allReports: false },
  { id: "pedro", name: "Pedro Gil", phone: "+19105550104", onClock: true, leadId: JOSE, allReports: false },
  { id: "tony", name: "Tony Vega", phone: "+19105550105", onClock: true, leadId: JOSE, allReports: false },
  { id: "ana", name: "Ana Cruz", phone: "+19105550106", onClock: true, leadId: JOSE, allReports: false },
  // Not on anybody's crew, and in the programme: office sees him, Jose does not.
  { id: "ray", name: "Ray Diaz", phone: "+19105550107", onClock: true, leadId: null, allReports: false },
  // Not in the programme: nobody texts him and nobody reports on him.
  { id: "old", name: "Old Timer", phone: "+19105550108", onClock: false, leadId: JOSE, allReports: false },
  // In the programme with no phone: reported on, never texted.
  { id: "nop", name: "No Phone", phone: null, onClock: true, leadId: null, allReports: false },
];

const sh = (id, staffId, start, end, extra = {}) => ({
  id, staffId, propertyId: "p", siteName: "Lady Viola 3124", startFence: "inside",
  startedAt: start, endedAt: end, breaks: [], ...extra,
});
const shiftsAt = (h, m = 0) => {
  const now = et(h, m);
  const before = (iso) => Date.parse(iso) <= Date.parse(now);
  return [
    sh("j1", "juan", et(7, 52), null),
    sh("l1", "luis", et(8, 10), null, { siteName: null, startFence: "outside" }),
    sh("p1", "pedro", et(7, 45), null,
       { breaks: before(et(12, 5)) ? [{ startedAt: et(12, 5), endedAt: null }] : [] }),
    // Tony clocked out for lunch at noon and did not come back.
    sh("t1", "tony", et(7, 30), before(et(12)) ? et(12) : null, { siteName: "Northside 12" }),
    sh("r1", "ray", et(8), null),
  ].filter((s) => before(s.startedAt));
};
const run = (h, m = 0, sent = new Set()) => plan(new Date(et(h, m)), S, people, shiftsAt(h, m), sent);
const to = (texts, kind, id) => texts.find((x) => x.kind === kind && x.staffId === id);

/* ------------------------------------------------------------- the clock */

t("local day and time are Eastern, not UTC", () => {
  const l = localOf(new Date(et(21, 30)), "America/New_York");
  return l.day === "2026-11-10" && l.minutes === 21 * 60 + 30 && l.dow === 2;
});
t("daylight saving moves the UTC hour, not the local one", () => {
  const summer = new Date(Date.UTC(2026, 6, 14, 12, 45)); // 8:45 EDT
  return localOf(summer, "America/New_York").minutes === 8 * 60 + 45;
});
t("nothing due at 8:44", () => !dueKinds(new Date(et(8, 44)), S).includes("lead_morning"));
t("due at 8:45", () => dueKinds(new Date(et(8, 45)), S).includes("lead_morning"));
t("still due inside the grace window", () => dueKinds(new Date(et(8, 45 + GRACE - 1)), S).includes("lead_morning"));
t("not due after it: no 8:45 report at lunchtime", () =>
  !dueKinds(new Date(et(10, 15 + GRACE)), S).includes("lead_morning"));
t("nothing on Saturday by default", () => dueKinds(new Date(et(8, 50, 14)), S).length === 0);
t("a switched-off slot never fires", () =>
  !dueKinds(new Date(et(8, 50)), { ...S, at: { ...S.at, lead_morning: null } }).includes("lead_morning"));

/* ---------------------------------------------------------- the morning */

const early = run(7, 55);
t("morning reminder to someone not yet in", () => /clock in/.test(to(early, "crew_morning", "ana")?.body ?? ""));
t("no reminder to someone already in", () => !to(early, "crew_morning", "juan"));
t("never a text to someone outside the programme", () => !early.some((x) => x.staffId === "old"));
t("never a text with no number", () => !early.some((x) => x.staffId === "nop"));
t("the link is the clock", () => to(early, "crew_morning", "ana").body.includes("https://example.test/clock"));
t("first name only", () => to(early, "crew_morning", "ana").body.startsWith("Good morning Ana."));

const m845 = run(8, 45);
const jose845 = to(m845, "lead_morning", JOSE)?.body ?? "";
const sam845 = to(m845, "lead_morning", OFFICE)?.body ?? "";
t("Jose gets the 8:45 report", () => jose845.startsWith("Clock-in report 8:45 AM"));
t("who is in, at which site, from when", () => jose845.includes("• Juan Ruiz – Lady Viola 3124, 7:52 AM"));
t("an off-site clock-in says so", () => jose845.includes("Luis Mora – site not set, 8:10 AM (off site)"));
t("who is not in", () => /Not clocked in \(1\):\n• Ana Cruz/.test(jose845));
t("Jose's report is his crew only", () => !jose845.includes("Ray Diaz"));
t("not somebody outside the programme, even on his crew", () => !jose845.includes("Old Timer"));
t("the office gets everybody", () => sam845.includes("Ray Diaz") && sam845.includes("Juan Ruiz"));
t("the office's report has the link; the crew lead's does not", () =>
  sam845.includes("/timesheets") && !jose845.includes("/timesheets"));
t("someone with no crew gets no report", () => !to(m845, "lead_morning", "juan"));

/* ------------------------------------------------------------- lunch */

const l100 = run(13, 0);
t("on a break at 1: told to end it", () => /End your break/.test(to(l100, "crew_lunch", "pedro")?.body ?? ""));
t("clocked out at noon: told to clock back in", () =>
  /Clock back in/.test(to(l100, "crew_lunch", "tony")?.body ?? ""));
t("working through: no lunch text", () => !to(l100, "crew_lunch", "juan"));
t("never came: no lunch text (that is the report's job)", () => !to(l100, "crew_lunch", "ana"));

const jose115 = to(run(13, 15), "lead_lunch", JOSE)?.body ?? "";
t("1:15 lists the man on a break, with since when", () => jose115.includes("Pedro Gil – on break since 12:05 PM"));
t("1:15 lists the man who clocked out, with when", () => jose115.includes("Tony Vega – clocked out at 12:00 PM"));
t("and only those two as not back", () => jose115.includes("Not back from lunch (2):"));
t("counts who is working", () => jose115.includes("Working now: 2"));
t("names who never came at all", () => jose115.includes("Not clocked in at all today: Ana Cruz"));

/* ----------------------------------------------------------- evening */

const e = run(17, 30);
t("evening: still clocked in is told so", () => /still clocked in/.test(to(e, "crew_evening", "juan")?.body ?? ""));
t("evening: clocked out gets the day's hours", () =>
  to(e, "crew_evening", "tony")?.body.includes("today you have 4:30 at Northside 12"));
t("evening: no hours is asked about", () => /no hours on the clock/.test(to(e, "crew_evening", "ana")?.body ?? ""));

const jose9 = to(run(21, 0), "lead_recap", JOSE)?.body ?? "";
t("recap names the day", () => jose9.startsWith("Daily recap Tue, Nov 10"));
t("recap: finished hours and site", () => jose9.includes("• Tony Vega 4:30 – Northside 12"));
t("recap: an open shift is called out", () => /Juan Ruiz 0:00 – Lady Viola 3124 – STILL CLOCKED IN since 7:52 AM/.test(jose9));
t("recap: off-site clock-ins counted", () => jose9.includes("1 clock-in off site"));
t("recap: no hours said", () => jose9.includes("• Ana Cruz – no hours"));
t("recap total is finished hours only", () => jose9.includes("Total finished: 4:30"));

/* ----------------------------------------------------------- Spanish */

// Jose and Ana read Spanish; Samantha and the rest do not. The language
// follows the RECIPIENT, so the same morning gives two languages.
const es = people.map((p) => ["jose", "ana", "pedro"].includes(p.id) ? { ...p, lang: "es" } : p);
const runEs = (h, m = 0) => plan(new Date(et(h, m)), S, es, shiftsAt(h, m), new Set());
const esEarly = runEs(7, 55);
t("a Spanish reader's reminder is in Spanish", () =>
  to(esEarly, "crew_morning", "ana")?.body.startsWith("Buenos días Ana. Es hora de marcar entrada"));
t("an English reader's is still English", () =>
  to(esEarly, "crew_morning", "ana") && !runEs(7, 55).some((x) => x.staffId !== "ana" && x.staffId !== "jose" && /Buenos/.test(x.body)));
const jEs = to(runEs(8, 45), "lead_morning", JOSE)?.body ?? "";
const sEn = to(runEs(8, 45), "lead_morning", OFFICE)?.body ?? "";
t("the crew lead's report is in HIS language", () => jEs.startsWith("Reporte de entrada"));
t("the office's report of the same crew stays English", () => sEn.startsWith("Clock-in report"));
t("names and sites are never translated", () => jEs.includes("Juan Ruiz – Lady Viola 3124"));
t("site not set, translated", () => jEs.includes("sitio sin asignar") && jEs.includes("(fuera del sitio)"));
t("the lunch reminder in Spanish", () =>
  /Termina tu descanso/.test(to(runEs(13, 0), "crew_lunch", "pedro")?.body ?? ""));
t("the after-lunch report in Spanish", () =>
  /No han regresado del almuerzo \(2\)/.test(to(runEs(13, 15), "lead_lunch", JOSE)?.body ?? ""));
t("the recap in Spanish", () => /^Resumen del día/.test(to(runEs(21, 0), "lead_recap", JOSE)?.body ?? ""));
t("no English left in a Spanish report", () =>
  !/\b(clocked|Not|Working|report|since|break)\b/i.test(to(runEs(13, 15), "lead_lunch", JOSE)?.body ?? "x"));

/* ------------------------------------------------------------ once */

const first = run(8, 45);
const again = run(8, 50, new Set(first.map((x) => x.key)));
t("nothing is sent twice in a day", () => first.length > 0 && again.length === 0);
t("the key is kind, person and day", () => first[0].key.endsWith(":2026-11-10"));

const bad = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
console.log(`\n${checks.length - bad.length}/${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
