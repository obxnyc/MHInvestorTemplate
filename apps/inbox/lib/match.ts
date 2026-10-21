import type { Wanted } from "./wanted";

/**
 * Which empty lots fit what somebody said they wanted.
 *
 * This is the one join that turns an inquiry record into money: a lot comes
 * free and the question is who has been waiting for exactly that. Up to now
 * the answer lived in whoever happened to remember a phone call.
 *
 * The rule that decides the whole file: matching reads STATED PREFERENCES AND
 * NOTHING ELSE. Five fields, every one of them something the person typed or
 * said. Not the party on their contact record, not how long they have been
 * waiting, not what they earn, not anything a model inferred. A list of who
 * to ring that was ordered by anything else is a fair-housing claim with a
 * timestamp on it, and this is exactly the screen somebody would subpoena.
 *
 * Silence is not a constraint. Somebody who never said a number of bedrooms
 * has not asked for one bedroom; they have said nothing, and every lot still
 * fits. The opposite reading -- treating a blank as a zero or as a one -- is
 * how a quiet caller ends up matched to nothing at all.
 */

export type Lot = {
  id: string;
  label: string;
  property: string;
  /** Rent in dollars a month, or null when nobody has set one. */
  rent: number | null;
  bedrooms: number | null;
  area?: string | null;
  availableOn?: string | null;
};

export type Fit = {
  lot: Lot;
  /** Every stated preference this lot satisfies, in words. */
  because: string[];
  /** A stated preference this lot cannot answer, and why. Never a reason to
   *  hide the lot -- a near miss is worth a phone call and is said as one. */
  against: string[];
};

const near = (a: number, b: number, by: number) => a <= b * (1 + by);

/**
 * Score one lot against one inquiry.
 *
 * Returns null only when a lot contradicts something stated outright -- too
 * few bedrooms, or rent above a ceiling by more than a tenth. A tenth is
 * deliberate: a caller who said nine hundred will look at nine fifty, and
 * hiding it means never making the call.
 */
export function fit(lot: Lot, wanted: Wanted): Fit | null {
  const because: string[] = [];
  const against: string[] = [];

  if (wanted.bedroomsMin !== undefined && wanted.bedroomsMin !== null) {
    // A lot with no bedroom count on file is not refused by one. It is
    // unknown, and an unknown is a thing to go and look up rather than a
    // reason to drop the only lot that might have fitted.
    if (lot.bedrooms === null) {
      against.push(`bedrooms not recorded, wanted ${wanted.bedroomsMin}+`);
    } else if (lot.bedrooms < wanted.bedroomsMin) {
      return null;
    } else {
      because.push(`${lot.bedrooms} bed, wanted ${wanted.bedroomsMin}+`);
    }
  }

  if (wanted.priceCeiling !== undefined && wanted.priceCeiling !== null) {
    if (lot.rent === null) {
      against.push(`no rent set, wanted up to $${wanted.priceCeiling}`);
    } else if (lot.rent <= wanted.priceCeiling) {
      because.push(`$${lot.rent}, wanted up to $${wanted.priceCeiling}`);
    } else if (near(lot.rent, wanted.priceCeiling, 0.1)) {
      against.push(`$${lot.rent}, a little over the $${wanted.priceCeiling} they said`);
    } else {
      return null;
    }
  }

  if (wanted.area) {
    const where = `${lot.property} ${lot.area ?? ""}`.toLowerCase();
    if (where.includes(wanted.area.toLowerCase())) because.push(wanted.area);
    else against.push(`not ${wanted.area}`);
  }

  if (wanted.moveInFrom && lot.availableOn && lot.availableOn > wanted.moveInFrom) {
    against.push(`free ${lot.availableOn}, they wanted ${wanted.moveInFrom}`);
  }

  return { lot, because, against };
}

/**
 * The lots to ring somebody about, best first.
 *
 * Ordered by how much of what they asked for is answered, and ties broken by
 * the cheaper rent -- not by anything about the person. Lots that contradict
 * something they said outright are not in the list at all.
 */
export function matches(lots: Lot[], wanted: Wanted): Fit[] {
  const out: Fit[] = [];
  for (const lot of lots) {
    const f = fit(lot, wanted);
    if (f) out.push(f);
  }
  return out.sort((a, b) =>
    (a.against.length - b.against.length)
    || (b.because.length - a.because.length)
    || ((a.lot.rent ?? Infinity) - (b.lot.rent ?? Infinity))
    || a.lot.label.localeCompare(b.lot.label));
}

/** Said nothing at all, so every lot fits and the screen should say that
 *  rather than presenting a hundred lots as a shortlist. */
export function saidNothing(wanted: Wanted): boolean {
  return wanted.bedroomsMin === undefined && wanted.priceCeiling === undefined
      && !wanted.area && wanted.hasPets === undefined && !wanted.moveInFrom;
}
