/**
 * Reading a Rent Manager service issue, whatever this account calls things.
 *
 * Tenants submit maintenance requests in Tenant Web Access. Rent Manager
 * records each one and emails a notification, and this app was built to
 * catch that email -- but the email only arrives if a Gmail filter forwards
 * it and a webhook reaches here, and a request can fall down silently at
 * either. The issue itself never falls down: it is in Rent Manager. So the
 * app asks for it instead.
 *
 *     node lib/__fixtures__/issues-check.mjs
 *
 * WHAT THIS CANNOT CHECK: whether these are the field names Rent Manager
 * actually uses. This account is on Express, the docs are not reachable from
 * here, and there are no credentials on this machine -- the probe can see
 * that /ServiceManagerIssues answers but not what it calls things. So the
 * reader tries several spellings and REPORTS which one answered, and the
 * preview button on the Rent Manager page is what settles it. What this
 * checks is that the reader copes with every shape it might meet, and that
 * nothing it produces can duplicate a request or lose one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(here, "rm-issues.ts"), "utf8")
  // The module's own imports pull in Supabase; the reading is pure and is
  // what this is about.
  .replace(/^import .*$/gm, "")
  .replace(/export async function pullServiceIssues[\s\S]*$/m, "");
writeFileSync(join(here, "rm-issues.gen.mjs"), ts.transpileModule(src,
  { compilerOptions: { target: 99, module: 99 } }).outputText);
const { readIssue, summarise, detail } = await import(join(here, "rm-issues.gen.mjs"));

const checks = [];
const t = (name, ok, why) => checks.push([name, ok, why]);

// --- the shape rmAPI documents: embedded records -----------------------
{
  const readAs = {};
  const i = readIssue({
    ServiceManagerIssueID: 4412,
    Summary: "Kitchen sink faucet leaking",
    Description: "Kitchen sink leaking from riser",
    CreateDate: "2026-10-09T14:21:00",
    Property: { Name: "1140 Northside Rd" },
    Unit: { Name: "51" },
    Tenant: {
      Name: "Miller, Winston",
      Email: "winston@example.com",
      PhoneNumbers: [{ PhoneNumber: "(386) 983-1466" }],
    },
    ServiceManagerStatus: { Name: "New" },
    ServiceManagerPriority: { Name: "High" },
    ServiceManagerCategory: { Name: "Plumbing" },
  }, readAs);

  t("the issue id comes through", i.id === "4412");
  t("the title comes through", i.title === "Kitchen sink faucet leaking");
  t("an embedded property reads as its name", i.property === "1140 Northside Rd");
  t("an embedded unit reads as its number", i.unit === "51");
  t("an embedded tenant reads as their name", i.tenant === "Miller, Winston");
  t("the phone comes off the embedded tenant", i.phone === "(386) 983-1466",
    `got ${i.phone}`);
  t("and the email too", i.email === "winston@example.com");
  t("status, priority and category read as their names",
    i.status === "New" && i.priority === "High" && i.category === "Plumbing");
  t("and it reports which spelling answered",
    readAs.id === "ServiceManagerIssueID" && readAs.title === "Summary",
    JSON.stringify(readAs));
}

// --- the shape with no embeds: flat, differently spelled ---------------
{
  const readAs = {};
  const i = readIssue({
    IssueID: 7,
    Title: "No hot water",
    Details: "Been out since Tuesday",
    PropertyName: "The Retreat",
    UnitNumber: 12,
    TenantName: "Prieto, Alex",
    Phone: "252-642-2995",
    StatusName: "Open",
    DateCreated: "2026-10-11",
  }, readAs);
  t("a flat record reads just as well",
    i.id === "7" && i.title === "No hot water" && i.property === "The Retreat");
  t("a numeric unit is still a unit", i.unit === "12",
    "Lot 12 arriving as the number 12 must not read as nothing.");
  t("a phone off the record itself is found", i.phone === "252-642-2995");
  t("and the spellings it used are reported",
    readAs.title === "Title" && readAs.unit === "UnitNumber",
    JSON.stringify(readAs));
}

// --- what it does with a record it does not understand -----------------
{
  const i = readIssue({ SomethingElse: 1 });
  t("an unrecognisable record yields no id", i.id === "");
  t("and nothing invented in its place",
    i.title === null && i.tenant === null && i.unit === null,
    "A request with a made-up description is worse than one that is "
    + "obviously unread.");
}
{
  // An empty field is not an answer. `text()` already nulls the VALUE, so
  // the thing that actually goes wrong without the empty-string guard in
  // `pick` is the map: it reports that `Summary` answered for the title
  // when Summary was blank -- and the map is the whole diagnosis when a
  // field comes back missing and nobody knows what this account calls it.
  const readAs = {};
  const i = readIssue({ ID: 9, Summary: "", Description: "it leaks" }, readAs);
  t("an empty title falls through to the description",
    i.title === null && i.description === "it leaks");
  t("and an empty field is not reported as the one that answered",
    readAs.title === undefined,
    `the map claims the title came from ${readAs.title}, which was empty`);
}

// --- how it reads in the inbox -----------------------------------------
{
  const i = readIssue({
    ID: 1, Summary: "Roof leak", Property: { Name: "1140 Northside Rd" },
    Unit: { Name: "51" }, Tenant: { Name: "Miller, Winston" },
  });
  t("the summary says where before what",
    summarise(i) === "1140 Northside Rd Lot 51 — Roof leak", summarise(i));
  const body = detail(i);
  t("the body carries the tenant", /Tenant: Miller, Winston/.test(body));
  t("and says where it came from",
    /From Rent Manager Service Manager, issue 1\./.test(body),
    "Somebody reading it in the inbox needs to know it is not a text "
    + "message and where to go to close it.");
  const bare = summarise(readIssue({ ID: 2 }));
  t("an issue with nothing on it still says something",
    bare === "Maintenance request", bare);
}

// --- the rules that stop it duplicating or losing anything -------------
const mod = readFileSync(join(here, "rm-issues.ts"), "utf8");
const route = readFileSync(
  join(here, "..", "app", "api", "rentmanager", "issues", "route.ts"), "utf8");

t("every issue carries a stable external id",
  /externalId: `rm:issue:\$\{issue\.id\}`/.test(mod),
  "This is what makes running it twice safe: ingest refuses an external id "
  + "it has seen.");

t("and it is filed under the same source as the email path",
  /source: "zego"/.test(mod),
  "An issue that arrives both ways has to be one thread, not two.");

t("and as maintenance, not as a guess",
  /category: "maintenance"/.test(mod),
  "It is a maintenance request by construction. Classifying it would be "
  + "inventing doubt.");

t("the pull is a rehearsal unless told otherwise",
  /const dryRun = opts\.dryRun !== false;/.test(mod)
  && /dryRun: go !== true/.test(route),
  "The first run of something that writes to the inbox should be readable "
  + "before it is believed.");

t("an id-less record is dropped rather than filed",
  /\.filter\(\(i\) => i\.id\)/.test(mod),
  "Without an id there is no external id, and without that every run "
  + "files it again.");

t("the embeds are retried without them if refused",
  /await rows\(session, "\/ServiceManagerIssues"\);/.test(mod),
  "A request with no tenant name on it still beats not knowing it exists.");

t("the route is admin only",
  /me\?\.role !== "admin"/.test(route));

t("the shape it saw is reported back",
  /shape: raw\[0\] \? Object\.keys\(raw\[0\]\) : null/.test(mod),
  "The field names are a hypothesis. The preview has to say what actually "
  + "came back, or the next guess is as blind as the first.");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : "\nnothing obviously wrong");
process.exit(failed ? 1 : 0);
