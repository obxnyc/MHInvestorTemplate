/**
 * A request that says nothing about where it is or who sent it.
 *
 * The owner photographed one: a broken fridge, "via zego", from Rent
 * Manager issue 307. No property, no name, no number. The screen offered
 * nothing to do about any of it -- the card that exists for exactly this
 * only appeared when the request came with WORDS to match, and a Rent
 * Manager issue carries none. The narrower question, answered
 * confidently, for the fourth time in this codebase.
 *
 *     node lib/__fixtures__/unplaced-check.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");

const thread = bare(read("components/ThreadPane.tsx"));
const card = bare(read("components/PlaceNeeded.tsx"));
const claim = bare(read("app/api/places/claim/route.ts"));
const contact = bare(read("app/api/contacts/[id]/route.ts"));

const results = [];
const t = (name, run) => {
  let ok = false, why = null;
  try { ok = run() === true; } catch (e) { why = String(e && e.message || e); }
  results.push([name, ok, why]);
};

// ---- the card has to appear at all ------------------------------------

/* KEYED ON HAVING NO PROPERTY, not on having words. Asked by cutting the
   condition out: a rule that greps for `place_hint` anywhere in the file
   passes while the gate still reads `place_hint && !prop`. */
t("the card shows on any thread with no property", () => {
  const at = thread.indexOf("<PlaceNeeded");
  if (at < 0) throw new Error("the card is not on the thread");
  const open = thread.lastIndexOf("{", at);
  const gate = thread.slice(open, at);
  if (/place_hint\s*&&/.test(gate)) {
    throw new Error("still gated on the request having words to match,"
      + " which a Rent Manager issue does not");
  }
  return /!prop/.test(gate);
});
t("and it is handed the hint when there is one, as something optional",
  () => /hint=\{convo\.place_hint \?\? null\}/.test(thread));
t("the card accepts not having one",
  () => /hint: string \| null;/.test(card));

// ---- filing it must work without words --------------------------------

t("filing a request with no hint is not refused",
  () => !/nothing to remember/.test(claim));
/* REMEMBERING still needs words -- that is what an alias IS -- and the
   check is that the two were separated rather than both dropped. */
t("but the alias is still only written when there is something to write",
  () => /const hint = String\(convo\.place_hint \?\? ""\)\.trim\(\);/.test(claim)
     && /hint/.test(claim.slice(claim.indexOf("place_aliases") - 400,
                               claim.indexOf("place_aliases") + 200)));

// ---- who it is, and how to reach them ---------------------------------

t("the card asks who the tenant is", () => /PersonHere/.test(card));
t("and takes a number", () => /phone/.test(card) && /Mobile/.test(card));
t("the contact route accepts one",
  () => /phone !== undefined/.test(contact) && /patch\.phone = e164/.test(contact));
/* A TYPED NUMBER IS CHECKED, not stored. "ext 4" in that column is a
   contact nobody can text and nothing says why.
   Asked structurally: the sentence explaining the refusal stays in the
   file when the check around it is gutted, so a rule that greps for the
   words passes on exactly the fault it names. */
t("a typed number is normalised and checked before it is stored", () => {
  const at = contact.indexOf("patch.phone = e164");
  if (at < 0) throw new Error("nothing assigns the number");
  const before = contact.slice(contact.indexOf("phone !== undefined"), at);
  if (!/realPhone\(toE164\(/.test(before)) {
    throw new Error("whatever was typed goes in as it was typed");
  }
  /* And the refusal has to actually return, or it is a message nobody
     ever sees above a number that was stored anyway. */
  return /if \(!e164\) \{[\s\S]{0,260}?return NextResponse\.json/.test(before)
    && /is not a number we can text/.test(before);
});
/* AND SOMEBODY ELSE MAY ALREADY BE IT. Two contacts on one number is two
   threads for one person, and every later message picks whichever the
   query finds first. */
t("a number already on somebody else is refused rather than duplicated", () => {
  const at = contact.indexOf("patch.phone = e164");
  const before = contact.slice(0, at);
  return /\.eq\("phone", e164\)/.test(before) && /\.neq\("id", id\)/.test(before)
    && /status: 409/.test(before);
});
t("and the card does not call it saved until the server does", () => {
  const at = card.indexOf("async function save()");
  const body = card.slice(at, at + 900);
  const answered = body.indexOf("res.json()");
  const closed = body.indexOf("setOpen(false)");
  return answered >= 0 && closed > answered;
});
/* BLANKING IT IS NOT AN EDIT. The stand-in in that column is the only
   handle on this person until a real number replaces it. */
t("the number cannot be blanked",
  () => /blanking it would/.test(contact));

let bad = 0;
for (const [name, ok, why] of results) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${results.length}`); process.exit(1); }
console.log("a request with nothing on it can still be filed and answered");
