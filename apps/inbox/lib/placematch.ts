/**
 * Which house a Tenant Web Access subject line is talking about.
 *
 * THE BREAK THIS EXISTS FOR. The portfolio import writes a property's
 * address the way Rent Manager stores it, with the town on the end:
 *
 *     1002 Bartlett Ave, Elizabeth City, NC 27909
 *
 * and the notification email names the place the way the tenant's record
 * is titled, which is the street and nothing else:
 *
 *     New Issue Submitted from TWA: 1002 Bartlett Ave, 1002 Bartlett Ave
 *
 * `unitOfSingleHome` compared those two with `===` after normalising case
 * and punctuation. They are not equal and never will be, so every
 * single-family house in the portfolio would have failed to match -- not
 * occasionally, every one -- and the request would have filed against
 * nothing while the address sat in plain sight on both sides.
 *
 * It only ever worked at all because a park's property NAME happens to be
 * what the subject says. Houses are the case nobody had.
 *
 * WHAT THIS IS NOT. It is not fuzzy matching. A request filed against the
 * wrong house is worse than one filed against none -- somebody is sent to
 * a stranger's door -- so this answers with a house or with nothing, and
 * two houses that both fit is nothing. Every rule below either holds
 * exactly or does not count.
 */

/** Street types, every spelling Rent Manager and a person each use, to the
 *  one token they mean. Expanded rather than stripped: "Park Ave" and
 *  "Park Rd" are different streets and dropping the type merges them. */
const STREET_TYPE: Record<string, string> = {
  rd: "road", road: "road",
  st: "street", street: "street",
  ave: "avenue", av: "avenue", avenue: "avenue",
  dr: "drive", drive: "drive",
  ln: "lane", lane: "lane",
  ct: "court", court: "court",
  cir: "circle", circle: "circle",
  blvd: "boulevard", boulevard: "boulevard",
  hwy: "highway", highway: "highway",
  trl: "trail", trail: "trail",
  pkwy: "parkway", parkway: "parkway",
  pl: "place", place: "place",
  ter: "terrace", terrace: "terrace",
  way: "way", run: "run", loop: "loop", path: "path",
};

/** Compass words, likewise. "N Main" and "North Main" are one street. */
const DIRECTION: Record<string, string> = {
  n: "north", north: "north", s: "south", south: "south",
  e: "east", east: "east", w: "west", west: "west",
  ne: "northeast", northeast: "northeast",
  nw: "northwest", northwest: "northwest",
  se: "southeast", southeast: "southeast",
  sw: "southwest", southwest: "southwest",
};

/** Anything after the street line: the town, the state, the postcode.
 *
 *  Taken off by position rather than by recognising town names -- there is
 *  no list of those and inventing one is how "Lane County" stops being a
 *  street called Lane. The street is what comes before the first comma,
 *  which is true of every address Rent Manager produces. */
export function streetLine(address: string | null | undefined): string {
  return (address ?? "").split(",")[0]?.trim() ?? "";
}

/**
 * One street address, reduced to the words that identify it.
 *
 * Case, punctuation and runs of space go. Street types and compass words
 * are expanded to one spelling each. A unit marker goes, because
 * "1002 Bartlett Ave Apt B" is the same street address as "1002 Bartlett
 * Ave" and which flat it is belongs to the lot, not the street.
 */
export function addressKey(raw: string | null | undefined): string {
  const flat = (raw ?? "")
    .toLowerCase()
    /* A flat is named by a letter as often as by a number -- "Apt B" is
       the commonest form there is -- and a pattern that insists on a
       digit leaves it on the end of the street, where it stops the
       address matching itself. */
    .replace(/\b(?:apt|apartment|unit|ste|suite|lot|#)\s*(?:[a-z]?\d+[a-z]?|[a-z])\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!flat) return "";
  return flat.split(" ")
    .map((w) => STREET_TYPE[w] ?? DIRECTION[w] ?? w)
    .join(" ");
}

/** The house number a street address opens with, where it has one. */
export function houseNumber(raw: string | null | undefined): string | null {
  return /^\s*(\d+)\b/.exec(raw ?? "")?.[1] ?? null;
}

/**
 * The street's own name, without its number and without its type.
 *
 * "1002 Bartlett Avenue" is "bartlett". This is the loose half of the
 * match and is never used on its own -- only together with the house
 * number, because a number and a street name agreeing is a specific
 * claim and a street name alone is not.
 */
export function streetName(raw: string | null | undefined): string {
  const words = addressKey(raw).split(" ").filter(Boolean);
  const types = new Set(Object.values(STREET_TYPE));
  return words
    .filter((w, i) => !(i === 0 && /^\d+$/.test(w)))
    .filter((w) => !types.has(w))
    .join(" ");
}

/** A property as far as matching cares. */
export type Place = { id: string; name: string | null; address: string | null };

/** How a match was arrived at, so a wrong one can be understood rather
 *  than just disbelieved. */
export type How = "address" | "name" | "number-and-street";

export type Match =
  | { found: true; id: string; how: How }
  /** Nothing fit, or more than one did. `tied` names them, because two
   *  properties answering to one address is a thing somebody has to fix
   *  in the data and cannot fix if nobody says which two. */
  | { found: false; tied: string[] };

/**
 * Match one place name against the properties we hold.
 *
 * Tried in order of how specific the claim is, and the FIRST rule that
 * matches anything decides the answer -- including deciding it is a tie.
 * Falling through from a tie to a looser rule would let a vaguer
 * agreement break a tie that the specific one could not, which is the
 * wrong way round.
 */
export function matchPlace(said: string | null | undefined, places: Place[]): Match {
  const want = addressKey(streetLine(said));
  if (!want) return { found: false, tied: [] };

  const wantNo = houseNumber(streetLine(said));
  const wantStreet = streetName(streetLine(said));

  const rules: ((p: Place) => boolean)[] = [
    // The street line of the address, both sides reduced the same way.
    // This is the one that was failing on the town.
    (p) => Boolean(p.address) && addressKey(streetLine(p.address)) === want,
    // What the property is called. A park is usually named this way.
    (p) => Boolean(p.name) && addressKey(p.name) === want,
    /* Number and street agreeing, with the type or a missing town
       differing. "1002 Bartlett" against "1002 Bartlett Ave". Requires
       BOTH -- a street name on its own matches every house on it. */
    (p) => {
      if (!wantNo || !wantStreet) return false;
      for (const s of [streetLine(p.address), p.name]) {
        if (houseNumber(s) === wantNo && streetName(s) === wantStreet) return true;
      }
      return false;
    },
  ];

  for (const rule of rules) {
    const hit = places.filter(rule);
    if (hit.length === 1) {
      const how: How = rule === rules[0] ? "address"
                     : rule === rules[1] ? "name" : "number-and-street";
      return { found: true, id: hit[0]!.id, how };
    }
    /* Two properties fitting equally well is a question, not a match.
       Picking either is a coin toss with a work order on it. */
    if (hit.length > 1) return { found: false, tied: hit.map((p) => p.id) };
  }
  return { found: false, tied: [] };
}
