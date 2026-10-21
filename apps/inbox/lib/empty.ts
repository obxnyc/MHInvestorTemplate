/**
 * How long a lot has been empty, said in words.
 *
 * The dashboard has always been able to say twelve lots are empty and seven
 * thousand a month is going uncollected. It could not say that one of them
 * went empty last week and another has been empty since July waiting on a
 * floor. Those two cost the same on the screen and are not the same problem,
 * and which of them is the common case is the difference between the
 * constraint being leasing and the constraint being the make-ready crew.
 *
 * `today` is a parameter, never the clock, so this can be checked.
 */

export type Spell = {
  days: number;
  /** True when the start date was carried over from before anything was
   *  measuring. Ninety-four days that is really a guess is worse than no
   *  number, because it gets planned around. */
  about: boolean;
};

const DAY = 864e5;

const asUtcDay = (iso: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

/**
 * The spell of vacancy, or null when there is no clock on this lot.
 *
 * Null is its own answer and is not zero. A lot with no start date has not
 * been empty for no time -- nobody has been counting, which is what the
 * screen has to say instead of drawing it as empty since this morning.
 */
export function spell(
  since: string | null | undefined,
  opts: { estimated?: boolean; today?: Date } = {},
): Spell | null {
  if (!since) return null;
  const start = asUtcDay(since);
  if (start === null) return null;

  const t = opts.today ?? new Date();
  const now = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());

  // A start date in the future is somebody typing next month's date into an
  // availability field, which happens. It is not a negative vacancy.
  const days = Math.max(0, Math.round((now - start) / DAY));
  return { days, about: !!opts.estimated };
}

/** "Empty 94 days", "Empty about 3 months", "Empty since today". */
export function howLong(s: Spell | null): string | null {
  if (!s) return null;
  const about = s.about ? "about " : "";
  if (s.days === 0) return s.about ? "Empty, start date unsure" : "Empty since today";
  if (s.days === 1) return `Empty ${about}1 day`;
  if (s.days < 60) return `Empty ${about}${s.days} days`;
  // Past two months the day count stops being the useful shape of the
  // answer, and nobody reads 418 as "over a year".
  const months = Math.round(s.days / 30.44);
  if (months < 18) return `Empty ${about}${months} months`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `Empty ${about}${years} year${years > 1 ? "s" : ""}`
    + (rest ? ` ${rest} month${rest > 1 ? "s" : ""}` : "");
}

/** Long enough that it is the problem rather than the process. */
export const STALE = 45;

export function worrying(s: Spell | null): boolean {
  return !!s && s.days >= STALE;
}

/**
 * The longest-empty first, and a lot with no clock last rather than first.
 *
 * Sorting on a null start date as though it were zero puts every lot nobody
 * has measured at the top of the list of problems, which buries the ones that
 * are really the problem.
 */
export function longestFirst<T>(
  rows: T[], of: (row: T) => Spell | null,
): T[] {
  return [...rows].sort((a, b) => {
    const x = of(a), y = of(b);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return y.days - x.days;
  });
}
