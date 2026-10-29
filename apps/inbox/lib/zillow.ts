import type { Read, Reading, Wanted } from "./wanted";

/**
 * The answers Zillow already has.
 *
 * A Zillow rental enquiry is not a sentence somebody typed. Zillow asks the
 * renter a form -- when they want to move, how many bedrooms, pets or not --
 * and puts the answers in the notification under a heading that reads
 * "About <their name>". Every one of those is a STATED answer, which is the
 * only kind this business is allowed to segment on, and all of them were
 * being thrown away: the enquiry was read as prose instead, and the prose is
 * "I would like to schedule a tour", which states nothing.
 *
 * So an enquiry carrying the answers arrived with an empty record, and the
 * three bedrooms under nine hundred existed as a sentence somebody would have
 * to read again -- the same fault `inquiries` was built to end, one source
 * further up.
 *
 * READING IT AS PROSE DID NOT FAIL QUIETLY, WHICH IS WORSE. The stripped
 * notification puts the income directly above the pets answer:
 *
 *     Income
 *     $75000
 *     Pets
 *     No
 *
 * and the pet rule matched the words "75000 Pets" and recorded hasPets TRUE
 * on a renter who had answered No. Not a blank -- the opposite of what they
 * said, with provenance that looked like a reading. A lot that takes no pets
 * would have been kept from the one person on the board who had said they
 * have none.
 *
 * WHAT IS READ AND WHAT IS REFUSED. Three of Zillow's answers map onto the
 * columns this business segments on: bedrooms, the move-in date, and pets.
 * The rest -- income, credit score, number of occupants -- are NOT stated
 * preferences and are never written to those columns:
 *
 *   Number of Occupants is household size. The oldest rule in `wanted.ts` is
 *   that a number of people is not a number of bedrooms, because putting one
 *   in a column we segment on is a familial-status fact filed as a
 *   preference. Zillow hands both over, and in the enquiry this was built
 *   from they were the SAME NUMBER -- two bedrooms, two occupants -- so a
 *   reader that confused them could not be caught by that message at all.
 *   The fixture gives them different numbers for exactly that reason.
 *
 *   Income and credit score are screening facts. The hazard is specific and
 *   it is not abstract: income is the figure somebody would helpfully type
 *   into the price box, and $75,000 a year in the rent ceiling matches every
 *   lot we own. Both are refused by name, with the reason on screen, because
 *   a blank is what invites somebody to fill it in.
 *
 * The facts themselves are not hidden -- they are in the thread, which is
 * where the office reads them. They are simply not what we match on.
 */

/** Every label Zillow uses in that block. The list is the whole guard in
 *  `valueFor`: a value runs to the next LABEL, so one of them cannot swallow
 *  the rest of the block. */
const LABELS = [
  "Move in", "Credit score", "Income", "Pets", "Lease Length",
  "Number of Bedrooms", "Number of Occupants",
] as const;

const isLabel = (line: string) =>
  LABELS.some((l) => l.toLowerCase() === line.trim().toLowerCase());

/**
 * The value under a label.
 *
 * Zillow's own template puts the label on one line and the answer on the
 * next, with no colon and no blank line between them, and the labels are
 * Title Case rather than capitals. `blockAfter` in parse-email.ts reads the
 * other Zillow template, where a value ends at a blank line or the next
 * ALL-CAPS label -- neither of which is true here, so it ran from "Pets" to
 * the end of the message and produced
 *
 *     pets: No Lease Length 18 months Number of Bedrooms 2 ...
 *
 * on the summary line the office reads first. Ending a value at the next
 * known label is what stops that.
 */
function valueFor(lines: string[], label: string): string | null {
  const want = label.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() !== want) continue;
    const out: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (!l) break;
      if (isLabel(l)) break;
      out.push(l);
    }
    const v = out.join(" ").trim();
    // "Not answered" is Zillow's own words for a question the renter skipped.
    // An unanswered question is not an answer, and must not read as one.
    if (!v || /^not answered$/i.test(v)) return null;
    return v;
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun",
                "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * "Nov 02, 2026" to 2026-11-02.
 *
 * A month and a year with no day in it -- "November 2026", which Zillow sends
 * when somebody picks a month rather than a date -- is NOT turned into the
 * first of the month. That would be a date this business plans around that
 * nobody ever gave us. It is refused, and the refusal says so.
 */
