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

// --- the shape THIS account actually returns ---------------------------
//
// Not a guess. These are the field names the deep probe got back from
// larabee.api.rentmanager.com, and the three embeds that answered: the
// six I guessed first all returned 404, which asked as one list would
// have failed the whole request and fallen back to bare records.
{
  const readAs = {};
  const i = readIssue({
    ServiceManagerIssueID: 4412,
    Title: "Kitchen sink faucet leaking",
    Description: "Dispatched to Alex",
    CustomerDescription: "Kitchen sink leaking from riser",
    Resolution: null,
    IsClosed: false,
    CloseDate: null,
    IsCustomerInitiated: true,
    NoteText: "",
    CreateDate: "2026-10-09T14:21:00",
    CreateWebUserID: 881,
    IsAllowedToEnter: true,
    Age: 3,
    Category: { ServiceManagerCategoryID: 2, Name: "Plumbing" },
    Status: { ServiceManagerStatusID: 1, Name: "New" },
    Priority: { ServiceManagerPriorityID: 3, Name: "High" },
  }, readAs);

  t("the real id field is read", i.id === "4412" && readAs.id === "ServiceManagerIssueID");
  t("the real title field is read", i.title === "Kitchen sink faucet leaking"
    && readAs.title === "Title",
    `readAs.title=${readAs.title} — this account calls it Title, and a `
    + "list that does not contain it reads every issue as untitled.");
  // Both are filled here, so the ORDER is the only thing that decides.
  // With an empty Description the two orderings give the same answer and
  // the check proves nothing -- which is how it first passed on the fault.
  t("what the TENANT typed is preferred over what the office did",
    i.description === "Kitchen sink leaking from riser"
    && readAs.description === "CustomerDescription",
    `got "${i.description}" from ${readAs.description} — on a request `
    + "somebody submitted themselves, CustomerDescription is the one that "
    + "says what is actually wrong; Description is the office's note."); 
  t("Category, Status and Priority read as their names",
    i.category === "Plumbing" && i.status === "New" && i.priority === "High");
  t("an open issue is not closed", i.closed === false && i.closedOn === null);
  t("and it honestly has no location",
    i.property === null && i.unit === null && i.tenant === null,
    "The record carries no PropertyID, UnitID or TenantID and refuses "
    + "those embeds. Inventing one would be worse than saying so.");
}

{
  const i = readIssue({
    ServiceManagerIssueID: 1, Title: "Done", IsClosed: true,
    CloseDate: "2026-10-18T09:00:00", Resolution: "Replaced the riser",
  });
  t("a closed issue says so",
    i.closed === true && i.closedOn === "2026-10-18T09:00:00"
    && i.resolution === "Replaced the riser");
}

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

t("only the three embeds that answer are asked for",
  /const EMBEDS = "Category,Status,Priority";/.test(mod),
  "Property, Unit, Tenant, ServiceManagerStatus, ServiceManagerCategory "
  + "and ServiceManagerPriority every one returned 404 against this "
  + "account. Asked as one list, a single bad name fails the whole "
  + "request and the fallback quietly drops the status and the category.");

t("and the missing location is written down rather than papered over",
  /DOES NOT SAY WHICH LOT IT IS FOR/.test(mod),
  "The next person to read this needs to know it is an open question, "
  + "not an oversight.");

{
  // The whole key set, not merely that the three are present. Asserting
  // presence let a fourth field be added without anything objecting,
  // which on somebody's live property-management system is the failure
  // that matters.
  const body = /const patch = \{([\s\S]*?)\n  \};/.exec(mod)?.[1] ?? "";
  const keys = [...body.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]).sort();
  const want = ["CloseDate", "IsClosed", "Resolution", "ServiceManagerIssueID"];
  t(`closing writes only the fields it means to (${keys.join(", ")})`,
    JSON.stringify(keys) === JSON.stringify(want),
    `wanted exactly ${want.join(", ")}`);
}

