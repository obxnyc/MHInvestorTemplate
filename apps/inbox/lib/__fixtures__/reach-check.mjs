/**
 * Whether a reply has anywhere to go, and whether the screen says so.
 *
 * A maintenance request from Rent Manager arrives with no mobile number,
 * so `contacts.phone` holds a key like `email:rm:issue:251`. That key was
 * handed straight to Twilio, which refused it -- and the first anybody
 * knew was a failed message under something they had already typed. The
 * office could not answer a tenant.
 *
 *     node lib/__fixtures__/reach-check.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const tmp = join(here, ".tmp-reach");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const name of ["format", "reachable", "zone"]) {
  const file = join(root, `lib/${name}.ts`);
  let js;
  try { js = readFileSync(file, "utf8"); } catch { continue; }
  writeFileSync(join(tmp, `${name}.mjs`),
    ts.transpileModule(js, { compilerOptions: {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
      .replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"')
      /* `@/lib/x` is the application's own alias and nothing here
         resolves it; the files sit side by side in the copy. */
      .replace(/from "@\/lib\/(\w+)"/g, 'from "./$1.mjs"'));
}
const { reachFor, reachSays } = await import(pathToFileURL(join(tmp, "reachable.mjs")).href);
rmSync(tmp, { recursive: true, force: true });

const results = [];
const t = (name, run) => {
  let ok = false, why = null;
  try { ok = run() === true; } catch (e) { why = String(e && e.message || e); }
  results.push([name, ok, why]);
};

// ---- the three answers, which have to be three ------------------------

t("a tenant who texts is reached by text", () => {
  const r = reachFor({ phone: "+19105550114", email: null });
  return r.by === "sms" && r.to === "+19105550114";
});
t("a request with only an email is reached by email", () => {
  const r = reachFor({ phone: "email:rm:issue:251", email: "dana@example.com" });
  return r.by === "email" && r.to === "dana@example.com";
});
/* THE ONE THAT WAS BROKEN. The stand-in is not a number and must never be
   treated as one; a fixture that only had real numbers and real emails
   could not tell this apart from either. */
t("a Rent Manager request with neither is reached by nothing", () => {
  const r = reachFor({ phone: "email:rm:issue:251", email: null });
  return r.by === "none";
});
t("and it says it came from Rent Manager, which is the thing to act on",
  () => /Rent Manager/.test(reachFor({ phone: "email:rm:issue:251" }).why));
t("an email-sourced one with no address says that instead",
  () => /arrived by email/.test(reachFor({ phone: "email:abc123" }).why));
t("and a contact with nothing at all says that",
  () => /no mobile number or email/.test(reachFor({ phone: "", email: "" }).why));

/* A number beats an email when both are there: a tenant who gets a text
   reads it, and an email about a leaking pipe can sit for a day. */
t("a number wins over an email when there are both",
  () => reachFor({ phone: "+19105550114", email: "d@example.com" }).by === "sms");
/* And a MALFORMED email is not an email. Without this, "n/a" or a stray
   name in that column reads as somewhere to send a contract. */
t("something that is not an address is not an email",
  () => reachFor({ phone: "email:rm:issue:9", email: "not an address" }).by === "none");

t("the sentence names where it goes",
  () => /text to \(910\)/.test(
    reachSays(reachFor({ phone: "+19105550114" }), (p) => `(910) ${p.slice(-7)}`))
    && /email to dana@/.test(
      reachSays(reachFor({ phone: "x", email: "dana@example.com" }), (p) => p)));

// ---- rules about the screen and the route -----------------------------

const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
const reply = bare(readFileSync(join(root, "app/api/conversations/[id]/reply/route.ts"), "utf8"));
const composer = bare(readFileSync(join(root, "components/Composer.tsx"), "utf8"));
const thread = bare(readFileSync(join(root, "app/api/conversations/[id]/thread/route.ts"), "utf8"));

/* THE STAND-IN MUST NOT REACH THE CARRIER. Anchored on what is handed to
   Twilio rather than on the word "phone": the fault was one assignment. */
t("the carrier is never handed the contact's raw phone column", () => {
  const at = reply.indexOf("messages.create(");
  if (at < 0) return false;
  const call = reply.slice(at, at + 400);
  return /to,/.test(call) && !/person\.phone/.test(reply);
});
t("the route works out how to reach them before sending anything", () => {
  const decided = reply.indexOf("reachFor(");
  const sent = reply.indexOf("messages.create(");
  return decided >= 0 && sent > decided;
});
t("and refuses when there is nowhere to send it",
  () => /reach\.by === "none"/.test(reply) && /status: 400/.test(reply));
t("an email reply is recorded as an email rather than as a text",
  () => /channel/.test(reply) && /channel = "email"/.test(reply));

t("the thread says how a reply reaches them", () => /reachFor\(/.test(thread));
/* SAID BEFORE SOMEBODY TYPES. The whole complaint was finding out
   afterwards, so a rule that only checked the route would miss it. */
t("the composer shows why there is nowhere to send it",
  () => /reach\?\.by === "none"/.test(composer) && /reach\.why/.test(composer));
/* THE BUTTON'S OWN ATTRIBUTES, cut out before matching. A window of so
   many characters runs on past the tag and into the sentence underneath,
   which mentions the same thing -- so deleting the rule from the button
   left both of these passing. Same family as the anchor that ran into
   the next block in the sign-off check. */
const sendButton = (() => {
  const at = composer.indexOf('type="submit"');
  if (at < 0) return null;
  const open = composer.lastIndexOf("<button", at);
  if (open < 0) return null;
  /* To the `>` that ENDS THE TAG, which is not the first one: the
     disabled expression contains `files.busy > 0`, and stopping at that
     cut the rule being asked about out of the slice. Depth-counted. */
  let depth = 0;
  for (let i = open; i < composer.length; i++) {
    const ch = composer[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0 && i > open) return composer.slice(open, i);
  }
  return null;
})();
t("the send button is in the source", () => sendButton !== null);
t("and will not let a reply be sent into nowhere",
  () => sendButton !== null && /reach\?\.by === "none"/.test(sendButton));
/* A NOTE IS NOT A REPLY. It goes to the team and needs nobody's number --
   stopping that too would take away the one thing still possible on a
   request nobody can answer. */
t("but a note can still be written",
  () => sendButton !== null
    && /mode === "reply" && reach\?\.by === "none"/.test(sendButton));

let bad = 0;
for (const [name, ok, why] of results) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${why ? ` — ${why}` : ""}`);
  if (!ok) bad++;
}
if (bad) { console.error(` ✗ ${bad} of ${results.length}`); process.exit(1); }
console.log("a reply knows where it is going, or says why it cannot go");
