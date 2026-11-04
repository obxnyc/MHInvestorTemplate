/**
 * Who lives in the unit.
 *
 *     node lib/__fixtures__/tenants-check.mjs
 *
 * One unit out of 417 knew its tenant. `/Tenants` and `/Leases` both
 * answer on this account and nothing had ever fetched either — the same
 * shape as `/ServiceManagerIssues`, readable for weeks while tenants
 * wondered where their maintenance requests went.
 *
 * Two things here can be wrong in a way nobody sees. A tenant placed in
 * the unit they MOVED OUT OF sends somebody to the wrong door, and the
 * screen looks perfect. And two tenants with no phone number between
 * them collide on one placeholder, so the second silently never
 * arrives.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");
const raw = readFileSync(join(lib, "rm-tenants.ts"), "utf8");
writeFileSync(join(here, "rm-tenants.gen.mjs"), ts.transpileModule(
  raw.replace(/^import\b[\s\S]*?from\s*"[^"]*";/gm, ""),
  { compilerOptions: { target: 99, module: 99 } }).outputText);
const { unitByTenant, tenantPlaceholder } =
  await import(join(here, "rm-tenants.gen.mjs"));

const checks = [];
const t = (name, fn, why) => {
  let ok = false, blew = null;
  try { ok = fn() === true; } catch (e) { blew = e.message; }
  checks.push([name, ok, blew ? `threw: ${blew}` : why]);
};

/* ------------------------------------------- the lease that counts now
 *
 * The fixture gives ONE tenant TWO leases, and they point at different
 * units. With one lease each, "newest wins" and "first seen wins" and
 * "last seen wins" all return the same answer and the check proves
 * nothing — the mistake this file has made four times.
 *
 * They are also deliberately listed OLDEST LAST, so a rule that simply
 * keeps whatever it saw most recently gets it wrong.
 */
const LEASES = [
  { tenantId: 7, unitId: 300, propertyId: 9, movedIn: "2024-03-01" }, // the new one
  { tenantId: 7, unitId: 100, propertyId: 9, movedIn: "2019-06-15" }, // moved out of
  { tenantId: 8, unitId: 400, propertyId: 9, movedIn: "2022-01-09" },
];

t("a tenant who has moved within the park is in the unit they are in now",
  () => unitByTenant(LEASES).get(7)?.unitId === 300,
  "unit 100 is the one they left in 2024; sending a vendor there is a "
  + "wasted trip and a tenant who thinks nobody came");

t("the order the leases arrive in does not decide it",
  () => unitByTenant([...LEASES].reverse()).get(7)?.unitId === 300,
  "listed oldest-last on purpose: a rule that keeps the last one seen "
  + "returns 100 from one ordering and 300 from the other");

t("a tenant with one lease is placed by it",
  () => unitByTenant(LEASES).get(8)?.unitId === 400);

t("a tenant with no lease at all is not invented a unit",
  () => unitByTenant(LEASES).get(99) === undefined,
  "they come in as a person with no address, which is true, rather "
  + "than being put somewhere plausible");

t("a lease carrying no move-in date loses to one that has a date",
  () => unitByTenant([
          { tenantId: 5, unitId: 11, propertyId: 1, movedIn: "" },
          { tenantId: 5, unitId: 22, propertyId: 1, movedIn: "2021-05-02" },
        ]).get(5)?.unitId === 22,
  "an undated lease is the one we know least about; it must not win "
  + "over one somebody actually filled in");

t("a lease with no unit on it is still the current lease",
  () => { const got = unitByTenant([
            { tenantId: 6, unitId: null, propertyId: 3, movedIn: "2025-01-01" },
            { tenantId: 6, unitId: 55, propertyId: 3, movedIn: "2020-01-01" },
          ]).get(6);
          return got?.unitId === null; },
  "the honest answer is that the current lease names no unit, not that "
  + "they are still in the one they left five years ago");

/* ------------------------------------- the phone that is not a phone */

t("two tenants with no number do not collide on one placeholder",
  () => tenantPlaceholder(41) !== tenantPlaceholder(42),
  "`contacts.phone` is unique and will not take a null, so one shared "
  + "placeholder means the second tenant silently never arrives");

t("the placeholder is stable, so a second run updates rather than adds",
  () => tenantPlaceholder(41) === tenantPlaceholder(41));

t("the placeholder cannot be mistaken for a number",
  () => !/^\+?\d/.test(tenantPlaceholder(41)),
  "anything that parses as a phone number will be dialled by somebody");

/* --------------------------------------------------------- source rules */

const body = (() => {
  const i = raw.indexOf("export async function pullTenants");
  return i < 0 ? "" : raw.slice(i);
})();

t("the writing half can still be found",
  () => body.length > 0 && /\.from\("contacts"\)/.test(body));

