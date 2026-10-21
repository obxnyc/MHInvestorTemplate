/** The crew clock screen's rules.  Run: node lib/__fixtures__/clock-screen-check.mjs
 *
 *  None of these is visible to a type checker, to the picture harness, or to
 *  a test of what the arithmetic returns. They are rules about ORDER and
 *  about what a screen is allowed to assume, and each one is a fault this
 *  codebase has already shipped somewhere else.
 *
 *  Read as source, and anchored on the call rather than on the words -- a
 *  grep for a phrase matches the comment explaining the phrase as readily as
 *  the line carrying it, which cost a round in inside-check.mjs.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "..", "..", p), "utf8");
// Comments stripped. A whitelist in a guard is a hole in the guard, and a
// guard that reads its own explanation is the same hole with better prose.
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const screen = bare(read("components/ClockScreen.tsx"));
const route = bare(read("app/api/clock/route.ts"));
const ping = bare(read("app/api/clock/ping/route.ts"));

// Cut a block out before matching inside it, rather than matching from its
// opening line and letting the pattern run on. The block after the sign-off
// one also filters on staff_id, so a lazy match from "sign-off" found THAT
// one and the guard waved through a sign-off with its filter deleted.
const block = (src, from) => {
  const at = src.indexOf(from);
  if (at < 0) return "";
  const next = src.indexOf("if (action ===", at + from.length);
  return src.slice(at, next < 0 ? src.length : next);
};

const checks = [];
const t = (name, ok) => {
  try { checks.push([name, typeof ok === "function" ? !!ok() : !!ok]); }
  catch (e) { checks.push([name, false, `threw: ${e.message}`]); }
};

/* ---------------------------------------------- nothing moves until it took
 * This is a pay record. "I pressed it" against "we have no row" is an
 * argument nobody can win, so a press that failed must not look like a press
 * that worked -- the same fault as the chat send and the layout debounce.
 */
t("the screen reads the answer before changing anything", () => {
  const ok = screen.indexOf("if (!res || !res.ok)");
  const set = screen.indexOf("setState(out as State)");
  return ok > 0 && set > ok;
});
t("the failure path says something and stops",
  () => /setProblem\([\s\S]{0,120}?\);\s*return;/.test(screen));
// Not a ban on one setter's name -- the next person calls it something
// else. What is forbidden is ANY state being written in the press handler
// before the answer has been read, whatever it is called. The three that
// are allowed are the ones that only say the button is busy.
t("nothing is written to state before the answer is read", () => {
  const act = screen.slice(screen.indexOf("const act = async ("));
  const ok = act.indexOf("if (!res || !res.ok)");
  const sets = [...act.matchAll(/\bset[A-Z]\w*\(/g)].map((m) => m.index);
  const allowed = /^set(Busy|Problem|Sending)\(/;
  return ok > 0 && sets.length > 0
      && sets.every((i) => i > ok || allowed.test(act.slice(i)));
});

/* -------------------------------------------------------------- the accuracy
 * A device that did not say how sure it is has not said it is certain.
 * Defaulting a missing accuracy to zero turns "cannot tell" into "inside",
 * confidently, with somebody's wages on the other end of it.
 */
for (const [what, src] of [["the screen", screen], ["the route", route],
                           ["the ping route", ping]]) {
  t(`${what} never defaults a missing accuracy to nought`,
    () => !/accuracy[^\n]*\?\?\s*0\b/.test(src));
  t(`${what} passes a missing accuracy through as null`,
    () => /accuracy:[^\n]*null/.test(src));
}

/* ----------------------------------------------------- the fix is not a gate
 * A phone in a metal building can take thirty seconds or never answer. A man
 * standing there unable to start work is worse than a row with a blank in it.
 */
t("the position request cannot hang forever", () => /setTimeout\(/.test(screen));
t("a refused or failed position resolves rather than rejecting",
  () => /getCurrentPosition\(\s*[\s\S]{0,200}?\(\)\s*=>\s*\{[^}]*finish\(null\)/.test(screen));
t("clocking in is not conditional on having a position",
  () => !/if\s*\(\s*!fix\s*\)[\s\S]{0,80}return/.test(screen));
t("and the route records a shift with no position rather than refusing one",
  () => /start_lat:\s*fix\?\.lat\s*\?\?\s*null/.test(route));

/* --------------------------------------------- the trail belongs to the shift
 * Pinging while somebody is merely logged in is following people home.
 */
t("the ping effect only runs while on the clock",
  () => /useEffect\(\s*\(\)\s*=>\s*\{\s*if\s*\(!on\)\s*return;/.test(screen));
t("and it is torn down when that changes",
  () => /return\s*\(\)\s*=>\s*\{[^}]*clearInterval/.test(screen));
t("the ping route refuses to write without an open shift",
  () => /is\("ended_at",\s*null\)/.test(ping) && /if\s*\(!open\)/.test(ping));
t("and a ping after clocking out is not shouted about",
  () => /clockedOut:\s*true/.test(ping) && !/status:\s*4\d\d[\s\S]{0,60}clockedOut/.test(ping));

/* ------------------------------------------------ the office does not sign off
 * The crew member agrees their own hours, and nothing still running can be
 * agreed because the number is still moving.
 */
const signOff = block(route, 'action === "sign-off"');
t("there is a sign-off block at all", () => signOff.length > 100);
t("sign-off only ever touches this person's own shifts",
  () => /\.eq\("staff_id", me\.id\)/.test(signOff));
t("and never a shift that is still running",
  () => /\.not\("ended_at", "is", null\)/.test(signOff));
t("and never one already signed off",
  () => /\.is\("signed_off_at", null\)/.test(signOff));

/* ------------------------------------------------------- clocking out tidies
 * A shift closed around a break that is still open comes out longer than the
 * man was there.
 */
t("clocking out ends a break that is still running first", () => {
  const out = route.slice(route.indexOf('action === "out"'));
  const ends = out.indexOf('from("shift_breaks").update');
  const shut = out.indexOf('ended_at: new Date().toISOString(),\n      end_lat');
  return ends > 0 && shut > ends;
});

/* ------------------------------------------------------- it is the user's key
 * The row policies in 038 say a ping belongs to an open shift that is this
 * person's own. A route on the service key walks past them, which makes the
 * policy a comment rather than a rule.
 */
for (const [what, src] of [["the clock route", route], ["the ping route", ping]]) {
  t(`${what} goes through the signed-in client, not the service role`,
    () => /supabaseServer\(\)/.test(src) && !/supabaseAdmin/.test(src));
}

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
