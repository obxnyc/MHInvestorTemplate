/**
 * The listing feed Zillow reads.
 *
 * Zillow does not take listings pushed at it by a small landlord's app. It
 * READS a feed: an XML file at a URL we host, in its Rental Listings Feed
 * format (the HotPads `hotPadsItems` schema), fetched on its own schedule.
 * So "list on Zillow" is two things that are not the same and are easy to
 * conflate:
 *
 *   - pressing the button puts the home in OUR feed, instantly; and
 *   - Zillow showing it depends on Zillow having approved the feed URL once
 *     (rentalfeeds@zillow.com, a few weeks the first time) and then on its
 *     next read, usually within a day.
 *
 * The screen says both, rather than letting a pressed button read as a home
 * that is on Zillow when Zillow has never heard of the feed.
 *
 * Pure: listings in, XML out. Field names follow the published HotPads
 * Listing schema; Zillow's integrations team validates the first feed and
 * names anything it wants changed, which is a one-line fix here.
 */

export type FeedListing = {
  id: string;              // unit id -- stable, so an edit updates rather than duplicates
  propertyName: string;
  unitLabel: string | null;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat?: number | null;
  lng?: number | null;
  rent: number;
  deposit?: number | null;
  bedrooms: number;
  bathrooms?: number | null;
  squareFeet?: number | null;
  availableOn?: string | null;
  headline?: string | null;
  description: string;
  pets: "cats" | "dogs" | "both" | "none" | "ask";
  leaseMonths?: number | null;
  photos: string[];
  updatedAt: string;
  /** "MOBILE" for a manufactured home; Zillow shows it as such. */
  kind?: "HOUSE" | "MOBILE" | "APARTMENT" | "TOWNHOUSE" | "DUPLEX";
};

