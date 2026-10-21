import { spell, worrying, STALE } from "./empty";
import { matches, saidNothing } from "./match";
import type { Lot } from "./match";
import type { Wanted } from "./wanted";

/**
 * Where the money is going, and where there is more of it.
 *
 * The dashboard could already say twelve lots are empty and what that costs a
 * month. What it could not say is which of those twelve nobody is working on,
 * how much the spell has cost so far, who is waiting for one of them right
 * now, or which of the figures on the screen are understated and by how many
 * rows.
 *
 * Three rules run through all of it, and each is a bug this codebase has
 * already shipped once.
 *
 * A FIGURE BUILT ON A GUESS IS NOT A FIGURE. A backfilled vacancy date is an
 * estimate, and an estimate multiplied by a rent is a number somebody puts in
 * front of an investor. The measured spells are totalled; the rest are
 * counted and named as outside the total.
 *
 * A TOTAL THAT IS SHORT SAYS SO. Six empty lots with no rent on file do not
 * appear in the lost-rent figure at all, which makes the leak look smaller
 * than it is -- and the smaller it looks the longer it stays. Every total
 * carries how many rows it could not count.
 *
 * AND A COUNT IS NOT MONEY. Where the amount is genuinely unknown -- work
 * done with no cost recorded -- it is reported as unknown rather than
 * guessed at, because a made-up number in an accounting figure is worse than
 * a gap somebody can see.
 */

export type EmptyRow = Lot & {
  vacantSince: string | null;
  vacantSinceEstimated: boolean;
  blocker: string | null;
};

export type JobRow = { id: string; completedAt: string | null; costCents: number | null };
export type InvoiceRow = { id: string; amountCents: number; emailedAt: string | null };
export type LookingRow = { id: string; wanted: Wanted };

export type Leak = {
  key: string;
  /** The sentence on the screen. */
  says: string;
  /** How many rows this is about. */
  count: number;
  /** Dollars a month, when that is knowable. */
  perMonth?: number;
  /** Dollars already gone, when that is knowable AND measured. */
  gone?: number;
  /** Rows this total could not count, and why. Printed, never swallowed. */
  short?: { count: number; because: string };
  /** Where to go and do something about it. */
  go?: { href: string; said: string };
  /** True when this is money to be had rather than money going out. */
  upside?: boolean;
};

const dollars = (cents: number) => Math.round(cents / 100);
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export type Ground = {
  empty: EmptyRow[];
  looking: LookingRow[];
  jobs: JobRow[];
  invoices: InvoiceRow[];
  today?: Date;
};

export function leaks(g: Ground): Leak[] {
  const out: Leak[] = [];
  const today = g.today;

  /* ----------------------------------------------------------- empty lots */
  if (g.empty.length) {
    const priced = g.empty.filter((l) => l.rent !== null && l.rent > 0);
    const perMonth = priced.reduce((a, l) => a + (l.rent ?? 0), 0);

    // Only measured spells. A backfilled date is a guess and a guess times a
    // rent is a figure, and a figure gets planned around.
    const measured = priced.filter((l) => l.vacantSince && !l.vacantSinceEstimated);
    const gone = Math.round(measured.reduce((a, l) => {
      const s = spell(l.vacantSince, { today });
      return a + (s ? (s.days / 30.44) * (l.rent ?? 0) : 0);
    }, 0));

    const unpriced = g.empty.length - priced.length;
    const guessed = priced.length - measured.length;

    out.push({
      key: "empty",
      count: g.empty.length,
      perMonth,
      gone: gone || undefined,
      says: `${g.empty.length} ${plural(g.empty.length, "lot")} empty`,
      short: unpriced
        ? { count: unpriced,
            because: `${unpriced} of them ${plural(unpriced, "has", "have")} no rent on file,`
              + " so the figure is low" }
        : guessed
        ? { count: guessed,
            because: `the spell on ${guessed} of them was carried over rather than`
              + " measured, so it is left out of what has gone already" }
        : undefined,
      go: { href: "/leasing", said: "See them, longest empty first" },
    });

    /* --------------------------------------- empty a long time, no reason */
    // Not a separate cost -- it is the same rent counted once. What it is, is
    // the list of lots nobody is working on, which is the only part of the
    // vacancy figure anybody can act on this week.
    const adrift = g.empty.filter((l) =>
      worrying(spell(l.vacantSince, { estimated: l.vacantSinceEstimated, today }))
      && !l.blocker?.trim());
    if (adrift.length) {
      out.push({
        key: "adrift",
        count: adrift.length,
        perMonth: adrift.reduce((a, l) => a + (l.rent ?? 0), 0),
        says: `${adrift.length} ${plural(adrift.length, "lot")} empty over ${STALE} days`
          + " with nothing said about what is stopping",
        go: { href: "/leasing", said: "Say what each one is waiting on" },
      });
    }
  }

  /* --------------------------------------------------- people who fit one */
  if (g.looking.length && g.empty.length) {
    const fits = g.looking
      .map((p) => ({ p, lots: saidNothing(p.wanted) ? [] : matches(g.empty, p.wanted) }))
      .filter((r) => r.lots.some((f) => !f.against.length));
    if (fits.length) {
      // What the best-fitting lot for each of them asks. Not the sum of every
      // lot that fits -- the same lot fits several people and one person
      // takes one home, so adding every pair would invent money twice over.
      const worth = fits.reduce((a, r) => {
        const clean = r.lots.filter((f) => !f.against.length);
        return a + (clean[0]?.lot.rent ?? 0);
      }, 0);
      out.push({
        key: "waiting",
        upside: true,
        count: fits.length,
        perMonth: worth,
        says: `${fits.length} ${plural(fits.length, "person", "people")} asked for`
          + " something we have empty right now",
        go: { href: "/leasing", said: "Ring them" },
      });
    }
  }

  /* ------------------------------------------------- work with no cost on it */
  const uncosted = g.jobs.filter((j) => j.completedAt && j.costCents === null);
  if (uncosted.length) {
    out.push({
      key: "uncosted",
      count: uncosted.length,
      // No perMonth. The amount is genuinely unknown, and inventing one here
      // would put a made-up figure into the only numbers anybody uses to
      // decide what a property costs to run.
      says: `${uncosted.length} finished ${plural(uncosted.length, "job")} with no cost`
        + " recorded, so that spend is not against any property",
      go: { href: "/jobs", said: "Put the costs on" },
    });
  }

  /* --------------------------------------------- invoices nobody sent on */
  const unsent = g.invoices.filter((i) => !i.emailedAt);
  if (unsent.length) {
    out.push({
      key: "unsent",
      count: unsent.length,
      perMonth: dollars(unsent.reduce((a, i) => a + i.amountCents, 0)),
      says: `${unsent.length} vendor ${plural(unsent.length, "invoice")} never sent`
        + " to the bookkeeper",
      go: { href: "/jobs", said: "Send them on" },
    });
  }

  // Money to be had first. It is the only line anybody can act on today, and
  // a list that opens with four things going wrong is a list that gets shut.
  return out.sort((a, b) => Number(!!b.upside) - Number(!!a.upside));
}
