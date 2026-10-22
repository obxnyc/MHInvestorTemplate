/** The crew's own words.  Run: node lib/__fixtures__/say.test.mjs
 *
 *  A HALF-TRANSLATED SCREEN IS THE WORST OF THE THREE STATES. English is
 *  readable by the office; Spanish is readable by the crew; a mixture is
 *  readable by nobody and looks broken, which is how a man decides the app
 *  cannot be trusted and goes back to writing hours on a card.
 *
 *  So what is checked is not that the Spanish is good -- no harness can say
 *  that -- but the three ways it silently stops being complete: a key that
 *  exists in one language and not the other, a key that was copied across and
 *  never translated, and a sentence whose holes do not match so a number
 *  lands in the wrong place or nowhere at all.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const load = (n) => ts.transpileModule(
  readFileSync(join(here, "..", `${n}.ts`), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const { SAY, say, fill, pickLang, LANGS } =
  await import("data:text/javascript," + encodeURIComponent(load("say")));

const said = [];
const t = (name, fn) => {
  try { said.push([name, Boolean(fn())]); }
  catch (e) { said.push([name, false, String(e.message ?? e).slice(0, 110)]); }
};

const keys = Object.keys(SAY);

t("there are words to check at all", () => keys.length > 40);

t("every line exists in both languages", () =>
  keys.every((k) => LANGS.every((l) => typeof SAY[k][l] === "string" && SAY[k][l].length)));

/* A key copied across and never translated. Allowed where the word really is
   the same in both -- "Total" is "Total" -- so those are named here rather
   than the rule being weakened. A list that grows every time somebody adds a
   key is a list somebody should notice growing. */
const SAME_IN_BOTH = new Set(["total"]);
t("nothing was copied across and left in English", () => {
  const lazy = keys.filter((k) => SAY[k].en === SAY[k].es && !SAME_IN_BOTH.has(k));
  if (lazy.length) console.error("   untranslated:", lazy.join(", "));
  return lazy.length === 0;
});

/* THE HOLES HAVE TO MATCH. `Submit {hours} Hours` translated as "Enviar {h}
   horas" fills nothing and shows the reader a brace. Checked as a SET, so a
   hole dropped, added or renamed all fail. */
const holesOf = (s) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
t("a sentence with a number in it has the same holes in both languages", () => {
  const bad = keys.filter((k) => {
    const a = holesOf(SAY[k].en), b = holesOf(SAY[k].es);
    return a.size !== b.size || [...a].some((x) => !b.has(x));
  });
  if (bad.length) console.error("   holes differ:", bad.join(", "));
  return bad.length === 0;
});

t("the holes are actually filled", () =>
  say("submitHours", "es", { hours: "7:30" }) === "Enviar 7:30 horas para aprobación");

/* A hole with nothing for it must not be silently emptied -- a sentence
   reading "Enviar horas" looks deliberate and is a missing number. */
t("a hole nobody filled is left visible rather than quietly removed", () =>
  fill("Enviar {hours} horas", {}) === "Enviar {hours} horas");

/* ------------------------------------------------- choosing without asking */

t("a phone set to Spanish gets Spanish", () => pickLang(null, "es-MX") === "es");
t("a phone set to English gets English", () => pickLang(null, "en-US") === "en");
t("a phone set to something else falls back to English rather than guessing",
  () => pickLang(null, "pt-BR") === "en");
t("a phone that says nothing falls back to English",
  () => pickLang(null, undefined) === "en");

/* A PERSON'S CHOICE BEATS THE HANDSET, both ways round. Only checking the
   Spanish direction would pass on a version that ignored the stored value
   whenever the device already said Spanish. */
t("somebody who chose Spanish on an English phone gets Spanish",
  () => pickLang("es", "en-US") === "es");
t("somebody who chose English on a Spanish phone gets English",
  () => pickLang("en", "es-MX") === "en");
t("a stored value that is nonsense does not win", () =>
  pickLang("fr", "es-MX") === "es");

for (const [name, ok, why] of said) {
  if (ok) console.log(` ok ${name}`);
  else console.error(` ✗ ${name}${why ? ` -- ${why}` : ""}`);
}
if (said.some(([, ok]) => !ok)) process.exit(1);
console.log(`${keys.length} lines, both languages, holes matching`);