t("and tries each shape rather than assuming one",
  /const WRITERS: Writer\[\] = \[/.test(mod)
  && /tried\.push\(\{/.test(mod),
  "The verb rmAPI wants for an update is not documented anywhere "
  + "reachable from here. Guessing once and failing silently is the "
  + "failure this whole module exists to end.");

t("and remembers the one that worked",
  /worked = w;/.test(mod),
  "So the searching happens once and every close after it goes "
  + "straight there.");

t("the embeds are retried without them if refused",
  /await rows\(session, "\/ServiceManagerIssues", budget\);/.test(mod),
  "A request with no status on it still beats not knowing it exists.");

t("the fetch stops before the function is killed",
  /if \(Date\.now\(\) > deadline\) return \{ got: out, more: true \};/.test(mod)
  && /maxDuration = 60;/.test(
    readFileSync(join(here, "..", "app", "api", "rentmanager", "issues",
      "route.ts"), "utf8")),
  "Hobby kills a function at sixty seconds, and a killed function does "
  + "not return JSON -- it returns whatever Vercel serves, which the "
  + "browser reports as \"Unexpected end of JSON input\". Stopping with "
  + "time to spare and saying there is more is a true answer that arrives.");

t("and filing stops too, not just fetching",
  /if \(Date\.now\(\) > until\) \{ out\.more = true; break; \}/.test(mod),
  "Each ingest is a round trip of its own; the clock runs during those "
  + "as well.");

t("a rehearsal reads one page, not forty",
  /pages: dryRun \? 1 :/.test(mod),
  "The preview exists to show what the records look like, and the first "
  + "page answers that.");

t("the browser does not assume the answer is JSON",
  /const body = await res\.text\(\);/.test(
    readFileSync(join(here, "..", "components", "RentManagerProbe.tsx"), "utf8")),
  "`res.json()` on a reply that is not JSON throws a message that names "
  + "the parser and not the problem.");

t("the route is admin only",
  /me\?\.role !== "admin"/.test(route));

t("the shape it saw is reported back",
  /shape: raw\[0\] \? Object\.keys\(raw\[0\]\) : null/.test(mod),
  "The field names are a hypothesis. The preview has to say what actually "
  + "came back, or the next guess is as blind as the first.");

/* ------------------------------------------- what Rent Manager did not say
 *
 * A request can arrive with no tenant, no number and no lot, because this
 * endpoint hands the issue over without them. Left blank, that reads as the
 * inbox having lost the details -- which is the complaint it produced. Said
 * out loud, it is a known gap with a known cause and a way round it.
 */
{
  const bare = detail(readIssue({
    ServiceManagerIssueID: 251,
    Title: "Water is coming out green",
    CreateDate: "2026-10-26T09:53:00",
  }));
  t("a request with nothing on it SAYS so rather than leaving a gap",
    /did not say/.test(bare),
    "A blank answers 'we do not have this' and 'nobody has looked' the same way.");
  t("and names all three things that are missing",
    /who submitted it/.test(bare) && /contact them/.test(bare)
      && /which lot/.test(bare),
    bare.slice(-240));
  t("and says where they DO come from, which is the way out",
    /notification email/.test(bare), bare.slice(-240));

  /* THE PAIR THAT MAKES THAT MEAN ANYTHING. A line that always appears is
     not a report, it is decoration -- and it would be read as "no contact
     details" on a request that has them, which is worse than silence. */
  const full = detail(readIssue({
    ServiceManagerIssueID: 252,
    Title: "Leak",
    Tenant: { Name: "Jane Doe", Phone: "(910) 555-0133", Email: "j@example.com" },
    Property: { Name: "The Retreat" },
    Unit: { Name: "51" },
    CreateDate: "2026-10-26T09:53:00",
  }));
  t("a request that HAS a tenant says nothing about anything missing",
    !/did not say/.test(full), full.slice(-240));

  /* And a half-known one names only what is actually absent. */
  const half = detail(readIssue({
    ServiceManagerIssueID: 253,
    Title: "Door",
    Tenant: { Name: "Abel Moreno" },
    CreateDate: "2026-10-26T09:53:00",
  }));
  t("a half-known request names only what is actually absent",
    /did not say/.test(half) && !/who submitted it/.test(half)
      && /which lot/.test(half), half.slice(-240));
}

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : "\nnothing obviously wrong");
process.exit(failed ? 1 : 0);
