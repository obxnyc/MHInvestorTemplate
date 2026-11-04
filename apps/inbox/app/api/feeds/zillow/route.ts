import { supabaseAdmin } from "@/lib/supabase-admin";
import { feedXml, missing, type FeedListing } from "@/lib/zillow-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The feed Zillow reads. Public on purpose: it is the same information the
 * listing shows to anybody on Zillow, and Zillow's crawler does not sign in.
 *
 * Only homes somebody pressed "List on Zillow" for, that are still empty,
 * and that are complete. A home let since it was listed drops out on its own
 * -- a listing left up for a home somebody lives in is a stream of enquiries
 * for nothing, and a fair-housing tester's favourite kind of evidence.
 */
export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db.from("listings")
    .select("unit_id, headline, description, street, city, state, zip, deposit, pets, lease_months, photos, updated_at, units(label, bedrooms, bathrooms, square_feet, monthly_rent, is_vacant, available_on, lat, lng, properties(name, kind, lat, lng))")
    .eq("on_zillow", true);

  if (error) {
    return new Response(`<!-- feed unavailable: ${error.message.replace(/--/g, "")} -->`, {
      status: 503, headers: { "content-type": "application/xml; charset=utf-8" },
    });
  }

  type U = { label: string; bedrooms: number | null; bathrooms: number | null;
             square_feet: number | null; monthly_rent: number | null; is_vacant: boolean;
             available_on: string | null; lat: number | null; lng: number | null;
             properties: { name: string; kind: string | null; lat: number | null; lng: number | null } | null };

  const listings: FeedListing[] = [];
  for (const r of data ?? []) {
    const u = r.units as unknown as U | null;
    if (!u || !u.is_vacant) continue;
    const kind = u.properties?.kind ?? "";
    const l: FeedListing = {
      id: r.unit_id as string,
      propertyName: u.properties?.name ?? "",
      unitLabel: u.label,
      street: r.street ?? "", city: r.city ?? "", state: r.state ?? "", zip: r.zip ?? "",
      lat: u.lat ?? u.properties?.lat ?? null, lng: u.lng ?? u.properties?.lng ?? null,
      rent: Number(u.monthly_rent ?? 0),
      deposit: r.deposit === null ? null : Number(r.deposit),
      bedrooms: Number(u.bedrooms ?? NaN),
      bathrooms: u.bathrooms === null ? null : Number(u.bathrooms),
      squareFeet: u.square_feet,
      availableOn: u.available_on,
      headline: r.headline, description: r.description ?? "",
      pets: (r.pets ?? "ask") as FeedListing["pets"],
      leaseMonths: r.lease_months,
      photos: (r.photos ?? []) as string[],
      updatedAt: String(r.updated_at),
      kind: kind === "mh" || kind === "mhp" ? "MOBILE"
        : kind === "duplex" || kind === "triplex" ? "DUPLEX"
        : kind === "multi" ? "APARTMENT" : "HOUSE",
    };
    if (missing(l).length) continue;
    listings.push(l);
  }

  const xml = feedXml({
    id: "larabee-homes",
    name: process.env.LISTING_COMPANY_NAME || "Larabee Homes",
    website: process.env.PUBLIC_BASE_URL || "https://mh-investor-template.vercel.app",
    contactName: process.env.LISTING_CONTACT_NAME || "Larabee Homes Leasing",
    contactEmail: process.env.LISTING_CONTACT_EMAIL || process.env.POSTMARK_FROM
      || "leasing@larabeehomesllc.com",
    contactPhone: process.env.LISTING_CONTACT_PHONE || "",
  }, listings);

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // Zillow reads it a few times a day; a minute's cache costs nothing.
      "cache-control": "public, max-age=60",
    },
  });
}
