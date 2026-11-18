/**
 * Every screen is reachable from the navigation, or says why not.
 *
 *     node lib/__fixtures__/reachable-check.mjs
 *
 * "Where is this Jobs window that you've been referencing?"
 *
 * Nowhere. `/jobs` -- the board every work order lands on, that "Create
 * ticket" files into, that dispatches a trade their own link -- was not in
 * the navigation at all. It could only be reached by typing the URL. I had
 * pointed the owner at it three times across two days without once checking
 * it was on the page.
 *
 * THAT IS THE THIRD TIME IN A WEEK that a finished feature was unreachable:
 * forwarding to a vendor lived behind a three-dot menu on a message bubble;
 * raising a ticket lived behind a dropdown labelled "Send to…"; and the
 * whole Jobs board was behind nothing at all, because nothing linked to it.
 *
 * Writing "check the link exists" in a file would be the fourth. So this
 * reads the pages off the filesystem and the links out of the header, and
 * makes anybody adding a screen DECIDE: it is in the navigation, or it is
 * named here with the reason it is not. A page that is neither is the fault
 * this exists to catch.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "..", "app", "(app)");
const header = readFileSync(
  join(here, "..", "..", "components", "AppHeader.tsx"), "utf8");

const checks = [];
const t = (name, fn, why) => checks.push([name, fn, why]);

/** Every screen under the signed-in layout, read off the filesystem.
 *
 *  A screen is not always `<name>/page.tsx`: `/c` is `c/[id]/page.tsx`,
 *  one conversation. Looking only at the top level called that "no such
 *  screen" and reported the exemption for it as stale -- the check being
 *  right about the rule and wrong about the world. */
const hasPage = (dir) => {
  if (existsSync(join(dir, "page.tsx"))) return true;
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .some((d) => existsSync(join(dir, d.name, "page.tsx")));
};

const pages = readdirSync(app, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .filter((d) => hasPage(join(app, d.name)))
  .map((d) => `/${d.name}`);

/** Every href the header links to, including the ones inside its menus. */
const linked = new Set(
  [...header.matchAll(/href:\s*"(\/[a-z-]*)"/g)].map((m) => m[1]),
);

/**
 * Screens that are deliberately NOT navigation items, each with the reason.
 *
 * This is a list somebody has to add to on purpose, which is the point: the
 * fault was a page nobody decided about either way. A page here has been
 * decided about.
 */
const REACHED_ANOTHER_WAY = {
  "/c": "one conversation, opened from the Messages list",
  "/trail": "one person's day, opened from the crew card and the timesheet",
  "/account": "your own account, under the avatar menu",
  "/audit": "the audit log, linked from Settings",
  "/legal": "the legal pages, linked from Settings",
  "/setup": "the setup check, linked from Settings and from the daily report",
  "/rentmanager": "the Rent Manager probe, linked from Settings",
  "/maps": "a property's map, opened from that property",
  "/people": "the staff list, linked from Settings",
  "/calls": "the call log, opened from the Messages header",
  "/team": "staff threads, which appear in the Messages list itself",
  "/distributions": "owner distributions, under the Investors menu",
};

/* -------------------------------------------------------------- the rule */

t("there are screens to check", () => pages.length >= 10,
  "read off the filesystem -- an empty list would make every check below "
  + "pass while asking nothing");

t("the header links to something", () => linked.size >= 5);

t("every screen is in the navigation or named as reached another way", () => {
  const orphans = pages.filter((p) =>
    !linked.has(p) && !(p in REACHED_ANOTHER_WAY));
  if (orphans.length) {
    console.log(`        nothing links to: ${orphans.join(", ")}`);
    console.log("        Put it in AppHeader, or add it to REACHED_ANOTHER_WAY");
    console.log("        with the way somebody actually gets to it.");
  }
  return orphans.length === 0;
}, "THE FAULT ITSELF. /jobs was neither, for as long as the board has "
 + "existed, and the only reason anybody noticed is that the owner went "
 + "looking for a thing he had been told about three times");

t("JOBS specifically is in the navigation", () => linked.has("/jobs"),
  "named on its own as well as covered by the rule above, because this is "
  + "the one that was wrong and a rule somebody can satisfy by adding an "
  + "excuse is a rule that gets satisfied that way");

t("and the excuses are not a way out for it", () =>
  !("/jobs" in REACHED_ANOTHER_WAY),
  "a whitelist is a hole in the guard, which this repository has written "
  + "down twice. The list above is for pages that genuinely are not "
  + "navigation; the board tickets land on is not one of them");

t("every excuse names a real screen", () => {
  const stale = Object.keys(REACHED_ANOTHER_WAY).filter((p) => !pages.includes(p));
  if (stale.length) console.log(`        no such screen: ${stale.join(", ")}`);
  return stale.length === 0;
}, "an exemption for a page that has been deleted is a line nobody will "
 + "question when the name is reused");

/* ---------------------------------------------------------------- report */

let failed = 0;
for (const [name, fn, why] of checks) {
  let ok = false, blew = null;
  try { ok = fn() === true; } catch (e) { blew = e.message; }
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${blew ? `threw: ${blew}` : why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : `\nnothing obviously wrong (${checks.length} checks, `
                     + `${pages.length} screens)`);
process.exit(failed ? 1 : 0);
