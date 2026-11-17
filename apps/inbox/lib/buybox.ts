/** Buy boxes (074): what we buy, per asset class and area. Pure. */

export const ASSET_CLASSES: [string, string, string][] = [
  // key, label, what one "unit" is called
  ["mhp", "Mobile home parks", "lots"],
  ["multifamily", "Multifamily", "units"],
  ["single_family", "Single family", "homes"],
  ["rv_park", "RV parks", "sites"],
  ["land", "Land", "acres"],
  ["self_storage", "Self storage", "units"],
  ["commercial", "Commercial", "units"],
  ["other", "Other", "units"],
];
export const CLASS_LABEL: Record<string, string> = Object.fromEntries(ASSET_CLASSES.map(([k, l]) => [k, l]));
export const UNIT_WORD: Record<string, string> = Object.fromEntries(ASSET_CLASSES.map(([k, , u]) => [k, u]));

export type BuyBox = {
  id: string; asset_class: string; area: string;
  min_units: number | null; max_units: number | null;
  min_price: number | null; max_price: number | null; max_price_per_unit: number | null;
  min_occupancy: number | null; financing: string | null; wants: string | null; avoids: string | null;
  notes: string | null; active: boolean; sort: number;
};

const money = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

function range(lo: number | null, hi: number | null, f: (n: number) => string, word = "") {
  const w = word ? ` ${word}` : "";
  if (lo != null && hi != null) return `${f(lo)}-${f(hi)}${w}`;
  if (lo != null) return `${f(lo)}+${w}`;
  if (hi != null) return `up to ${f(hi)}${w}`;
  return null;
}

/** One buy box as one line a broker can read in five seconds:
 *  "Mobile home parks, Sanford and east: 20-150 lots, up to $3M, up to
 *   $40K a lot. Welcome: park-owned homes, vacancy." */
export function describeBox(b: BuyBox) {
  const u = UNIT_WORD[b.asset_class] ?? "units";
  const parts = [
    range(b.min_units, b.max_units, String, u),
    range(b.min_price, b.max_price, money),
    b.max_price_per_unit != null ? `up to ${money(b.max_price_per_unit)} a ${u.replace(/s$/, "")}` : null,
    b.min_occupancy != null ? `${b.min_occupancy}%+ occupied` : null,
  ].filter(Boolean);
  const head = `${CLASS_LABEL[b.asset_class] ?? b.asset_class}${b.area.trim() ? `, ${b.area.trim()}` : ""}`;
  let line = `- ${head}${parts.length ? `: ${parts.join(", ")}` : ""}.`;
  if (b.wants?.trim()) line += ` Welcome: ${b.wants.trim().replace(/\.$/, "")}.`;
  if (b.avoids?.trim()) line += ` Not for us: ${b.avoids.trim().replace(/\.$/, "")}.`;
  if (b.financing?.trim()) line += ` Close with ${b.financing.trim().replace(/\.$/, "")}.`;
  return line;
}

/** Every active box, in order, as the block that replaces {buybox}. */
export function buyBoxBlock(boxes: BuyBox[]) {
  return boxes.filter((b) => b.active)
    .sort((a, b) => a.sort - b.sort || a.asset_class.localeCompare(b.asset_class))
    .map(describeBox).join("\n");
}
