/** A time printed on the server must say which clock it is on.
 *
 *  Every server here runs in UTC. `toLocaleString` with no `timeZone` uses
 *  the machine's, so a shift that began at 8:08 in the evening was written
 *  into a message to the office as "since 12:08 AM" -- wrong by four hours in
 *  the one line somebody reads to decide whether to drive out -- and a 2pm
 *  showing would have been texted to a prospect as 6pm.
 *
 *  Only `app/` and `lib/`. A component runs in the browser, where the
 *  handset's own clock is the RIGHT answer: a man looking at his own
 *  timesheet wants the hours on his own wrist. The fault is specific to code
 *  that runs where nobody is standing.
 *
 *  The same method formats numbers -- `(1234.5).toLocaleString("en-US", {
 *  style: "currency" })` -- so what is looked for is an options object asking
 *  for a date or a time. A guard that flagged every `toLocaleString` would
 *  fail on every price in the codebase and be switched off within a day.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "__fixtures__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
};

// What only a date or a time asks for.
const WHEN = /\b(weekday|hour|minute|second|month|day|year|dateStyle|timeStyle|era)\s*:/;

const wrong = [];
for (const file of [...walk(join(root, "app")), ...walk(join(root, "lib"))]) {
  const src = readFileSync(file, "utf8");
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const m of bare.matchAll(/toLocale(?:Time|Date)?String\s*\(/g)) {
    // The call's own arguments: balance brackets from the opening paren.
    let d = 1, i = m.index + m[0].length;
    while (i < bare.length && d) {
      if (bare[i] === "(") d++;
      else if (bare[i] === ")") d--;
      i++;
    }
    const args = bare.slice(m.index + m[0].length, i - 1);
    if (!WHEN.test(args)) continue;              // a number, not a time
    if (/timeZone\s*:/.test(args)) continue;     // says which clock
    const line = bare.slice(0, m.index).split("\n").length;
    wrong.push(`${file.slice(root.length + 1)}:${line} formats a time without`
      + " a timeZone, on code that runs where nobody is standing");
  }
}

if (wrong.length) {
  for (const w of wrong) console.error(" ✗ " + w);
  process.exit(1);
}
console.log("every time printed on the server says which clock it is on");
