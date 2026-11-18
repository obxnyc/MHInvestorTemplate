/**
 * Saying who somebody is, and not being asked who a plumber's tenant is.
 *
 *     node lib/__fixtures__/who-check.mjs
 *
 * "When trying to save this number it doesn't allow me to save him as
 * anything other than a tenant."
 *
 * He was texting his PLUMBER. The card is written for a tenant from top to
 * bottom -- the name box says "The tenant's name" -- and the save sent no
 * `party` at all, so the plumber stayed whatever he happened to be created
 * as. `/api/contacts/[id]` has accepted all six types since it was written.
 * Nothing ever offered them.
 *
 * AND THE CARD SHOULD NOT HAVE BEEN THERE. It rendered on ANY thread with
 * no property, which is right for a request that arrived and wrong for a
 * conversation the office opened: a red box across the screen reading
 * "This request did not say which property it is for -- Rent Manager does
 * not pass one on", over a list of every lot in every park, with no way to
 * shut it. `Cancel` closes the add-a-property form inside the card.
 * `Never mind` closes the contact form. Neither closes the card -- which I
 * told him to press, wrongly, before reading what it did.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..");
const app = join(lib, "..", "app");
const comp = join(lib, "..", "components");

const card = readFileSync(join(comp, "PlaceNeeded.tsx"), "utf8");
const pane = readFileSync(join(comp, "ThreadPane.tsx"), "utf8");
const route = readFileSync(join(app, "api/contacts/[id]/route.ts"), "utf8");
const running = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const checks = [];
const t = (name, fn, why) => checks.push([name, fn, why]);

/* ------------------------------------------- the two lists must agree */

/** Every party the SERVER will accept, read out of its own declaration. */
const accepted = (() => {
  const m = /const PARTIES = new Set\(\[([\s\S]*?)\]\)/.exec(route);
  return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
})();

/** Every party the FORM offers, read out of its options. */
const offered = (() => {
  const m = /<select value=\{party\}[\s\S]*?<\/select>/.exec(card);
  return m ? [...m[0].matchAll(/value="([a-z_]+)"/g)].map((x) => x[1]) : [];
})();

t("the server accepts more than one kind of person", () =>
  accepted.length >= 5,
  "read from the route's own declaration -- if this comes back empty the "
  + "checks below are comparing nothing to nothing and would pass");

t("the form offers something", () => offered.length >= 5,
  "likewise: an empty list matches an empty list");

t("EVERY type the server accepts is offered", () => {
  const missing = accepted.filter((p) => !offered.includes(p));
  if (missing.length) console.log(`        not offered: ${missing.join(", ")}`);
  return missing.length === 0;
}, "the whole complaint. Six were accepted, none were offered, and a "
 + "plumber could only be saved as whatever he already was");

t("and nothing is offered that the server would refuse", () => {
  const bogus = offered.filter((p) => !accepted.includes(p));
  if (bogus.length) console.log(`        would be refused: ${bogus.join(", ")}`);
  return bogus.length === 0;
}, "an option that saves and then fails is worse than one that is absent -- "
 + "the same shape as the radius table listing kinds the codebase does not "
 + "have. Both lists are READ, neither is trusted");

/* ------------------------------------------------------- and it is sent */

t("the choice is actually sent", () =>
  /body\.party = party/.test(running(card)),
  "a select nothing reads is a select that does nothing, which is where "
  + "this started");

t("what they already are is what it opens on", () =>
  /useState\(contact\.party \?\? "current_tenant"\)/.test(running(card)),
  "opening on Tenant for somebody already recorded as a vendor invites "
  + "saving him back to a tenant by pressing Save");

t("the name box stops assuming", () =>
  !/The tenant's name/.test(running(card)),
  "COMMENTS STRIPPED FIRST, which this check got wrong on its own first "
  + "run: the paragraph explaining the fault quotes the placeholder, and a "
  + "file explaining a rule reads the same to a search as a file breaking "
  + "it. That lesson is written down twice already and I walked past it");

/* ------------------------------------- and the card knows where it belongs */

t("the card needs a message FROM THEM", () => {
  const m = /\{!prop && (\w+) \?/.exec(running(pane));
  if (!m) return false;
  /* Derived from the code: whatever that variable is called, it has to be
     the one that finds an inbound message. A guard that writes the name in
     is a guard the next rename walks past. */
  const decl = new RegExp(`const ${m[1]}\\s*=[\\s\\S]{0,200}?direction === "inbound"`);
  return decl.test(running(pane));
}, "a thread with nothing inbound is not an unlocated request -- it is us "
 + "reaching out, and we already know where the work is");

t("a request that DID arrive still gets it", () => {
  /* The gate may not have quietly become "never". */
  const m = /\{!prop && (\w+) \?/.exec(running(pane));
  return m !== null && m[1] !== "false" && /<PlaceNeeded/.test(pane);
});

/* ---------------------------------------------------------------- report */

let failed = 0;
for (const [name, fn, why] of checks) {
  let ok = false, blew = null;
  try { ok = fn() === true; } catch (e) { blew = e.message; }
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${blew ? `threw: ${blew}` : why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : `\nnothing obviously wrong (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
