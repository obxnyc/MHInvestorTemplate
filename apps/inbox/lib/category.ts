/** What a conversation is ABOUT — the thing that decides who handles it.
 *
 *  This is deliberately separate from the contact's party. A current tenant
 *  texts about a broken water heater (maintenance) on Monday and about their
 *  renewal (current_tenant) on Friday; the same person, two different queues.
 *  Showing who someone IS in the list answers a question nobody asked, so the
 *  party moved into the thread header and the category owns the list. */
export type Category =
  | "maintenance" | "prospect" | "current_tenant"
  | "vendor" | "collections" | "other";

export const CATEGORIES: Category[] = [
  "maintenance", "prospect", "current_tenant", "vendor", "collections", "other",
];

/** Singular on the row badge, plural on the tab: a badge labels one thread,
 *  a tab labels a pile of them. */
export const CAT_LABEL: Record<Category, string> = {
  maintenance: "Maintenance",
  prospect: "Prospect",
  current_tenant: "Tenant",
  vendor: "Vendor",
  collections: "Collections",
  other: "General",
};

export const CAT_TAB: Record<Category, string> = {
  maintenance: "Maintenance",
  prospect: "Prospects",
  current_tenant: "Tenants",
  vendor: "Vendors",
  collections: "Collections",
  other: "General",
};

export function catLabel(c: string | null | undefined) {
  return CAT_LABEL[(c ?? "other") as Category] ?? "General";
}

/* ------------------------------------------------------------------ property */

/** Property colours are a second, independent axis: the category tells you what
 *  kind of work it is, the property tells you where. They must not be drawn the
 *  same way or they compete — category is the row's left rail and badge,
 *  property is a dot on a chip.
 *
 *  Chosen to stay apart at small sizes and to survive the most common colour
 *  blindness (no red/green pair, no two neighbouring hues). */
const PROPERTY_COLORS = [
  "#2F6DB5", // blue
  "#C2703A", // clay
  "#2E8B68", // green
  "#7C63B5", // violet
  "#B0863A", // ochre
  "#3D8A9E", // teal
  "#A8497A", // plum
  "#5B6B8C", // slate
];

/** A property with no colour set still needs one, and it must not change when
 *  rows are re-ordered or a property is renamed elsewhere in the list — so it
 *  is derived from the name rather than the row's position. */
export function propertyColor(name: string | null | undefined, stored?: string | null) {
  if (stored && /^#[0-9A-Fa-f]{6}$/.test(stored)) return stored;
  const s = String(name ?? "");
  if (!s) return "#94A3B8";
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PROPERTY_COLORS[h % PROPERTY_COLORS.length];
}

type UnitRow = { label?: string | null; properties?: { name: string; color: string | null } | null } | null;

/** A thread's property comes from the unit it is about; when nobody has pinned
 *  a unit to the thread yet, fall back to the unit the contact lives in. An
 *  inbound text from a tenant is about their own lot until someone says
 *  otherwise, and that guess is right often enough to be worth colouring. */
export function propertyOf(convUnit: UnitRow, contactUnit: UnitRow) {
  const u = convUnit?.properties ? convUnit : contactUnit;
  const p = u?.properties;
  if (!p?.name) return null;
  return {
    name: p.name,
    unit: u?.label ?? null,
    color: propertyColor(p.name, p.color),
    exact: Boolean(convUnit?.properties),
  };
}
