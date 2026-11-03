import { DEFAULTS, type Terms } from "./papers";

/**
 * The terms we always use.
 *
 * Six investors in a row want the same late fee, the same grace period, the
 * same notice period, the same lot rent and the same lease. Until now every
 * one of those was re-chosen on every screen from a set of defaults written
 * into the code, which is how two investors end up with terms that differ
 * because somebody retyped one of them. This is the one place that answer
 * is written down.
 */

/**
 * What belongs to ONE investor and may never be part of the standard.
 *
 * A stored standard carrying a buyer's name would put that name on the next
 * investor's papers -- a contract naming the wrong purchaser, which reads
 * exactly like a contract. The date it was agreed and the date the lease
 * runs from belong to one sale, and the park belongs to the homes.
 *
 * Stripped when it is SAVED, so the row can never hold any of it, and
 * stripped again when it is APPLIED, so a row written before this list grew
 * -- or by hand in the SQL editor -- still cannot reach a document.
 */
export const DEAL_ONLY = [
  "buyer", "agreedOn", "leaseFrom", "parkName",
] as const satisfies readonly (keyof Terms)[];

/** Everything on a Terms that is not one deal's. */
export function houseStandard(t: Partial<Terms>): Partial<Terms> {
  const out: Record<string, unknown> = { ...t };
  for (const k of DEAL_ONLY) delete out[k];
  return out as Partial<Terms>;
}

/**
 * The standard laid over a set of terms.
 *
 * Only keys the standard actually carries are written, so a standard saved
 * before a switch existed leaves that switch at whatever it was rather than
 * blanking it -- the same reason `changes` on a template is a Partial.
 */
export function applyHouse(base: Terms, house: Partial<Terms> | null): Terms {
  if (!house) return base;
  const safe = houseStandard(house);
  const out = { ...base };
  for (const [k, v] of Object.entries(safe)) {
    if (v === undefined) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** What a screen with no standard saved starts from. */
export const NO_STANDARD: Terms = DEFAULTS;