export type FeedCompany = {
  id: string;
  name: string;
  website: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

const esc = (v: unknown) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
  // Characters XML 1.0 forbids outright. One pasted from a word processor
  // makes the whole feed unreadable, and every listing in it vanishes.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const tag = (name: string, v: unknown) =>
  v === null || v === undefined || v === "" ? "" : `<${name}>${esc(v)}</${name}>`;

/**
 * What is missing before a home can go in the feed.
 *
 * Zillow's own words are "only feeds that include high quality listings will
 * be accepted", and a listing with no photograph or no address is the kind
 * that gets a feed turned down. So the button refuses and says what to add,
 * rather than publishing a listing that drags the feed down with it.
 */
export function missing(l: Partial<FeedListing>): string[] {
  const out: string[] = [];
  if (!l.street?.trim()) out.push("street address");
  if (!l.city?.trim()) out.push("city");
  if (!l.state?.trim()) out.push("state");
  if (!/^\d{5}$/.test(l.zip?.trim() ?? "")) out.push("5-digit ZIP");
  if (!(Number(l.rent) > 0)) out.push("monthly rent");
  if (l.bedrooms === null || l.bedrooms === undefined || !(Number(l.bedrooms) >= 0)) out.push("bedrooms");
  if ((l.description?.trim().length ?? 0) < 40) out.push("a description (a couple of sentences)");
  if (!(l.photos?.length)) out.push("at least one photo");
  return out;
}

const PETS: Record<FeedListing["pets"], string[]> = {
  cats: ["cats"], dogs: ["small dogs", "large dogs"], both: ["cats", "small dogs", "large dogs"],
  none: [], ask: [],
};

export function feedXml(company: FeedCompany, listings: FeedListing[]): string {
  const rows = listings.map((l) => {
    const baths = l.bathrooms ?? null;
    const full = baths === null ? null : Math.floor(baths);
    const half = baths === null ? null : (baths - Math.floor(baths) >= 0.5 ? 1 : 0);
    const photos = l.photos.map((src, i) =>
      `<ListingPhoto source="${esc(src)}"><label>${esc(i === 0 ? "Front" : `Photo ${i + 1}`)}</label></ListingPhoto>`,
    ).join("");
    const pets = PETS[l.pets].map((p) => `<tag>${esc(p)}</tag>`).join("");
    return [
      `<Listing id="${esc(l.id)}" type="RENTAL" companyId="${esc(company.id)}" propertyType="${l.kind ?? "MOBILE"}">`,
      tag("name", l.headline || l.propertyName),
      tag("unit", l.unitLabel),
      `<street hide="false">${esc(l.street)}</street>`,
      tag("city", l.city), tag("state", l.state), tag("zip", l.zip), tag("country", "US"),
      tag("latitude", l.lat), tag("longitude", l.lng),
      tag("lastUpdated", l.updatedAt),
      tag("contactName", company.contactName),
      tag("contactEmail", company.contactEmail),
      tag("contactPhone", company.contactPhone),
      tag("previewMessage", l.headline),
      tag("description", l.description),
      tag("leaseTerm", l.leaseMonths ? `${l.leaseMonths} months` : null),
      tag("website", company.website),
      pets ? `<ListingTag type="PET_POLICY">${pets}</ListingTag>` : "",
      photos,
      tag("price", Math.round(l.rent)),
      tag("pricingFrequency", "MONTHLY"),
      tag("deposit", l.deposit ? Math.round(l.deposit) : null),
      tag("numBedrooms", l.bedrooms),
      tag("numFullBaths", full),
      tag("numHalfBaths", half),
      tag("squareFeet", l.squareFeet),
      tag("dateAvailable", l.availableOn),
      `</Listing>`,
    ].filter(Boolean).join("");
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<hotPadsItems version="2.1">`
    + `<Company id="${esc(company.id)}">${tag("name", company.name)}${tag("website", company.website)}`
    + `${tag("CompanyLogo", null)}</Company>`
    + rows.join("\n")
    + `</hotPadsItems>\n`;
}

/**
 * "123 Main St, Elizabeth City, NC 27909" in its parts, for prefilling the
 * listing. A guess the person sees and corrects, never written to the feed
 * without them having looked.
 */
export function splitAddress(line: string | null | undefined):
  { street: string; city: string; state: string; zip: string } {
  const s = (line ?? "").trim();
  const m = /^(.+?),\s*([^,]+?),\s*([A-Z]{2})\.?\s*(\d{5})?(?:-\d{4})?\s*$/i.exec(s);
  if (m) return { street: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] ?? "" };
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  return { street: parts[0] ?? "", city: parts[1] ?? "", state: "NC", zip: "" };
}

const norm = (s: string) => s.toLowerCase()
  .replace(/\b(street|st)\b/g, "st").replace(/\b(road|rd)\b/g, "rd")
  .replace(/\b(drive|dr)\b/g, "dr").replace(/\b(avenue|ave)\b/g, "ave")
  .replace(/\b(lane|ln)\b/g, "ln").replace(/\b(court|ct)\b/g, "ct")
  .replace(/\b(lot|unit|apt|#)\s*/g, "#").replace(/[^a-z0-9# ]/g, " ")
  .replace(/\s+/g, " ").trim();

/**
 * Which of our listings a Zillow email is about.
 *
 * Zillow writes "Regarding your listing at: 123 Main St #4, Elizabeth City,
 * NC 27909" -- which is what WE sent it, so the street line matches our own
 * listing's. The house number has to agree and the street name has to
 * appear; a unit, when both sides have one, has to agree too. Anything less
 * than one clear answer is no answer: the person is asked which home on the
 * form, which costs them one tap, where a wrong guess costs a showing at the
 * wrong door.
 */
export function matchListing<T extends { id: string; street: string; unitLabel?: string | null }>(
  hint: string | null | undefined, listings: T[],
): T | null {
  if (!hint) return null;
  const h = norm(hint);
  const hits = listings.filter((l) => {
    const st = norm(l.street);
    const num = /^\d+/.exec(st)?.[0];
    if (!num || !new RegExp(`(^| )${num}( |$)`).test(h)) return false;
    const name = st.replace(/^\d+\s*/, "").replace(/#.*$/, "").trim();
    if (!name || !h.includes(name)) return false;
    const unit = (l.unitLabel ?? "").replace(/\D/g, "");
    const theirs = /#\s*([0-9]+)/.exec(h)?.[1];
    if (unit && theirs && unit !== theirs) return false;
    return true;
  });
  return hits.length === 1 ? hits[0] : null;
}
