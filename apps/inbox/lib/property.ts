/**
 * What each kind of property is, in one place.
 *
 * Three things were being decided separately and wrongly. The colour was a
 * free choice per property, which made it decorative -- if every park is the
 * same colour and every house another, the tint on a conversation tells you
 * what KIND of place it is at a glance, and a colour somebody picked tells you
 * nothing. The code was not being generated at all. And every property,
 * including a single house, was offered a list of lots to fill in.
 *
 * A house is not a park with one lot. It has exactly one dwelling and that
 * dwelling is the property, so the unit is made for it and never mentioned
 * again. A park has many, and which lot a thing happened on is the whole
 * question.
 */

export type Kind = "sfh" | "mh" | "duplex" | "triplex" | "multi" | "mhp" | "lot";

export type KindSpec = {
  label: string;
  /** Goes in front of the property code: SFH-004, MHP-002. */
  prefix: string;
  /** Tint, shared by every property of this kind. */
  color: string;
  /** How many dwellings it can hold. `one` means the property IS the dwelling
   *  and no list of units is ever shown. */
  holds: "one" | "few" | "many";
  /** What its dwellings are called, singular and plural. */
  unitWord: [string, string];
  /** Whether the home on a dwelling may belong to the resident. Only ever true
   *  in a park: everywhere else we own the building by definition. */
  homesCanBeTheirs: boolean;
};

export const KINDS: Record<Kind, KindSpec> = {
  sfh: {
    label: "Single-family home", prefix: "SFH", color: "#3E6BB0",
    holds: "one", unitWord: ["home", "homes"], homesCanBeTheirs: false,
  },
  mh: {
    label: "Mobile home", prefix: "MH", color: "#2E8B68",
    holds: "one", unitWord: ["home", "homes"], homesCanBeTheirs: false,
  },
  duplex: {
    label: "Duplex", prefix: "DUP", color: "#B0863A",
    holds: "few", unitWord: ["side", "sides"], homesCanBeTheirs: false,
  },
  triplex: {
    label: "Triplex", prefix: "TRI", color: "#C2703A",
    holds: "few", unitWord: ["unit", "units"], homesCanBeTheirs: false,
  },
  multi: {
    label: "Multi-family", prefix: "MF", color: "#A8497A",
    holds: "many", unitWord: ["unit", "units"], homesCanBeTheirs: false,
  },
  mhp: {
    label: "Mobile home park", prefix: "MHP", color: "#405981",
    holds: "many", unitWord: ["lot", "lots"], homesCanBeTheirs: true,
  },
  lot: {
    label: "Lot", prefix: "LOT", color: "#8595AC",
    holds: "one", unitWord: ["lot", "lots"], homesCanBeTheirs: false,
  },
};

export const KIND_LIST = Object.entries(KINDS) as [Kind, KindSpec][];

export const kindOf = (k: string): KindSpec => KINDS[k as Kind] ?? KINDS.sfh;

/** "lot" / "lots" for a park, "unit" / "units" elsewhere. */
export const unitWord = (k: string, n: number) =>
  kindOf(k).unitWord[n === 1 ? 0 : 1];

/**
 * The next free code for a kind: SFH-001, SFH-002, MHP-001.
 *
 * Derived from what already exists rather than stored in a counter, so it
 * cannot drift from reality -- and the database has the unique index that
 * actually enforces it, because two people adding a property at the same
 * instant would otherwise both be told 004.
 */
export function nextCode(prefix: string, taken: string[]): string {
  const used = new Set(taken);
  const mine = taken
    .filter((c) => c.startsWith(`${prefix}-`))
    .map((c) => Number(c.slice(prefix.length + 1)))
    .filter(Number.isFinite);
  let n = (mine.length ? Math.max(...mine) : 0) + 1;
  // A gap-filling loop rather than max+1 alone, because a deleted property
  // leaves a hole and the index would refuse a reused number anyway.
  while (used.has(`${prefix}-${String(n).padStart(3, "0")}`)) n++;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}
