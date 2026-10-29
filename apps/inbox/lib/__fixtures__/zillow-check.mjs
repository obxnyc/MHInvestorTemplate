/**
 * The answers Zillow already gave us.  Run:  node lib/__fixtures__/zillow-check.mjs
 *
 * A Zillow enquiry carries a form: move-in date, bedrooms, pets, and three
 * things we are not allowed to segment on. All of it was being thrown away
 * and the message body read as prose instead -- and the body is "I would like
 * to schedule a tour", which states nothing.
 *
 * THE FIXTURE GIVES BEDROOMS AND OCCUPANTS DIFFERENT NUMBERS, and that is the
 * point of it. The real enquiry this was built from said two bedrooms and two
 * occupants, so a reader that confused the two -- which is the exact mistake
 * that puts a familial-status fact in a column we match on -- could not be
 * caught by that message at all. Three and five can be told apart.
 *
 * The same rule put the income figure at $1,450: a number that could pass for
 * a monthly rent. A guard against "income must not become the price ceiling"
 * proves nothing if the income is $75,000 and no rent rule would ever have
 * matched it.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadTs } from "./tsload.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { readZillowForm, saysOnOneLine } = await loadTs(join(here, "..", "zillow.ts"));
const { routeEmail } = await loadTs(join(here, "..", "parse-email.ts"));
const { readWanted, mergeWanted } = await loadTs(join(here, "..", "wanted.ts"));
const { keepDeclines } = await loadTs(join(here, "..", "inquiry.ts"));

/* The notification as it reaches the parser: Zillow sends HTML only, and the
   intake route's stripper hands over this. The `&#160;` spacers are real and
   are left in on purpose -- they rode out onto the summary line. */
const BODY = `96 &#160;
&#160;

New message

1140 Northside Rd, Elizabeth City, NC, 27909 .

Marguerite Alderton says:

I would like to schedule a tour.

Reply to Marguerite

Send application

You can also reply directly to this email

About Marguerite Alderton

Move in
Nov 02, 2026

Credit score
580 to 619

Income
$1450

Pets
No

Lease Length
18 months

Number of Bedrooms
3

Number of Occupants
5

Reminder: The federal Fair Housing Act prohibits housing discrimination on the basis of race, color, national origin, sex (including sexual orientation and gender identity), familial status, disability, and religion.
Zillow&#x27;s Respectful Renting Pledge
Zillow, Inc.
1301 Second Avenue, Floor 36
Seattle, WA 98101`;

const MAIL = {
  from: "Marguerite Alderton <s8z0axqvc84kidqvrbrqerwfj@convo.zillow.com>",
  to: "larabeehomesllc@gmail.com",
  subject: "Marguerite is requesting information about 1140 Northside Rd, Elizabeth City, NC, 27909",
  messageId: "<MLPv4rrsRN6E1n_jabOiYg@geopod-ismtpd-80>",
  text: BODY,
};

const checks = [];
/** A thunk that throws is REPORTED, not fatal: a fault that removes a field a
 *  later assertion reaches into must name the check it defeated, rather than
 *  taking the run down as "the harness fell over". */
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

const form = readZillowForm(BODY);
const why = (field) =>
  (form.reading.declined.find((d) => d.field === field) ?? {}).because ?? "";

/* ---- the three it is allowed to read ---- */

t("the form is found at all", form.found === true);
t("bedrooms comes from Number of Bedrooms", form.reading.wanted.bedroomsMin === 3);
t("the move-in date is read as a date", form.reading.wanted.moveInFrom === "2026-11-02");

/* The regression this was built for. Read as prose, the income figure sitting
   on the line above the pets answer matched the pet rule on the words
   "1450 Pets" and recorded hasPets TRUE on a renter who answered No. */
t("a stated No is recorded as a stated no", form.reading.wanted.hasPets === false);
t("and reading the same notification as prose gets it WRONG, which is why",
  () => readWanted(BODY, { today: new Date(Date.UTC(2026, 9, 25)) }).wanted.hasPets === true);

