/** What this kind of work has cost before.
 *
 *  Written for the person in the office holding an invoice they have no way to
 *  judge. The useful answer is not an average -- one emergency call-out at
 *  triple rate drags a mean somewhere nobody has ever actually paid. It is the
 *  middle of what was paid, the range around it, and enough recent examples to
 *  see whether the number in front of them belongs.
 */

export type PricePoint = {
  cents: number;
  on: string | null;
  what: string;
  who: string | null;
};

export type Benchmark = {
  count: number;
  low: number;
  median: number;
  high: number;
  recent: PricePoint[];
  /** Whether any of it is recent enough to quote out loud. */
  stale: boolean;
};

const YEAR = 365 * 864e5;

export function benchmark(points: PricePoint[], now = Date.now()): Benchmark | null {
  const usable = points.filter((p) => Number.isFinite(p.cents) && p.cents > 0);
  if (!usable.length) return null;

  const sorted = [...usable].sort((a, b) => a.cents - b.cents);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[mid].cents
    : Math.round((sorted[mid - 1].cents + sorted[mid].cents) / 2);

  const recent = [...usable]
    .sort((a, b) => (b.on ?? "").localeCompare(a.on ?? ""))
    .slice(0, 5);

  // Two years, not one: a mobile-home park replaces a given part rarely enough
  // that a twelve-month window would call almost everything stale and teach
  // people to ignore the warning.
  const newest = recent[0]?.on ? new Date(recent[0].on).getTime() : 0;
  const stale = !newest || now - newest > 2 * YEAR;

  return {
    count: usable.length,
    low: sorted[0].cents,
    median,
    high: sorted[sorted.length - 1].cents,
    recent,
    stale,
  };
}

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return (cents / 100).toLocaleString("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

/** "$450" and "450" and "$1,250.00" are all things a person types into a box
 *  labelled with a dollar sign. All three mean the same amount. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
