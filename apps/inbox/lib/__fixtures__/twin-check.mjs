/**
 * One broken fridge, two arrivals.
 *
 * The owner's own two screenshots, side by side: Rent Manager emails the
 * issue at 7:41 with "Tenant: Contouris, Brennan", "Number: (757)
 * 894-2924" and "114 Lisas Way" in the subject -- and the hourly pull
 * finds the same issue as number 307 with Category, Priority and Status
 * all `<Unassigned>` and no tenant at all. Two threads for one fridge,
 * and the empty one is the one on screen.
 *
 *     node lib/__fixtures__/twin-check.mjs
 *
 * What makes this worth care is the other direction: joining two
 * DIFFERENT households' problems because both said "no heat" would be
 * far worse than two threads for one.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const tmp = join(here, ".tmp-twin");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, "sameissue.mjs"),
  ts.transpileModule(read("lib/sameissue.ts"), { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const { twinFragment, describedAs, titledAs, ENOUGH } =
  await import(pathToFileURL(join(tmp, "sameissue.mjs")).href);
rmSync(tmp, { recursive: true, force: true });

const intake = bare(read("lib/intake.ts"));

const results = [];
const t = (name, run) => {
  let ok = false, why = null;
  try { ok = run() === true; } catch (e) { why = String(e && e.message || e); }
  results.push([name, ok, why]);
};

/* THE TWO REAL ARRIVALS, word for word from the owner's screenshots. */
const EMAIL = [
  "The following issue was submitted via TWA:",
  "Issue Title: Fridge is going out",
  "Description: My fridge is leaking water from the top into the fridge into the bottom drawers. The seals are all ripping and the door won't close correctly.",
  "Assigned To:",
  "",
  "Tenant: Contouris, Brennan",
  "Number: (757) 894-2924",
].join("\n");

const PULLED = [
  "Issue: Fridge is going out",
  "Description: My fridge is leaking water from the top into the fridge into the bottom drawers. The seals are all ripping and the door won't close correctly.",
  "Category: <Unassigned>",
  "Priority: <Unassigned>",
  "Status: <Unassigned>",
  "Submitted: 2026-10-28T07:41:23",
  "",
  "From Rent Manager Service Manager, issue 307.",
].join("\n");

t("the tenant's own words are read out of the email",
  () => /leaking water from the top/.test(describedAs(EMAIL) ?? ""));
t("and out of the pulled one, which labels them differently",
  () => /leaking water from the top/.test(describedAs(PULLED) ?? ""));
t("the two are the same words", () => describedAs(EMAIL) === describedAs(PULLED));
t("the title is read from either", () => titledAs(EMAIL) === "Fridge is going out"
  && titledAs(PULLED) === "Fridge is going out");
t("so the one finds the other", () => {
  const f = twinFragment(EMAIL);
  if (!f) throw new Error("no fragment to look for");
  return PULLED.includes(f);
});

// ---- and must not join what is not the same ---------------------------

/* "HEAT" AND "FURNACE" ARE BOTH REAL TITLES HERE, and "no heat" is a
   sentence a dozen households write in a week. A short description is
   refused rather than matched -- joining two houses' problems into one
   thread is far worse than two threads for one problem. */
t("a description too short to be anybody's in particular is refused",
  () => twinFragment("Issue: Heat\nDescription: no heat") === null);
t("the floor is stated rather than a number in the code", () => ENOUGH >= 30);
/* TWO HOUSEHOLDS, SAME COMPLAINT, DIFFERENT WORDS -- and they have to
   share MORE than the fragment is short, or the pair cannot tell one
   fragment length from another. These agree for the first fifty-odd
   characters and part after that, so a fragment cut at forty would join
   two houses and one cut at eighty does not. The first attempt had them
   differing at character thirty-one, which proved nothing. */
const SHARED = "The heat is not working properly in the back of the house";
const A = `Issue: Heat\nDescription: ${SHARED} and it has been cold since`
  + " Tuesday night.";
