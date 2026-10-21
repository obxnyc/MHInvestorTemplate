/**
 * Is somebody actually on the property?
 *
 * The question the clock-in screen has to answer, across hundreds of single
 * family houses and a handful of parks. And the whole difficulty is that a
 * phone does not answer it -- it answers a different question, with an error
 * bar, and treating the two as the same is how a labourer standing in a
 * kitchen gets marked as not on site.
 *
 * THE FIX CARRIES AN ERROR BAR AND SO MUST THE ANSWER. A browser's position
 * comes with an accuracy in metres: the radius it is about 68% sure the
 * handset is inside. Indoors, that is routinely 50 to 200 metres, and on a
 * cold start it can be a kilometre. A seventy-five-metre fence tested with
 * `distance <= radius` against a fix accurate to two hundred metres is not
 * answering the question, it is reading noise -- confidently, and with
 * somebody's wages on the other end of it.
 *
 * So there are three answers and not two. Inside, outside, and CANNOT TELL --
 * and the third is the common one, not the edge case. This is the same shape
 * as the property line that only ever said whether a line existed: a screen
 * that reports a state by testing whether a number is under another number
 * answers a narrower question than the one being asked, and answers it
 * confidently.
 *
 * Nothing here refuses anybody anything. A clock-in off site is recorded as
 * off site and goes through, because a labourer who cannot clock in because
 * the GPS is poor has no record of their hours at all -- which is worse for
 * them, worse for the office, and worse in front of a wage claim.
 */

export type Fix = {
  lat: number;
  lng: number;
  /** Metres, as the browser gives it. Null when the device did not say, which
   *  is itself a reason to answer "cannot tell" rather than to assume zero. */
  accuracy: number | null;
};

export type Fence = {
  propertyId: string;
  name: string;
  lat: number;
  lng: number;
  /** Metres from the pin. Not a drawn boundary: there are hundreds of houses
   *  and nobody is going to trace hundreds of outlines, so the pin and a
   *  radius is the thing that actually gets filled in. */
  radius: number;
};

export type Verdict = "inside" | "outside" | "unsure";

export type Reading = {
  verdict: Verdict;
  /** Metres from the pin, for the office to read. */
  metres: number;
  /** Why it could not tell, when it could not. */
  because?: string;
};

/** A fix this vague says nothing about a site a few dozen metres across, and
 *  pretending otherwise is the bug this file exists for. */
export const TOO_VAGUE = 500;

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Metres between two points on the earth. */
export function metresBetween(
  a: { lat: number; lng: number }, b: { lat: number; lng: number },
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Where this fix puts somebody relative to one fence.
 *
 * Inside only when the whole error circle is inside the fence. Outside only
 * when the whole error circle is outside it. Anything else is unsure, which
 * is most of the time on a phone indoors, and saying so is the point.
 */
export function readFix(fix: Fix | null, fence: Fence): Reading {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) {
    return { verdict: "unsure", metres: NaN, because: "the phone gave no position" };
  }
  const metres = metresBetween(fix, fence);

  // No accuracy at all is not accuracy of zero. A device that did not say how
  // sure it is has not told us it is certain.
  if (fix.accuracy === null || !Number.isFinite(fix.accuracy)) {
    return { verdict: "unsure", metres,
             because: "the phone did not say how accurate the position is" };
  }
  if (fix.accuracy > TOO_VAGUE) {
    return { verdict: "unsure", metres,
             because: `the position is only accurate to ${Math.round(fix.accuracy)}m` };
  }

  if (metres + fix.accuracy <= fence.radius) return { verdict: "inside", metres };
  if (metres - fix.accuracy > fence.radius) return { verdict: "outside", metres };

  return { verdict: "unsure", metres,
           because: `${Math.round(metres)}m from the pin, give or take`
             + ` ${Math.round(fix.accuracy)}m` };
}

export type Where = {
  fence: Fence;
  reading: Reading;
};

/**
 * Which property somebody is on, for tagging the hours to.
 *
 * Only ever one, and only when nothing else is in the running. Two fences
 * that both say inside -- two houses on the same street, a fence drawn too
 * wide -- is not a reason to pick the nearer one: picking wrong files a day's
 * labour against the wrong property, and an unfiled day is recoverable where
 * a misfiled one is not. The same rule `unitFromHint` already applies to a
 * lot number that exists in two parks.
 */
export function whichSite(fix: Fix | null, fences: Fence[]): {
  on: Where | null;
  /** Everything the fix could not rule out, nearest first. Shown so somebody
   *  can say which one it was. */
  maybe: Where[];
} {
  const read = fences
    .map((fence) => ({ fence, reading: readFix(fix, fence) }))
    .filter((w) => w.reading.verdict !== "outside")
    .sort((a, b) => a.reading.metres - b.reading.metres);

  const inside = read.filter((w) => w.reading.verdict === "inside");
  return { on: inside.length === 1 ? inside[0] : null, maybe: read };
}

/** The radius to give a property that has not had one set.
 *
 *  A house is its lot and a few steps of pavement. A park is a field with
 *  fifty homes in it and a road round the outside, so the same number would
 *  put half of it outside its own fence. */
/** Every kind in `lib/property.ts`, and no kinds that are not. The first
 *  version of this listed a `quad` and an `apartment`, which this codebase
 *  has never had, and left out `mh`, `multi` and `lot`, which it does -- so
 *  three real kinds would have fallen through to a default that happens to be
 *  wrong for all three. The harness checks the two lists against each other
 *  rather than trusting either. */
export const DEFAULT_RADIUS: Record<string, number> = {
  sfh: 75,          // a house and a few steps of pavement
  mh: 75,           // a single home on its own land, same thing
  duplex: 75,
  triplex: 90,
  multi: 120,       // a building with a car park round it
  mhp: 250,         // a field with fifty homes and a road round the outside
  lot: 90,          // bare land, and the pin is somewhere in the middle of it
};

export function defaultRadius(kind: string | null | undefined): number {
  return DEFAULT_RADIUS[kind ?? ""] ?? 100;
}