t("each field says it came from the Zillow form, so it can be corrected",
  () => /Zillow enquiry form/.test(form.reading.read.bedroomsMin.from)
     && /Zillow enquiry form/.test(form.reading.read.hasPets.from));

/* ---- the ones it must refuse ---- */

t("the occupant count is NOT read as a number of bedrooms",
  form.reading.wanted.bedroomsMin !== 5);
t("and the screen is told why, naming the household",
  () => /household/i.test(why("bedroomsMin")) && /5/.test(why("bedroomsMin")));

t("the income is NOT read as a rent ceiling",
  form.reading.wanted.priceCeiling === undefined);
t("and the screen is told why, naming the income",
  () => /income/i.test(why("priceCeiling")) && /1450/.test(why("priceCeiling")));
t("the credit score is named in the same refusal",
  () => /credit score/i.test(why("priceCeiling")) && /580/.test(why("priceCeiling")));

t("nothing else is quietly stored: only the three stated fields are set",
  () => JSON.stringify(Object.keys(form.reading.wanted).sort())
     === JSON.stringify(["bedroomsMin", "hasPets", "moveInFrom"]));

/* ---- the values do not run away ---- */

const fact = (label) => (form.facts.find((f) => f.label === label) ?? {}).value;
t("a value ends at the next label", fact("Pets") === "No");
t("and so does the one before it", fact("Income") === "$1450");
t("the last value in the block does not swallow the footer",
  fact("Number of Occupants") === "5");

/* ---- the whole path ---- */

const out = routeEmail(MAIL);
t("it still routes as a Zillow prospect",
  () => out.source === "zillow" && out.category === "prospect");
t("the stated answers travel on the intake", () => out.stated.wanted.bedroomsMin === 3);
t("the summary says what they asked for",
  () => /3 bed/.test(out.summary) && /no pets/.test(out.summary));
t("the summary is not the whole block run together",
  () => !/Number of Occupants/.test(out.summary));