t("a rehearsal stops before anything is written",
  () => {
    const guard = body.indexOf("if (dryRun) return out;");
    const write = body.search(/\.from\("contacts"\)[\s\S]{0,80}\.(insert|update)\(/);
    return guard > 0 && write > 0 && guard < write;
  },
  "checked by position, because a regex for 'returns before writing' "
  + "matches none of the ways that line can be written");

t("a second run finds the person by Rent Manager's id, not by their name",
  () => /\.eq\("rm_tenant_id"/.test(body),
  "names are edited and two households share one; the id is the only "
  + "thing that makes this re-runnable, and it is why 049 exists");

t("a number that is not a number is never stored",
  () => /isValidPhone\(/.test(body),
  "`toE164` never returns null -- its last line is `+` plus the digits "
  + "-- so \\\"n/a\\\" becomes \\\"+\\\", and every tenant without a number "
  + "collides on that one value");

t("somebody already here under their own number is joined, not duplicated",
  () => {
    const i = body.indexOf("if (realPhone) {");
    if (i < 0) return false;
    const block = body.slice(i, i + 700);
    return /\.eq\("phone", realPhone\)/.test(block) && /out\.merged/.test(block);
  },
  "a tenant who texts the mainline is already a contact, and "
  + "`contacts.phone` is unique -- inserting is refused and the roster "
  + "silently skips the people you talk to most");

/* ------------------------ the two places it has to actually show up
 *
 * The roster shipped as a button and the button was never pressed, so
 * the roster stayed empty and the whole feature read as broken. It was
 * not broken. It was waiting for somebody, which for a step that needs
 * doing once is the same thing.
 */
const auto = readFileSync(
  join(lib, "..", "app/api/rentmanager/issues/auto/route.ts"), "utf8");

t("the roster is brought across by itself, not by a button",
  () => /pullTenants\(/.test(auto),
  "a step that only ever needs doing once is exactly the step nobody "
  + "remembers to do");

/* Asked of the GATE, not of the words.
 *
 * The first version of this checked that `rm_tenant_id` and
 * `updated_at` appear in the file, and passed when the condition they
 * belong to was replaced with `if (true)` -- because the queries that
 * read them are still sitting right above it. A guard that tests for
 * the presence of words tests nothing about what they do. */
t("and not on every single inbox open",
  () => {
    const call = auto.indexOf("await pullTenants(");
    if (call < 0) return false;
    // The condition immediately guarding the call, not anywhere in the file.
    const before = auto.slice(Math.max(0, call - 400), call);
    return /if\s*\([^)]*\b(?:count|staleBy)\b[\s\S]{0,80}\)\s*\{/.test(before);
  },
  "several hundred people do not change between lunch and the "
  + "afternoon; re-reading the roster on every inbox open is a minute "
  + "of Rent Manager's time, every five minutes, for nothing");

t("it cannot cost the office the new requests",
  () => {
    const i = auto.indexOf("pullTenants(");
    const around = auto.slice(Math.max(0, i - 600), i + 400);
    return /try\s*\{/.test(around) && /catch/.test(around);
  });

t("the pull and the repair are asked for first",
  () => {
    const pull = auto.indexOf("pullServiceIssues(");
    const fix = auto.indexOf("repairIssues(");
    const ros = auto.indexOf("pullTenants(");
    return pull > 0 && fix > pull && ros > fix;
  },
  "by position: what has just come in matters more than tidying the "
  + "roster");

/* FILLING THE PERSON IN WHEN THE ADDRESS IS ANSWERED.
 *
 * "This request did not say which property it is for... Nobody is
 * attached to this request, so there is nowhere to send a reply." The
 * office then picks the property, and until now that was all that
 * happened -- the thread knew the address and still named nobody, with
 * the tenant one join away in the lease roster. */
const claim = readFileSync(
  join(lib, "..", "app/api/places/claim/route.ts"), "utf8");
const fill = (() => {
  const i = claim.indexOf("let person: string | null = null;");
  if (i < 0) return "";
  const rest = claim.slice(i);
  const end = rest.indexOf("await db.from(\"work_orders\")");
  return end < 0 ? rest : rest.slice(0, end);
})();

t("the block that names the person can be found",
  () => fill.length > 0 && /party", "current_tenant"/.test(fill),
  "every rule below reads it");

t("answering the address names the person who lives there",
  () => /\.eq\("unit_id", unitId\)/.test(fill)
     && /contact_id: living\[0\]/.test(fill),
  "the whole point of answering 'which property is it' is that the "
  + "reply then has somewhere to go");

t("a thread that already names somebody is left alone",
  () => /!here\.full_name/.test(fill),
  "a named contact was put there by the email or by a person, and a "
  + "tenant reports a leak at their neighbour's as readily as their "
  + "own -- fill a blank, never an answer");

t("two tenants at one address is refused, not picked between",
  () => /\.limit\(2\)/.test(fill) && /living\?\.length === 1/.test(fill),
  "picking either sends a reply to the wrong person about their own "
  + "home; asking for two is how you can tell there was more than one");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : `\nnothing obviously wrong (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
