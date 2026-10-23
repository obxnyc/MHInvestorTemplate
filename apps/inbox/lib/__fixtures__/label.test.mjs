/** What a thread is called when nobody knows who sent it.
 *
 *  `contacts.phone` is `not null unique` -- it is the key every webhook
 *  matches on -- so a Rent Manager issue that arrives with no tenant still
 *  needs something in that column, and intake writes `email:rm:issue:251`.
 *
 *  Fine as a key. On screen it was a column of threads called
 *  "email:rm:issue:251", "email:rm:issue:250", because `prettyPhone` hands
 *  back anything it cannot parse. An internal id where the tenant's name
 *  should be, on every maintenance request in the inbox.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
let js = ts.transpileModule(readFileSync(join(here, "..", "format.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
/* format.ts parses international numbers with a library a data: module
   cannot resolve. Only the +1 path and the fallthrough matter here, and both
   are in this file's own code. */
js = js.replace(/import\s*\{[^}]*\}\s*from\s*"libphonenumber-js";?/,
  "const parsePhoneNumberFromString = () => null;")
  .replace(/import\s*\{[^}]*\}\s*from\s*"@\/lib\/zone";?/, 'const ZONE = "America/New_York";')
  .replace(/export\s*\{\s*ZONE\s*\};?/, "");
const { realPhone, threadLabel } =
  await import("data:text/javascript," + encodeURIComponent(js));

const said = [];
const t = (name, fn) => {
  try { said.push([name, Boolean(fn())]); }
  catch (e) { said.push([name, false, String(e.message ?? e).slice(0, 110)]); }
};

/* ------------------------------------------------- is this a phone number */

t("a real number is a real number", () => realPhone("+12526422995") === "+12526422995");
/* THE ONE THIS EXISTS FOR, in the exact shape it reached the screen. */
t("an intake key is not", () => realPhone("email:rm:issue:251") === null);
t("nor is an email dressed as one", () => realPhone("email:jane@example.com") === null);
t("nor is empty, or missing", () =>
  realPhone("") === null && realPhone(null) === null && realPhone(undefined) === null);
/* A bare run of digits with no plus is not E.164 and is usually a lot
   number or an id somebody put in the wrong column. */
t("nor is a bare number with no country code", () => realPhone("2526422995") === null);

/* THESE GET PAST THE LEADING-PLUS TEST, so they are the only cases where the
   shape test is the rule that answers. Without them, deleting that test
   entirely changed nothing and every check still passed -- the plus was
   doing all the work and the guard behind it had never once been reached. */
t("a plus on its own is not a number", () => realPhone("+") === null);
t("nor is a plus and two digits", () => realPhone("+12") === null);
t("nor is a plus in front of words", () => realPhone("+rm:issue:251") === null);
t("nor is a plus and twenty digits", () => realPhone(`+${"9".repeat(20)}`) === null);

/* --------------------------------------------------- what to call it then */

t("a name wins over everything", () =>
  threadLabel("Jane Doe", "+12526422995", "Leak") === "Jane Doe");

t("a number is used when there is no name", () =>
  threadLabel(null, "+12526422995", "Leak") === "(252) 642-2995");

/* The fault, end to end. Without `realPhone` this returns the id. */
t("an issue with no tenant reads as what is wrong, not as an id", () =>
  threadLabel(null, "email:rm:issue:251", "Water is coming out green")
    === "Water is coming out green");

t("and never shows the key itself", () => {
  const out = threadLabel(null, "email:rm:issue:251", "Water is coming out green");
  return !out.includes("rm:issue") && !out.includes("email:");
});

t("something long is cut rather than filling the row", () => {
  const out = threadLabel(null, "email:rm:issue:9", "x".repeat(200));
  return out.length <= 60 && out.endsWith("…");
});

/* Knowing nothing is its own answer, and it is not an id either. */
t("knowing nothing says so", () =>
  threadLabel(null, "email:rm:issue:251", null) === "Unknown sender");
t("and whitespace is knowing nothing", () =>
  threadLabel("   ", "email:rm:issue:251", "   ") === "Unknown sender");

for (const [name, ok, why] of said) {
  if (ok) console.log(` ok ${name}`);
  else console.error(` ✗ ${name}${why ? ` -- ${why}` : ""}`);
}
if (said.some(([, ok]) => !ok)) process.exit(1);
console.log("a thread is never called by an internal id");
