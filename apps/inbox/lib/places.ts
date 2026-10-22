import { score } from "@/lib/fuzzy";

/**
 * Somewhere work happens: a whole property, or one lot on it.
 *
 * Two people describe the same place completely differently. One says "the
 * Retreat". The other says "1140 Northside Rd lot 20" and could not tell you
 * the park's name. Both have to find the same row, so a place carries every
 * name it has rather than one canonical one.
 *
 * `id` is unique across both kinds, because a property and a lot would
 * otherwise collide in a list of options.
 */
export type Place = {
  id: string;
  kind: "property" | "lot";
  propertyId: string;
  unitId: string | null;
  /** What it is called, shown first. */
  label: string;
  /** Where it is, shown underneath. Empty when there is no address on file. */
  where: string;
  /** Everything it can be found by, its park's names included. */
  terms: string[];
  /** A PARK that wants a lot number before the hours are filed.
   *
   *  "If they are at a MHP then when clocking in with 1140 Northside or The
   *  Retreat, it should prompt them for a lot number." A park is a hundred
   *  homes; hours against the park say nothing about which one. Only a prompt
   *  -- mowing the common ground really is the whole park -- but the answer is
   *  then recorded rather than defaulted, which is the difference between
   *  "the whole park" and "nobody said".
   *
   *  False when the park has no lots on file, because asking a question with
   *  no possible answer is worse than not asking. */
  needsLot: boolean;
};

export type RawProperty = {
  id: string; name: string; address?: string | null;
  /** `mhp`, `sfh`, and the rest of `property.ts`'s kinds. */
  kind?: string | null;
};
export type RawUnit = { id: string; property_id: string; label: string };

/** The street part of an address, without the town and state.
 *
 *  "1140 Northside Rd, Elizabeth City NC" is typed as "1140 Northside" far
 *  more often than in full, and a term that exists only in its full form is
 *  one more word the person has to get right.
 */
const street = (address: string) => address.split(",")[0]!.trim();

/**
 * Build the list of places from what the database has.
 *
 * Every property appears, because somebody mowing the whole park is not on
 * any one lot. Every lot appears as well, because work on a lot has to be
 * filed against the LOT -- a shift recorded against the park when it was
 * really lot 20 is the thing this exists to stop.
 */
export function places(props: RawProperty[], units: RawUnit[]): Place[] {
  const byId = new Map(props.map((p) => [p.id, p]));
  const lots: Place[] = [];
  const parks: Place[] = [];

  for (const u of units) {
    const p = byId.get(u.property_id);
    if (!p) continue;                  // a lot whose park is gone is not a place
    const addr = (p.address ?? "").trim();
    const lot = /^\d+$/.test(u.label.trim()) ? `Lot ${u.label.trim()}` : u.label.trim();
    lots.push({
      id: `u:${u.id}`,
      kind: "lot",
      propertyId: p.id,
      unitId: u.id,
      label: `${p.name} · ${lot}`,
      where: addr,
      terms: [
        lot, u.label,
        p.name, addr, street(addr),
        // The two ways people actually say it out loud.
        `${p.name} ${lot}`,
        addr ? `${street(addr)} ${lot}` : "",
      ].filter(Boolean),
      // A lot IS the answer to "which lot", so it never asks.
      needsLot: false,
    });
  }

  for (const p of props) {
    const addr = (p.address ?? "").trim();
    parks.push({
      id: `p:${p.id}`,
      kind: "property",
      propertyId: p.id,
      unitId: null,
      label: p.name,
      where: addr,
      terms: [p.name, addr, street(addr)].filter(Boolean),
      needsLot: (p.kind ?? "") === "mhp" && lots.some((l) => l.propertyId === p.id),
    });
  }

  /* LOTS FIRST, parks after, and it is not arbitrary.
     `sort` is stable, so when two places score the same the one built first
     wins. With parks built first, "the park comes above its own lots" was
     true BY ACCIDENT -- the rule could be deleted and not one check would
     notice, because the array order was doing the work underneath it. Two
     separate rules were written to guarantee that ordering and both were
     no-ops for exactly this reason. Built this way round, the comparator in
     `findPlace` is the only thing that can decide it, which is the only way
     the rule can be tested at all. */
  return [...lots, ...parks];
}

/**
 * Find a place by whatever somebody typed.
 *
 * EVERY WORD HAS TO LAND SOMEWHERE, and they may land on different terms.
 * That is the whole point: in "northside 20" one word is a street and the
 * other is a lot number, and a matcher that scores the query as one string
 * against one term at a time finds nothing for it. `rank` in fuzzy.ts is that
 * matcher, and it is right for a command bar, where a query is one name.
 * This is not that.
 *
 * Requiring every word also keeps the list short, which is what makes a
 * picker usable on a phone: "1140 northside rd lot 20" narrows to one row
 * rather than to everything on Northside Road.
 */
export function findPlace(query: string, list: Place[], limit = 8): Place[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [...list].sort(order).slice(0, limit);

  const hits: { place: Place; total: number }[] = [];
  for (const place of list) {
    let total = 0;
    let all = true;
    for (const w of words) {
      let best = 0;
      for (const term of place.terms) {
        const s = score(w, term);
        if (s && s.score > best) best = s.score;
      }
      if (!best) { all = false; break; }
      total += best;
    }
    if (all) hits.push({ place, total });
  }

  return hits
    .sort((a, b) => b.total - a.total || order(a.place, b.place))
    .slice(0, limit)
    .map((h) => h.place);
}

/** Two places that scored the same: alphabetically, so the list is the same
 *  every time rather than however the rows happened to arrive.
 *
 *  THE PARK COMES ABOVE ITS OWN LOTS, and this is the line that does it --
 *  not by a rule about kinds, but because a lot is labelled
 *  `<park> · Lot <n>`, so the park's label is a prefix of every one of its
 *  lots' and sorts before them. `lotsFollowTheirPark` below states that, and
 *  places.test.mjs checks it, because it is the LABEL FORMAT that is holding
 *  the promise up: change it and the ordering changes with it, silently.
 *
 *  Two explicit rules for this were written first -- a score penalty on an
 *  inherited name, and a kind comparison here -- and BOTH were no-ops. Each
 *  could be deleted with every check still passing, because this line and the
 *  array's build order were already deciding it. Keeping a rule that nothing
 *  can make fail is how a file fills up with code nobody dares remove. */
function order(a: Place, b: Place): number {
  return a.label.localeCompare(b.label);
}

/** Does a lot's label still begin with its park's?
 *
 *  The ordering above depends on it entirely, and nothing else in the file
 *  says so.
 */
export function lotsFollowTheirPark(list: Place[]): boolean {
  const parks = new Map(list.filter((p) => p.kind === "property")
    .map((p) => [p.propertyId, p.label]));
  return list.filter((p) => p.kind === "lot")
    .every((lot) => {
      const park = parks.get(lot.propertyId);
      return park === undefined || lot.label.startsWith(park);
    });
}
