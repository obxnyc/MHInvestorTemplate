/**
 * Parser regression tests.  Run:  node lib/__fixtures__/parsers.test.mjs
 *
 * Fixtures mirror the real provider templates with resident details replaced.
 * The labels and layout are what matter and are reproduced exactly.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";
import { RENT_MANAGER, VOICEMAIL, VOICEMAIL_BLANK, ZILLOW_FIRST, ZILLOW_REPLY, SQUARESPACE, COURT_FILING } from "./samples.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "parse-email.ts"), "utf8").replace(/import type .*\n/, "");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { routeEmail, parseCourtFiling, isCourtFilingEmail } = await import("data:text/javascript," + encodeURIComponent(js));

const rm = routeEmail(RENT_MANAGER);
const vm = routeEmail(VOICEMAIL);
const blank = routeEmail(VOICEMAIL_BLANK);
const za = routeEmail(ZILLOW_FIRST);
const zb = routeEmail(ZILLOW_REPLY);
const sq = routeEmail(SQUARESPACE);
const cf = parseCourtFiling(COURT_FILING);
const junk = routeEmail({
  from: "newsletter@example.com", to: "x@y.com",
  subject: "Weekly digest", messageId: "<n@x>", text: "Nothing here.",
});

const checks = [
  ["Rent Manager TWA routes to maintenance", rm?.category === "maintenance"],
  ["tenant 'Doe, Jane' renders as 'Jane Doe'", rm?.name === "Jane Doe"],
  ["reads the 'Number:' label, not 'Phone:'", !!rm?.phone?.includes("555-0100")],
  ["unit comes from the subject line", !!rm?.unitHint?.includes("Lot #51")],
  // Regression: \s* after a colon matches newlines, so an empty "Assigned To:"
  // used to reach across the blank line and capture "Tenant: Doe, Jane".
  ["empty 'Assigned To:' does not capture the next field",
    !rm?.summary.includes("Doe, Jane")],
  ["voicemail routes by mailbox name", vm?.category === "current_tenant"],
  ["caller number parsed from subject", vm?.phone === "+15555550100"],
  ["provider transcript is carried through",
    !!vm?.summary.includes("kitchen faucet is still dripping")],
  ["[BLANK_AUDIO] still opens a thread", !!blank],
  ["[BLANK_AUDIO] is labelled, not shown as a transcript",
    !!blank?.summary.includes("no speech recorded")],
  ["unrecognised sender matches no parser", junk === null],

  // Zillow arrives in two templates: first contact uses "<Name> says:",
  // follow-ups use ALL-CAPS block labels with the value on the next line.
  ["Zillow first contact parses the name", za?.name === "Renter Name"],
  ["Zillow first contact parses the property",
    !!za?.unitHint?.includes("1140 Northside Rd")],
  ["Zillow follow-up reads RENTER'S MESSAGE block",
    !!zb?.summary.includes("co-signer")],
  ["Zillow boilerplate is stripped from the thread",
    !za?.raw.includes("Zillow, Inc.") && !za?.raw.includes("federal Fair Housing Act")],
  // Zillow anonymises renters: there is no phone number to text, only a
  // per-lead relay address. Inventing one would be worse than having none.
  ["Zillow leads carry no phone number", za?.phone === null && zb?.phone === null],
  ["Zillow relay address threads both messages together",
    za?.email === zb?.email && !!za?.email?.includes("convo.zillow.com")],
  ["thread explains why there is no number to text",
    !!za?.raw.includes("Ask for one before texting")],

  // Squarespace: blank-line separated "Label: value", plus a consent field.
  ["Squarespace parses name, phone and email",
    sq?.name === "Sample Person" && !!sq?.phone?.includes("555-0100")
      && sq?.email === "sample@example.com"],
  ["Squarespace carries the enquiry into the summary",
    !!sq?.summary.includes("3 bedroom")],
  ["SMS consent is captured verbatim",
    !!sq?.consent?.disclosureText.includes("Reply STOP to cancel")],
  // The disclosure covers service updates and reminders, not marketing, so a
  // separate opt-in is still required before any nurture campaign.
  ["consent is recorded as transactional, not marketing",
    sq?.consent?.purpose === "transactional"],

  // Court eFiling: values are tab-separated table cells, not "Label: value".
  ["court filing email is recognised", isCourtFilingEmail(COURT_FILING)],
  ["case number parsed from tab-separated cell", cf.caseNumber === "26CV000973-690"],
  ["case style splits into plaintiff and defendant",
    cf.plaintiff === "Sample Holdings LLC" && cf.defendant === "Sample Defendant"],
  ["filing type parsed", cf.filingType === "Voluntary Dismissal"],
  ["status parsed from the notice", cf.status === "Accepted"],
  ["envelope number dedupes redelivery", cf.envelopeNumber === "7689456"],
  ["stamped-copy link captured", !!cf.documentUrl?.includes("ViewDocuments")],
  ["submitted timestamp parsed", !!cf.submittedAt],
  // A court filing must never become a conversation in the shared inbox.
  ["court filing does not route into the shared inbox",
    routeEmail(COURT_FILING) === null],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