t("and carries no undecoded entity",
  () => !/&#\d+;|&#x[0-9a-f]+;/i.test(out.summary) && !/&#\d+;/.test(out.raw));

/* A stated answer beats the prose reading, which is the merge that matters:
   the prose says hasPets true and the form says the renter said no. */
const prose = readWanted(BODY, { today: new Date(Date.UTC(2026, 9, 25)) });
const merged = mergeWanted({ ...prose.wanted, read: prose.read }, form.reading);
t("the stated answer wins over the prose guess", merged.wanted.hasPets === false);
t("and the merged provenance is the form's",
  () => /Zillow enquiry form/.test(merged.read.hasPets.from));

/* ---- answers that are not answers ---- */

const skipped = readZillowForm(`About Someone
Move in
Not answered
Pets
Not answered
Number of Bedrooms
2`);
t("\"Not answered\" is not an answer",
  () => skipped.reading.wanted.hasPets === undefined
     && skipped.reading.wanted.moveInFrom === undefined);
t("and the question that WAS answered still reads",
  skipped.reading.wanted.bedroomsMin === 2);

/* Deleting the "Not answered" rule failed none of the checks above, because
   every field it guards is refused a second time further down: the date
   parser will not take it, the pet rule will not match it, and the bedroom
   rule gets NaN. A guard standing behind a second guard is a guard nobody has
   tested -- so these ask it where ONLY it can answer.

   A skipped question is not a fact to put on screen, and it is not something
   to build a refusal sentence out of: "Zillow passed on income Not answered"
   is a sentence nobody can act on, and it appears beside the figures that
   ARE real. */
t("a skipped question is not listed as an answer",
  () => skipped.facts.every((f) => !/not answered/i.test(f.value)));
t("and is not shown as a fact at all",
  () => skipped.facts.find((f) => f.label === "Pets") === undefined);

const unsaid = readZillowForm(`About Someone
Income
Not answered
Number of Occupants
Not answered`);
t("a skipped income builds no refusal sentence about an income",
  () => unsaid.reading.declined.every((d) => !/not answered/i.test(d.because)));
t("and a form of nothing but skipped questions is not a form",
  unsaid.found === false);

const vague = readZillowForm(`About Someone
Move in
November 2026`);
t("a month with no day is not turned into the first of the month",
  vague.reading.wanted.moveInFrom === undefined);
t("and the refusal says what Zillow actually said",
  () => /November 2026/.test(
    (vague.reading.declined.find((d) => d.field === "moveInFrom") ?? {}).because ?? ""));

t("a notification with no form block is not a fault",
  () => readZillowForm("Marguerite says:\nIs it still available?").found === false);

/* A mangled entity must not take the lead down with it. `fromCodePoint`
   throws on anything outside Unicode, and the rule in parse-email.ts is that
   a field we cannot read degrades to an unparsed thread, never to a dropped
   request. */
t("an entity that is not a character is left alone, not thrown over",
  () => {
    const out = routeEmail({ ...MAIL,
      text: `Marguerite Alderton says:\nIs it still available? &#xFFFFFFFF; &#99999999999;` });
    return out.source === "zillow" && /available/.test(out.summary);
  });

/* ---- a later message must not empty the refusals ---- */

/* The second message from a Zillow lead is a plain line of prose: "is it
   still available?" with no "About <renter>" block, so it produces NO
   refusals. Writing that over the row takes the explanation off the card and
   leaves the empty Beds box sitting under "Number of Occupants 5" in the
   thread with nothing to say why it is empty -- which is the exact mistake
   the refusal exists to prevent. */
const onFile = form.reading.declined;
t("there were refusals to keep in the first place", onFile.length >= 2);
t("a later message with none of its own does not empty them",
  () => keepDeclines(onFile, []).length === onFile.length);
t("and the sentences survive intact, not just the count",
  () => keepDeclines(onFile, []).every((d, i) => d.because === onFile[i].because));
t("the same refusal arriving twice is stored once",
  () => keepDeclines(onFile, onFile).length === onFile.length);
t("but two different reasons for the same empty box are both kept",
  () => keepDeclines(
    [{ field: "bedroomsMin", because: "Zillow says 5 occupants." }],
    [{ field: "bedroomsMin", because: "They mentioned three children." }],
  ).length === 2);
t("a row that predates the column reads as nothing refused, not a crash",
  () => keepDeclines(undefined, onFile).length === onFile.length);

/* THE WIRING, NOT ONLY THE HELPER.
   Reverting openInquiry's column to `declined: reading.declined` failed none
   of the checks above: they exercise keepDeclines directly, and nothing
   asked whether anything calls it. A guard on a helper nobody is obliged to
   use is a guard the next person walks past.

   So this is a source rule, and it is built the way this suite has learnt to
   build them. The `columns` block is CUT OUT FIRST and then matched inside,
   because an anchor that runs on past its own block matched the wrong `.eq`
   once already. Comments are stripped, because a whitelist or a phrase in a
   comment is a hole in the guard. And it does not name keepDeclines: the
   rule is that the stored value must consult the row already on file, so a
   rename moves with the code and only deleting the consultation fails. */
const inquirySrc = readFileSync(join(here, "..", "inquiry.ts"), "utf8");
const columnsBlock = (() => {
  const at = inquirySrc.indexOf("const columns = {");
  if (at < 0) return null;
  let depth = 0;
  for (let i = inquirySrc.indexOf("{", at); i < inquirySrc.length; i++) {
    if (inquirySrc[i] === "{") depth++;
    else if (inquirySrc[i] === "}" && --depth === 0) return inquirySrc.slice(at, i + 1);
  }
  return null;
})();
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

t("the columns written to the row can be found at all", columnsBlock !== null);
t("and what goes in `declined` is built from the row already on file",
  () => /declined\s*:[\s\S]*?\bhad\b/.test(bare(columnsBlock)));
t("not from this message's reading alone",
  () => !/declined\s*:\s*reading\.declined/.test(bare(columnsBlock)));

t("one line of facts, not seven",
  () => saysOnOneLine(form).length <= 4);

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
