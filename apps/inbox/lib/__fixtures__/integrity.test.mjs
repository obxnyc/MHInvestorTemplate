/** Which clock-ins the owner is told about.  Run: node lib/__fixtures__/integrity.test.mjs
 *
 *  One case per reason, each where only that rule can answer: a man on the
 *  job on his own phone (nothing), on a buddy's phone at the job (only the
 *  phone), on his own phone far away (only the distance), a brand-new phone
 *  (only that), and no position at all (only that).
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(readFileSync(join(here, "..", "integrity.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { reasons, alertText, forgotText } = await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

const base = { name: "Pedro Gil", site: "Lady Viola 3124", farMetres: null, noFix: false, photos: 0,
               phoneUsedBy: [], newPhone: false };
const L = "https://app.larabeehomesllc.com/trail?staff=x";

t("on the job, own phone: nothing to look at", () => reasons(base).length === 0 && alertText(base, "7:55 AM", L) === null);
t("on a buddy's phone at the job: the phone, and only that",
  () => reasons({ ...base, phoneUsedBy: ["Juan Ruiz"] }).join() === "buddy-phone");
t("says whose phone", () => alertText({ ...base, phoneUsedBy: ["Juan Ruiz"] }, "7:55 AM", L)
  === `Check: Pedro Gil clocked in at Lady Viola 3124, 7:55 AM, on the same phone Juan Ruiz uses. ${L}`);
t("far away on his own phone: the distance, and only that",
  () => reasons({ ...base, farMetres: 6760 }).join() === "far");
t("says how far", () => alertText({ ...base, farMetres: 6760 }, "7:55 AM", L).includes("4.2 mi from the job"));
t("a new phone, otherwise fine: that, and only that", () => reasons({ ...base, newPhone: true }).join() === "new-phone");
t("a buddy's phone is not ALSO called a new phone",
  () => reasons({ ...base, phoneUsedBy: ["Juan Ruiz"], newPhone: true }).join() === "buddy-phone");
t("no position: that", () => reasons({ ...base, noFix: true }).join() === "nofix");
t("no position with photos says photos were taken",
  () => alertText({ ...base, noFix: true, photos: 2 }, "7:55 AM", L).includes("with no location (photos taken)"));
t("no position is not also 'far'", () => reasons({ ...base, noFix: true, farMetres: 9000 }).join() === "nofix");
t("two reasons in one text", () => alertText({ ...base, phoneUsedBy: ["Juan Ruiz"], farMetres: 6760 }, "7:55 AM", L)
  .includes("on the same phone Juan Ruiz uses and 4.2 mi from the job"));
t("no job chosen says so", () => alertText({ ...base, site: null, noFix: true }, "7:55 AM", L).includes("at no job chosen"));
t("forgot to clock out", () => forgotText("Pedro Gil", "6:00 PM", L)
  === `Check: Pedro Gil did not clock out; the clock closed his shift at 6:00 PM. ${L}`);

const bad = checks.filter(([, ok]) => !ok);
for (const [name, ok, why] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
console.log(`\n${checks.length - bad.length}/${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