function moveIn(v: string): { on: string } | { why: string } {
  const m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(v.trim());
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    const d = Number(m[2]);
    if (mi >= 0 && d >= 1 && d <= 31) {
      return { on: `${m[3]}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
    }
  }
  // An ISO date, in case Zillow ever sends one.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (iso) return { on: v.trim() };
  return { why: `Zillow said "${v}", which is not a date we can put a day on.` };
}

export type ZillowForm = {
  /** Every answer Zillow gave, in the order Zillow asks them, for the screen.
   *  Nothing is dropped here -- this is what the office reads. */
  facts: { label: string; value: string }[];
  /** The three that are stated preferences, with provenance, plus the refusals. */
  reading: Reading;
  /** Whether the "About <renter>" block was there at all. A notification
   *  without one is not a fault: Zillow leaves it out on follow-up messages. */
  found: boolean;
};

/**
 * Read the enquiry form out of a stripped Zillow notification.
 *
 * `text` is the chrome-stripped notification body. Nothing here guesses: a
 * label that is absent, or answered "Not answered", leaves its field unset.
 */
export function readZillowForm(text: string): ZillowForm {
  const lines = (text ?? "").split(/\r?\n/);
  const facts: { label: string; value: string }[] = [];
  const wanted: Wanted = {};
  const read: Partial<Read> = {};
  const declined: { field: string; because: string }[] = [];

  const at = (label: string) => {
    const i = text.toLowerCase().indexOf(label.toLowerCase());
    return i < 0 ? 0 : i;
  };
  const got: Partial<Record<(typeof LABELS)[number], string>> = {};
  for (const label of LABELS) {
    const v = valueFor(lines, label);
    if (v === null) continue;
    got[label] = v;
    facts.push({ label, value: v });
  }

  /* ---- the three that are stated preferences ---- */

  const beds = got["Number of Bedrooms"];
  if (beds) {
    const n = Number(/^\d{1,2}/.exec(beds)?.[0]);
    if (Number.isFinite(n) && n >= 0 && n <= 20) {
      wanted.bedroomsMin = n;
      read.bedroomsMin = { from: `Number of Bedrooms: ${beds} (Zillow enquiry form)`,
                           at: at("Number of Bedrooms") };
    }
  }

  const when = got["Move in"];
  if (when) {
    const r = moveIn(when);
    if ("on" in r) {
      wanted.moveInFrom = r.on;
      read.moveInFrom = { from: `Move in: ${when} (Zillow enquiry form)`, at: at("Move in") };
    } else {
      declined.push({ field: "moveInFrom", because: r.why });
    }
  }

  const pets = got["Pets"];
  if (pets) {
    // Zillow's own answers are "Yes" and "No". Anything else is left alone
    // rather than guessed at -- an assistance animal is not a pet, and the
    // word for it does not appear in this box.
    if (/^no\b/i.test(pets)) {
      wanted.hasPets = false;
      read.hasPets = { from: `Pets: ${pets} (Zillow enquiry form)`, at: at("Pets") };
    } else if (/^yes\b/i.test(pets)) {
      wanted.hasPets = true;
      read.hasPets = { from: `Pets: ${pets} (Zillow enquiry form)`, at: at("Pets") };
    }
  }

  /* ---- the ones that are refused, each with the reason on screen ---- */

  if (got["Number of Occupants"]) {
    declined.push({
      field: "bedroomsMin",
      because: `Zillow says ${got["Number of Occupants"]} occupants. That is the size of`
        + " the household, not a number of bedrooms, and it is not something we"
        + " record or match on.",
    });
  }
  if (got["Income"] || got["Credit score"]) {
    const both = [got["Income"] && `income ${got["Income"]}`,
                  got["Credit score"] && `credit score ${got["Credit score"]}`]
      .filter(Boolean).join(" and ");
    declined.push({
      field: "priceCeiling",
      because: `Zillow passed on ${both}. Neither is a rent they said they would pay,`
        + " so neither is recorded as one.",
    });
  }

  return { facts, reading: { wanted, read, declined }, found: facts.length > 0 };
}

/** The facts worth putting on the summary line, in the words the office uses.
 *  Short on purpose: the full list is in the thread. */
export function saysOnOneLine(form: ZillowForm): string[] {
  const out: string[] = [];
  const w = form.reading.wanted;
  if (w.bedroomsMin !== undefined) out.push(`${w.bedroomsMin} bed`);
  if (w.hasPets === false) out.push("no pets");
  if (w.hasPets === true) out.push("has pets");
  if (w.moveInFrom) out.push(`move in ${w.moveInFrom}`);
  const lease = form.facts.find((f) => f.label === "Lease Length");
  if (lease) out.push(`${lease.value} lease`);
  return out;
}
