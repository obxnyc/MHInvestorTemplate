/**
 * A send that failed must not look like a send that worked.
 *
 * Dragging a photo into a team chat and pressing enter emptied the
 * composer, dropped the thumbnail, and showed no message. The send fired
 * the request and never read the answer: whatever came back -- that the
 * attachment is not this thread's, that ten is the limit, that the
 * attachment could not be kept because migration 027 has not been run --
 * the words were cleared and the picture was cleared, and a refusal was
 * indistinguishable from a success.
 *
 * Worse, the route's own fallback for the missing column dropped the
 * attachment and inserted the words. With no words that is an empty row:
 * a message nobody can see, reported as sent.
 *
 *     node lib/__fixtures__/send-check.mjs
 *
 * The first half states the contract runnably: a composer shaped like
 * DmPane's, against a stand-in server. It is a MODEL of the send, not
 * the send -- changing DmPane does not change it, and it will not catch
 * a regression there on its own. It is here because the contract is
 * easier to read as code than as prose.
 *
 * The teeth for the real file are the source rules at the bottom, and
 * each of those was confirmed by breaking DmPane and watching it fail.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const t = (name, ok, why) => checks.push([name, ok, why]);

/** The composer, as DmPane has it: words, files, and what it shows. */
function composer(server) {
  const state = { text: "hello", files: ["dm/t1/a/0-photo.jpg"], problem: null,
                  sent: 0 };
  return {
    state,
    async send() {
      state.problem = null;
      const res = await server({ body: state.text, media: state.files });
      if (!res.ok) { state.problem = res.error ?? "That didn't send. Try again."; return; }
      state.text = "";
      state.files = [];
      state.sent += 1;
      if (res.warning) state.problem = res.warning;
    },
  };
}

// --- a refusal keeps the message AND the picture -----------------------
{
  const c = composer(async () => ({ ok: false, error: "that attachment isn't this thread's" }));
  await c.send();
  t("a refused send keeps the words", c.state.text === "hello");
  t("and keeps the picture", c.state.files.length === 1,
    "Losing both to a failure means typing it again and finding it again.");
  t("and says why", c.state.problem === "that attachment isn't this thread's");
  t("and does not count as sent", c.state.sent === 0);
}

// --- a server that cannot be reached at all ----------------------------
{
  const c = composer(async () => ({ ok: false, error: null }));
  await c.send();
  t("a send with no answer still says something",
    typeof c.state.problem === "string" && c.state.problem.length > 0);
  t("and still keeps both", c.state.text === "hello" && c.state.files.length === 1);
}

// --- a success clears, and a warning is still shown --------------------
{
  const c = composer(async () => ({ ok: true, warning: null }));
  await c.send();
  t("a send that worked empties the composer",
    c.state.text === "" && c.state.files.length === 0 && c.state.sent === 1);
  t("and says nothing", c.state.problem === null);
}
{
  const c = composer(async () => ({
    ok: true, warning: "Sent, but without the attachment — migration 027 hasn't been run yet." }));
  await c.send();
  t("a send that lost the attachment says so",
    /without the attachment/.test(c.state.problem ?? ""),
    "The route has always said this. Nothing was listening.");
  t("but still counts as sent", c.state.sent === 1);
}

// --- the rules the behaviour rests on ----------------------------------
const pane = readFileSync(join(here, "../components/DmPane.tsx"), "utf8");
const route = readFileSync(
  join(here, "..", "app", "api", "team", "[id]", "route.ts"), "utf8");

t("the send reads the answer",
  /if \(!res \|\| !res\.ok\) \{/.test(pane),
  "A fetch whose result is discarded makes every refusal silent.");

// Ordering, by position rather than by pattern: the composer may not be
// emptied before the answer has been read. Written as "which comes
// first" because a regex for "setText before the fetch" matched neither
// `const res = await fetch` nor any of the other ways to write it.
{
  const readsIt = pane.indexOf("if (!res || !res.ok) {");
  const clearsText = pane.indexOf('setText("");', pane.indexOf("async function send"));
  const clearsFiles = pane.indexOf("files.clear();", pane.indexOf("async function send"));
  t("and clears nothing until the server has taken it",
    readsIt > 0 && clearsText > readsIt && clearsFiles > readsIt,
    "Clearing before the answer loses the words and the picture to a "
    + "failure -- which is exactly what it looked like from the outside.");
}

t("a refused send stops there",
  /files\.setProblem\(out\.error \?\? "That didn't send\. Try again\."\);\s*\n\s*return;/
    .test(pane),
  "Falling through past the refusal clears the composer anyway, which "
  + "is the bug with an error message on top of it.");

t("and puts the warning on screen",
  /if \(out\.warning\) files\.setProblem\(out\.warning\);/.test(pane));

t("a picture with no words is not sent without the picture",
  /if \(!text\) \{\s*\n\s*return NextResponse\.json\(\{/.test(route)
  && /That attachment can't be kept yet/.test(route)
  && /}, \{ status: 400 }\);/.test(route),
  "Dropping the attachment and inserting the words leaves an empty row: "
  + "a message nobody can see, reported as sent.");

t("the attachment is still checked against this thread",
  /belongsToThread\(p, id\)/.test(route),
  "Naming another thread's folder would copy a colleague's private "
  + "attachment into a thread they are not in.");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : "\nnothing obviously wrong");
process.exit(failed ? 1 : 0);
