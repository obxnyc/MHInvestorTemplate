/** What a call can be filed as. The first nine are what the phone menu files
 *  them under (call_routes.category); the last is only ever chosen by a person. */
export const CALL_CATEGORIES = [
  "Leasing · Rent",
  "Sales",
  "Emergency",
  "Maintenance",
  "Payments",
  "Resident · Other",
  "Vendor",
  "Seller",
  "General",
  "Spam / Wrong number",
] as const;

export type CallCategory = (typeof CALL_CATEGORIES)[number];

/** The colour family each category is drawn in -- the same families the rest
 *  of the app uses for prospects, tenants, maintenance and vendors. */
export const CATEGORY_TONE: Record<string, string> = {
  "Leasing · Rent": "pr", "Sales": "pr",
  "Emergency": "crit", "Maintenance": "tn", "Payments": "tn", "Resident · Other": "tn",
  "Vendor": "mt", "Seller": "vd", "General": "ot", "Spam / Wrong number": "ot",
};