const B = `Issue: Heat\nDescription: ${SHARED} and the thermostat is blank.`;
t("the fixture pair really does share an opening",
  () => SHARED.length > 50 && A !== B);
t("two households who both wrote at length are not joined", () => {
  const f = twinFragment(A);
  if (!f) throw new Error("the first was refused, so this proves nothing");
  return !B.includes(f);
});
t("and a fragment is not a pattern", () => {
  /* `%` and `_` are wildcards in a LIKE. A description carrying one would
     match half the table. */
  const wild = "Issue: Rent\nDescription: They are asking for 100% of the "
    + "deposit back and will not say why, which is the whole problem here.";
  return twinFragment(wild) === null;
});
t("something with no description at all is refused",
  () => twinFragment("Issue: Fridge is going out") === null);

// ---- what ingest does with it -----------------------------------------

t("the twin is only looked for on maintenance",
  () => /item\.category === "maintenance" \? twinFragment/.test(intake));
t("it is looked for before a new thread is opened", () => {
  const looked = intake.indexOf("twinFragment(item.raw");
  const opened = intake.indexOf('.from("conversations").insert');
  return looked >= 0 && (opened < 0 || looked < opened);
});
/* THE SECOND ARRIVAL IS RECORDED, not dropped. Dropping it means the
   pull finds it new every hour for ever. */
t("the second arrival is written onto the thread that already exists", () => {
  const at = intake.indexOf("if (seen?.conversation_id)");
  if (at < 0) throw new Error("nothing joins them");
  const body = intake.slice(at, at + 600);
  return /external_id: item\.externalId/.test(body)
    && /conversation_id: seen\.conversation_id/.test(body);
});
/* AND ONLY WITHIN A WINDOW. The same tenant reports the same broken
   fridge again in March, and that is a new request. */
t("and only against something recent", () => /30 \* 864e5/.test(intake));
t("matched on what came IN, not on anything we sent",
  () => /\.eq\("direction", "inbound"\)/.test(intake));

// ---- clearing up the ones already here --------------------------------

const twins = bare(read("app/api/rentmanager/twins/route.ts"));
const screen = bare(read("components/TwinThreads.tsx"));

/* CLOSED, NOT DELETED. A thread somebody might have written on is not a
   thing to remove because a rule decided it was redundant. */
t("the empty one is closed rather than deleted",
  () => /status: "closed"/.test(twins) && !/\.delete\(\)/.test(twins));
/* AND NOT IF ANYBODY ANSWERED IT. At that point it is a conversation,
   whatever it started as. */
t("a thread somebody has replied on is left alone", () => {
  const at = twins.indexOf('.eq("direction", "outbound")');
  if (at < 0) throw new Error("it never asks whether anybody replied");
  const closed = twins.indexOf('status: "closed"');
  return at < closed;
});
/* THE RIGHT HALF IS KEPT. The pulled one says so in its own last line;
   keeping that and closing the email would throw away the tenant, the
   number and the address, which is the whole point of the exercise. */
t("the one with nothing on it is the one identified", () => {
  const at = twins.indexOf("const isPulled");
  return at >= 0 && /From Rent Manager Service Manager/.test(twins.slice(at, at + 200));
});
t("and a thread is never matched against itself",
  () => /m\.conversation_id !== one\.conversation_id/.test(twins));
/* NOTHING HAPPENS UNTIL ASKED, and what is acted on is what was listed.
   A sweep that decides for itself is a sweep nobody can check first. */
t("reading the list changes nothing",
  () => { const at = twins.indexOf("export async function GET");
          const body = twins.slice(at, twins.indexOf("export async function POST"));
          return !/\.update\(/.test(body) && !/\.delete\(/.test(body); });
t("and closing acts only on the ids it was handed",
  () => /body\?\.ids/.test(twins) && /\.eq\("id", id\)/.test(twins));
t("the screen says how many were closed AND how many were not",
  () => /out\.closed/.test(screen) && /out\.kept/.test(screen));

let bad = 0;
for (const [name, ok, why] of results) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${results.length}`); process.exit(1); }
console.log("one request arriving twice is one thread, and two requests are two");
