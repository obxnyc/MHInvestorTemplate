/**
 * An afternoon of placing homes cannot be lost.
 *
 * Fifty-nine homes put down one tap at a time is an afternoon, and the
 * layout they make lives in an eight-hundred-millisecond debounce. Two
 * paths out of that debounce were missing and both are silent:
 *
 *   - re-reading the park from the server while a layout is still
 *     waiting overwrites it with the older copy -- and the very next
 *     thing anybody does after placing the homes is press Add lots,
 *     which re-reads;
 *   - closing the tab inside the debounce never sent it at all.
 *
 * Neither fails. Neither says anything. The park simply comes back the
 * way it was before the afternoon.
 *
 *     node lib/__fixtures__/keep-check.mjs
 *
 * The first half of this runs the real debounce against a stand-in
 * server, so it is the behaviour being checked and not the shape of the
 * source. The rest is the rules that behaviour depends on.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const t = (name, ok, why) => checks.push([name, ok, why]);

/**
 * The saving path, as the screen has it: a debounce, a note of what is
 * still owed, and a flush that anything about to re-read must await.
 */
function saver(write, wait = 800) {
  let timer = null;
  let owed = null;
  return {
    remember(plan) {
      owed = plan;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; const p = owed; owed = null; void write(p); }, wait);
    },
    async flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      const p = owed;
      owed = null;
      if (p) await write(p);
    },
    owes: () => owed,
  };
}

// --- the race, run ------------------------------------------------------
{
  let onServer = { rows: ["as it was"] };
  const write = async (plan) => { await null; onServer = plan; };
  const s = saver(write, 30);

  // An afternoon: fifty-nine homes, each one resetting the debounce.
  for (let i = 1; i <= 59; i++) {
    s.remember({ rows: Array.from({ length: i }, (_, k) => `home ${k + 1}`) });
  }

  // And then Add lots, which re-reads the park. Without the flush this
  // is where the afternoon goes.
  const reload = async () => { await s.flush(); return onServer; };
  const back = await reload();
  t("re-reading right after the last home keeps all fifty-nine",
    back.rows.length === 59,
    `came back with ${back.rows.length}`);
  t("and nothing is left owed", s.owes() === null);
}

{
  // The same sequence WITHOUT the flush, to show the check is looking at
  // something real rather than at an arrangement that cannot fail.
  let onServer = { rows: ["as it was"] };
  const write = async (plan) => { await null; onServer = plan; };
  const s = saver(write, 30);
  for (let i = 1; i <= 59; i++) {
    s.remember({ rows: Array.from({ length: i }, (_, k) => `home ${k + 1}`) });
  }
  const back = onServer;          // re-read with no flush
  t("without the flush the afternoon really is lost",
    back.rows.length === 1 && back.rows[0] === "as it was",
    "If this passes with the homes intact, the race above is not being "
    + "tested and the check means nothing.");
}

{
  // A write that fails has to be visible, not swallowed.
  let tries = 0;
  const write = async () => { tries += 1; throw new Error("offline"); };
  const s = saver(write, 10);
  s.remember({ rows: ["one"] });
  let threw = false;
  try { await s.flush(); } catch { threw = true; }
  t("a failed write is not silently dropped", tries === 1 && threw,
    "The screen catches this one and says so; the saver must at least "
    + "have tried exactly once.");
}

// --- the rules the behaviour rests on ----------------------------------
const screen = readFileSync(join(here, "../components/ParkScreen.tsx"), "utf8");

t("re-reading the park flushes what is owed first",
  /const load = useCallback\(async \(\) => \{[\s\S]{0,400}?await flush\(\);/.test(screen),
  "load() replaces the layout on screen with the server's, and a layout "
  + "still in the debounce is the newer of the two.");

t("and flush is in load's dependencies",
  /\}, \[propertyId, key, flush\]\);/.test(screen),
  "A stale flush closed over an old plan writes the old plan.");

t("closing the tab sends what is owed",
  /window\.addEventListener\("pagehide", go\);/.test(screen)
  && /keepalive: leaving,/.test(screen),
  "`pagehide` fires on a phone where `beforeunload` does not, and a "
  + "fetch started as the tab closes needs keepalive to be sent at all.");

t("leaving the screen sends it too",
  /return \(\) => \{ window\.removeEventListener\("pagehide", go\); go\(\); \};/
    .test(screen),
  "Navigating inside the app unmounts the screen without ever firing "
  + "pagehide.");

t("what is owed is held where both paths can reach it",
  /const unsaved = useRef<Plan \| null>\(null\);/.test(screen)
  && /unsaved\.current = next;/.test(screen),
  "A plan captured only inside the timer's closure cannot be flushed "
  + "by anything else.");

t("the screen says whether it is saved",
  /kept === "saving" \? "Saving…" : kept === "saved" \? "Saved"/.test(screen),
  "Silence and success look identical, and the one time they are not "
  + "the same is the time it matters.");

t("and offers a way back from a failed write",
  /onClick=\{\(\) => void writePlan\(plan\)\}/.test(screen),
  "Told it did not save and given nothing to press is worse than not "
  + "being told.");

t("the indicator does not borrow a state name",
  /className=\{`parkkept\$\{kept === "failed" \? " bad" : ""\}`\}/.test(screen),
  "`.check`, `.empty` and `.danger` have each been borrowed here and "
  + "each cost a round.");

let failed = 0;
for (const [name, ok, why] of checks) {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
  if (!ok) { console.log(`        ${why ?? ""}`); failed += 1; }
}
console.log(failed ? `\n${failed} of ${checks.length} wrong`
                   : "\nnothing obviously wrong");
process.exit(failed ? 1 : 0);
