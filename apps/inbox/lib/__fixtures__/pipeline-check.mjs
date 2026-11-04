/** The leasing pipeline's arithmetic.  Run: node lib/__fixtures__/pipeline-check.mjs
 *
 *  Three pure files, and each one has a way of being confidently wrong:
 *
 *   slots.ts        -- two people sent to the same door at the same minute;
 *                      a Saturday 10am showing offered at 9 the week the
 *                      clocks change.
 *   followups.ts    -- "you haven't answered yet" to somebody who answered;
 *                      a reminder for a cancelled showing; a text at 6am.
 *   zillow-feed.ts  -- one pasted control character making the whole feed
 *                      unreadable; a Zillow email matched to the wrong home.
 *
 *  Every fixture is built so the wrong answer and the right one differ.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const load = async (name) => {
  const src = readFileSync(join(here, "..", name), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import("data:text/javascript," + encodeURIComponent(js));
};

const slots = await load("slots.ts");
const fu = await load("followups.ts");
const feed = await load("zillow-feed.ts");

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

const Z = "America/New_York";
const rules = { slotMinutes: 30, noticeMinutes: 120, horizonDays: 14, atOnce: 1 };

// ------------------------------------------------------------ slots

// Wednesday 4 Nov 2026, 9:00 Eastern (EST, -5) = 14:00Z.
const wed9 = new Date("2026-11-04T14:00:00Z");
const sat = [{ weekday: 6, starts: "10:00", ends: "12:00" }];

t("10:00 on a Saturday in November is 15:00Z (EST)", () =>
  slots.wallToUtc("2026-11-07", "10:00", Z).toISOString() === "2026-11-07T15:00:00.000Z");
t("10:00 on a Saturday in October is 14:00Z (EDT) -- the offset is the date's, not today's", () =>
  slots.wallToUtc("2026-10-31", "10:00", Z).toISOString() === "2026-10-31T14:00:00.000Z");
// The guess and the answer have to straddle the change for the second
// reading to matter: 5am on the morning the clocks go forward is guessed in
// EST and lands in EDT. 10:00 on either side of it never tests that.
t("5am the morning the clocks go forward is 09:00Z, not 10:00Z", () =>
  slots.wallToUtc("2027-03-14", "05:00", Z).toISOString() === "2027-03-14T09:00:00.000Z");
t("3am the morning the clocks go back is 08:00Z, not 07:00Z", () =>
  slots.wallToUtc("2026-11-01", "03:00", Z).toISOString() === "2026-11-01T08:00:00.000Z");
t("the morning the clocks go back, 10:00 is still 10:00 there", () =>
  slots.wallToUtc("2026-11-01", "10:00", Z).toISOString() === "2026-11-01T15:00:00.000Z");

const open1 = slots.openSlots(sat, rules, [], wed9, Z);
t("a two-hour Saturday window gives four half-hour slots each Saturday in the horizon", () =>
  open1.filter((s) => s.day === "2026-11-07").length === 4);
t("the first of them starts at 10 Eastern", () => open1[0].start === "2026-11-07T15:00:00.000Z");
t("and none ends after the window does", () =>
  open1.filter((s) => s.day === "2026-11-07").every((s) => s.end <= "2026-11-07T17:00:00.000Z"));

// A showing booked off the grid -- 10:15 to 10:45 -- overlaps 10:00 AND
// 10:30. Testing equal start times would offer both.
const busy = [{ start: "2026-11-07T15:15:00.000Z", end: "2026-11-07T15:45:00.000Z" }];
const open2 = slots.openSlots(sat, rules, busy, wed9, Z).filter((s) => s.day === "2026-11-07");
t("a showing that overlaps two slots takes both, not just the one it starts in", () =>
  open2.length === 2 && open2[0].start === "2026-11-07T16:00:00.000Z");
t("with two people showing, the same overlap leaves all four", () =>
  slots.openSlots(sat, { ...rules, atOnce: 2 }, busy, wed9, Z)
    .filter((s) => s.day === "2026-11-07").length === 4);

// Notice: at 9:00 on Saturday with two hours' notice, 10:00 and 10:30 are
// too soon, 11:00 is the first.
const sat9 = new Date("2026-11-07T14:00:00Z");
const open3 = slots.openSlots(sat, rules, [], sat9, Z).filter((s) => s.day === "2026-11-07");
t("notice is respected: at 9 with two hours' notice, 11:00 is the first slot", () =>
  open3.length === 2 && open3[0].start === "2026-11-07T16:00:00.000Z");
t("nothing is offered past the horizon", () =>
  slots.openSlots(sat, { ...rules, horizonDays: 3 }, [], wed9, Z).every((s) => s.day <= "2026-11-07"));
t("overlapping windows do not offer the same minute twice", () => {
  const two = [...sat, { weekday: 6, starts: "11:00", ends: "13:00" }];
  const got = slots.openSlots(two, rules, [], wed9, Z).filter((s) => s.day === "2026-11-07");
  return new Set(got.map((s) => s.start)).size === got.length && got.length === 6;
});
t("stillOpen finds the slot by its instant, and refuses one that is not offered", () =>
  slots.stillOpen("2026-11-07T15:00:00Z", open1) && !slots.stillOpen("2026-11-07T15:10:00Z", open1));

// ------------------------------------------------------------ follow-ups

const now = new Date("2026-11-04T15:00:00Z");
t("being invited plans two nudges and the how-did-it-end question", () => {
  const p = fu.planFor("invited", now, now).map((x) => x.kind);
  return p.join() === "invite_nudge_1,invite_nudge_2,still_looking";
});
t("a showing this afternoon gets no day-before reminder -- its moment has gone", () => {
  const start = new Date(now.getTime() + 5 * 3600_000);
  const kinds = fu.planFor("booked", start, now).map((x) => x.kind);
  return !kinds.includes("showing_day_before") && kinds.includes("showing_soon")
    && kinds.includes("after_showing");
});
t("a showing in three days gets all three", () =>
  fu.planFor("booked", new Date(now.getTime() + 3 * 864e5), now).length === 3);

const base = { stage: "invited", outcome: "open", optedOut: false };
t("a nudge to answer goes to somebody who has not answered", () =>
  fu.stillDue("invite_nudge_1", base).send === true);
t("and not to somebody who answered an hour ago", () =>
  fu.stillDue("invite_nudge_1", { ...base, stage: "prequalified" }).send === false);
t("a booking nudge stops once they have booked", () =>
  fu.stillDue("book_nudge_1", { ...base, stage: "booked" }).send === false
  && fu.stillDue("book_nudge_1", { ...base, stage: "prequalified" }).send === true);
t("a reminder for a cancelled showing does not go", () =>
  fu.stillDue("showing_soon", { ...base, stage: "booked", showingStatus: "cancelled" }).send === false);
t("a reminder for a confirmed one does", () =>
  fu.stillDue("showing_soon", { ...base, stage: "booked", showingStatus: "confirmed" }).send === true);
t("'hope you liked it' does not go to somebody marked as not coming", () =>
  fu.stillDue("after_showing", { ...base, stage: "no_show", showingStatus: "no_show" }).send === false);
t("nothing goes on a closed inquiry, whatever its kind", () =>
  ["invite_nudge_1", "book_nudge_1", "showing_soon", "after_showing", "still_looking"].every((k) =>
    fu.stillDue(k, { ...base, outcome: "bought_home", showingStatus: "booked" }).send === false));
t("nothing goes to somebody who opted out, whatever its kind", () =>
  ["invite_nudge_1", "showing_soon"].every((k) =>
    fu.stillDue(k, { ...base, optedOut: true, showingStatus: "booked" }).send === false));
t("a refusal always says why", () => {
  const r = fu.stillDue("book_nudge_1", { ...base, stage: "booked" });
  return r.send === false && /booked/.test(r.reason);
});
t("'did you find a place' is not asked of somebody with a showing coming up", () =>
  fu.stillDue("still_looking", { ...base, stage: "prequalified", hasUpcomingShowing: true }).send === false
  && fu.stillDue("still_looking", { ...base, stage: "invited" }).send === true);

// Quiet hours. 10:00Z on 4 Nov is 5am Eastern -- a once-a-day cron at that
// hour is exactly how this gets broken.
t("5am Eastern is quiet, and the next allowed moment is 8am Eastern", () => {
  const q = fu.quietUntil(new Date("2026-11-04T10:00:00Z"), Z);
  return q && q.toISOString() === "2026-11-04T13:00:00.000Z";
});
t("noon Eastern is not quiet", () => fu.quietUntil(new Date("2026-11-04T17:00:00Z"), Z) === null);
t("9:30pm Eastern is quiet", () => fu.quietUntil(new Date("2026-11-05T02:30:00Z"), Z) !== null);

t("YES confirms", () => fu.saysYes("YES") && fu.saysYes(" yes! ") && fu.saysYes("Ok."));
t("'yes but can we move it' does not", () => !fu.saysYes("yes but can we move it to 3"));
t("'Hi Dana' from 'dana smith'", () => fu.firstName("dana smith") === "Dana");
t("no 'Hi 4pbz7k' from a relay address used as a name", () =>
  fu.firstName("4pbz7k@convo.zillow.com") === null);
t("every message the pipeline sends carries its link", () => {
  const w = { first: "Dana", home: "Northside 14", prescreenUrl: "P", bookUrl: "B",
              manageUrl: "M", applyUrl: null, when: "Sat 10:00", address: "1 A St" };
  const need = { invite: "P", invite_nudge_1: "P", invite_nudge_2: "P", book_nudge_1: "B",
                 book_nudge_2: "B", booked: "M", showing_day_before: "M", showing_soon: "M",
                 after_showing: "M", no_show: "B", cancelled: "B" };
  return Object.entries(need).every(([k, link]) => fu.words(k, w).text.includes(link));
});
t("every message names the business", () => {
  const w = { first: null, home: "X", prescreenUrl: "P", bookUrl: "B", manageUrl: "M", when: "w" };
  return ["invite", "invite_nudge_1", "book_nudge_1", "booked", "showing_day_before",
          "showing_soon", "after_showing", "no_show", "cancelled", "still_looking"]
    .every((k) => /Larabee Homes/.test(fu.words(k, w).text));
});

// ------------------------------------------------------------ the feed

const good = {
  id: "u1", propertyName: "Northside", unitLabel: "14", street: "1140 Northside Rd Lot 14",
  city: "Elizabeth City", state: "NC", zip: "27909", rent: 950, deposit: 950, bedrooms: 3,
  bathrooms: 1.5, squareFeet: 1100, availableOn: "2026-12-01", headline: "3 bed <near> town & park",
  description: "A three bedroom home with a new deck.\u0007 Water included.",
  pets: "both", leaseMonths: 12, photos: ["https://x/1.jpg", "https://x/2.jpg?a=1&b=2"],
  updatedAt: "2026-11-04T00:00:00Z", kind: "MOBILE",
};
const company = { id: "c", name: "Larabee Homes", website: "https://e", contactName: "L",
                  contactEmail: "l@e", contactPhone: "" };
const xml = feed.feedXml(company, [good]);
t("a complete listing is missing nothing", () => feed.missing(good).length === 0);
t("no photo is missing something, and says what", () =>
  feed.missing({ ...good, photos: [] }).some((m) => /photo/.test(m)));
t("a four-digit ZIP is not a ZIP", () => feed.missing({ ...good, zip: "2790" }).some((m) => /ZIP/.test(m)));
t("zero bedrooms is a studio, not a missing field", () =>
  !feed.missing({ ...good, bedrooms: 0 }).some((m) => /bedroom/.test(m)));
t("ampersands and angle brackets are escaped", () =>
  xml.includes("3 bed &lt;near&gt; town &amp; park") && xml.includes("1.jpg") && xml.includes("a=1&amp;b=2"));
t("a pasted control character does not reach the XML", () => !/\u0007/.test(xml));
t("one-and-a-half baths is one full and one half", () =>
  xml.includes("<numFullBaths>1</numFullBaths>") && xml.includes("<numHalfBaths>1</numHalfBaths>"));
t("each photo is its own element, cover first", () =>
  (xml.match(/<ListingPhoto /g) ?? []).length === 2 && xml.indexOf("1.jpg") < xml.indexOf("2.jpg"));
t("the feed is one root element with the listing inside it", () =>
  xml.trim().endsWith("</hotPadsItems>") && xml.includes('<Listing id="u1" type="RENTAL"'));
t("the price is the rent, monthly", () =>
  xml.includes("<price>950</price>") && xml.includes("<pricingFrequency>MONTHLY</pricingFrequency>"));

const ours = [
  { id: "a", street: "1140 Northside Rd Lot 14", unitLabel: "14" },
  { id: "b", street: "1140 Northside Rd Lot 15", unitLabel: "15" },
  { id: "c", street: "212 Pamalee Dr", unitLabel: null },
];
t("Zillow's 'Regarding your listing at' finds the right lot", () =>
  feed.matchListing("1140 Northside Road #15, Elizabeth City, NC 27909", ours)?.id === "b");
t("the same street with no lot number is two homes, so no answer", () =>
  feed.matchListing("1140 Northside Rd, Elizabeth City, NC 27909", ours) === null);
t("a different house number on the same street is not ours", () =>
  feed.matchListing("1142 Northside Rd #14, Elizabeth City", ours) === null);
// Our 12 Elm St must not answer an email about 212 Elm St. The other way
// round (ours 212, theirs 12) never tests it: "12" does not contain "212".
t("the house number has to be the whole number -- our 12 is not their 212", () =>
  feed.matchListing("212 Elm Street, Hertford NC", [{ id: "d", street: "12 Elm St", unitLabel: null }]) === null
  && feed.matchListing("12 Elm Street, Hertford NC", [{ id: "d", street: "12 Elm St", unitLabel: null }])?.id === "d");
t("an address in parts is split into its parts", () => {
  const a = feed.splitAddress("1140 Northside Rd, Elizabeth City, NC 27909");
  return a.street === "1140 Northside Rd" && a.city === "Elizabeth City" && a.state === "NC" && a.zip === "27909";
});

// ------------------------------------------------------------ source rules

const pipeSrc = readFileSync(join(here, "..", "pipeline.ts"), "utf8");
const runDue = pipeSrc.slice(pipeSrc.indexOf("export async function runDue"),
                             pipeSrc.indexOf("export async function runDueIfFree"));
t("the runner checks quiet hours before it sends anything", () =>
  runDue.indexOf("quietUntil(") > -1 && runDue.indexOf("quietUntil(") < runDue.indexOf("deliver("));
t("the runner asks stillDue before it sends", () =>
  runDue.indexOf("stillDue(") > -1 && runDue.indexOf("stillDue(") < runDue.indexOf("deliver("));
const deliverSrc = pipeSrc.slice(pipeSrc.indexOf("async function deliver"),
                                 pipeSrc.indexOf("async function setStage"));
t("delivery asks whether they opted out, on the channel it is about to use", () =>
  /optedOut\(db, lead\.contactId, "sms"\)/.test(deliverSrc)
  && /optedOut\(db, lead\.contactId, "email"\)/.test(deliverSrc));
t("delivery writes what it sent into their conversation", () =>
  /from\("messages"\)\.insert/.test(deliverSrc));
const cancelSrc = pipeSrc.slice(pipeSrc.indexOf("export async function changeShowing"),
                                pipeSrc.indexOf("export async function confirmByText"));
t("cancelling or a no-show stands down the reminders already handed to Twilio", () =>
  /cancelHanded\(/.test(cancelSrc));
const intakeSrc = readFileSync(join(here, "..", "intake.ts"), "utf8");
t("a text to the shared line does not start the pipeline by default", () =>
  /PIPELINE_AUTO_START \?\? "zillow,website"/.test(intakeSrc));

const vercel = JSON.parse(readFileSync(join(here, "..", "..", "vercel.json"), "utf8"));
const fcron = vercel.crons.find((c) => c.path === "/api/cron/followups");
t("the follow-up cron runs inside quiet hours' open window (8am-9pm Eastern, either offset)", () => {
  const [, hour] = fcron.schedule.split(/\s+/).map(Number);
  return hour - 5 >= 8 && hour - 4 < 21;
});

let bad = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` (${why})` : ""}`);
  if (!ok) bad++;
}
console.log(`\n${checks.length - bad}/${checks.length} passed`);
process.exit(bad ? 1 : 0);
