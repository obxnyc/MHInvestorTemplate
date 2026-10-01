/** Reading a forwarded notification back out for display.
 *  Run: node lib/__fixtures__/intake-view.test.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(readFileSync(join(here, "..", "intake-view.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { readIntake, sentWhen } = await import("data:text/javascript," + encodeURIComponent(js));

const checks = [];
const t = (n, ok) => checks.push([n, ok]);

// Byte for byte the shape that arrived through Postmark on 1 October, with
// the tenant's details replaced. The Gmail forwarding furniture above it is
// the part this exists to get out of the way.
const FORWARDED = `---------- Forwarded message ---------
From: Rent Manager Event Notifier <donotreply@rentmanager.com>
Date: Wed, Sep 30, 2026 at 8:20 PM
Subject: New Issue Submitted from TWA: 110 Lisas Way, 110 Lisas Way
To: <larabeehomesllc@gmail.com>


Tenant WebAccess
The following issue was submitted via TWA:
Issue Title: toilet leakage
Description: the hallway toilet is leaking water at the base of the toilet leaving water over the bathroom floor
Assigned To:

Tenant: Tester, Pat
Number: (252) 555-0188`;

const v = readIntake(FORWARDED);

t("the real sender is named, not the Gmail envelope",
  v.from === "Rent Manager Event Notifier");
t("the place comes off the subject line", v.place === "110 Lisas Way, 110 Lisas Way");
t("the fault is the heading", v.title === "toilet leakage");
t("the description survives in full",
  v.description === "the hallway toilet is leaking water at the base of the toilet leaving water over the bathroom floor");
t("the tenant is named", v.tenant === "Tester, Pat");
t("and their number is kept", v.phone === "(252) 555-0188");

// The one that matters most. The tenant reported this on 30 September; it was
// forwarded on 1 October. A thread showing 1 October is claiming a two-day-old
// repair is new, at exactly the moment somebody is deciding what to do first.
t("the ORIGINAL date is read, not the forward's", v.sentAt?.includes("Sep 30, 2026"));
t("and it renders as something a person reads",
  (sentWhen(v.sentAt) ?? "").includes("Sep 30"));

t("enough was understood to be worth a card", v.readable === true);

// "Assigned To:" is empty and must not swallow the blank line and reach into
// the next field. This exact bug is why the label regex stops at end of line.
t("an empty field does not capture the one below it",
  v.tenant === "Tester, Pat");

// Degradation. A provider rewording its template must fall back to the email.
{
  const junk = readIntake("Hello, the gate code stopped working. Thanks, Pat");
  t("prose is not dressed up as a form", junk.readable === false);
  t("and nothing is invented from it",
    junk.title === null && junk.place === null && junk.tenant === null);
}
{
  // One field understood is not enough: a heading with nothing under it tells
  // you less than the original.
  const thin = readIntake("Subject: New Issue Submitted from TWA: Lot 7\nnothing else");
  t("one field alone does not earn a card", thin.readable === false);
}
{
  const noDate = readIntake(FORWARDED.replace(/^Date:.*$/m, ""));
  t("a missing date loses the date, not the card",
    noDate.readable === true && noDate.sentAt === null && sentWhen(null) === null);
}
{
  // A date we cannot parse is still a date somebody wrote.
  t("an unreadable date is shown as written", sentWhen("sometime Tuesday") === "sometime Tuesday");
}

let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "  ok" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
