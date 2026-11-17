import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Homes for rent — Larabee Homes",
  description: "Homes available to rent from Larabee Homes.",
};

/**
 * The homes, in public.
 *
 * There was nowhere to send somebody who asked what was available. `/apply`
 * is a FORM -- it opens with a dropdown, which answers "which of these do you
 * want" and not "what have you got". A person deciding whether to call needs
 * the second question answered first, and the leasing board had no enquiries
 * on it at all.
 *
 * WHICH HOMES. `units.listing`, set by the office on the Properties page --
 * NOT `is_vacant`, which is Rent Manager's "no lease on it". On 17 November
 * Rent Manager called one unit vacant while the office was advertising six
 * for rent and seven upcoming, and the vacant one was not among them. Keyed
 * on the narrower question this page would have been empty of everything
 * worth showing.
 *
 * An upcoming home is shown and says so. It is worth applying for weeks
 * before the current tenancy ends, and that is most of the list.
 */

type Row = {
  id: string;
  label: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  monthly_rent: number | string | null;
  available_on: string | null;
  listing: string | null;
  properties: { name: string; address: string | null } | null;
};

/** A date with no time in it has no zone either, so both sides say UTC at
 *  noon -- no zone on earth can push that over a date boundary. The same
 *  reasoning as the criteria page, and the same bug if it is skipped. */
const onDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US",
    { timeZone: "UTC", month: "long", day: "numeric" });

export default async function Homes() {
  const { data, error } = await supabaseAdmin()
    .from("units")
    .select("id, label, bedrooms, bathrooms, monthly_rent, available_on, listing,"
      + " properties(name, address)")
    .in("listing", ["for_rent", "upcoming"])
    .order("monthly_rent", { nullsFirst: false });

  /* A read that failed must not render as "we have nothing". Somebody
     deciding whether to ring us would take an empty page at its word. */
  if (error) {
    return (
      <main className="listings">
        <h1>Homes for rent</h1>
        <p className="lede">
          We could not load the list just now. Please call the office and we
          will tell you what is available.
        </p>
      </main>
    );
  }

  const homes = (data ?? []) as unknown as Row[];
  const ready = homes.filter((h) => h.listing === "for_rent");
  const soon = homes.filter((h) => h.listing === "upcoming");

  return (
    <main className="listings">
      <h1>Homes for rent</h1>
      <p className="lede">
        {homes.length === 0
          ? "Nothing is available right now."
          : `${ready.length} available now${soon.length ? `, ${soon.length} coming up` : ""}.`}
        {" "}
        <Link href="/criteria">See our rental criteria</Link>.
      </p>

      {homes.length === 0 ? (
        <p>
          New homes come up most weeks. Call the office and we will let you
          know the moment one does.
        </p>
      ) : (
        <ul className="homegrid">
          {[...ready, ...soon].map((h) => {
            const rent = h.monthly_rent === null ? null : Number(h.monthly_rent);
            const where = h.properties?.name ?? "";
            const unit = h.label && h.label !== where ? h.label : null;
            return (
              <li key={h.id}
                  className={`homecard${h.listing === "upcoming" ? " issoon" : ""}`}>
                {h.listing === "upcoming" && <span className="soon">Coming up</span>}
                <h2>{where}</h2>
                {unit && <p className="unit">{unit}</p>}
                {h.properties?.address && (
                  <p className="addr">{h.properties.address}</p>
                )}
                <p className="facts">
                  {[
                    h.bedrooms ? `${h.bedrooms} bed` : null,
                    h.bathrooms ? `${h.bathrooms} bath` : null,
                  ].filter(Boolean).join(" · ") || "Details on request"}
                </p>
                <p className="rent">
                  {rent ? `$${rent.toLocaleString()}` : "Rent on request"}
                  {rent && <span className="per"> / month</span>}
                </p>
                <p className="when">
                  {h.available_on
                    ? `Available ${onDay(h.available_on)}`
                    : h.listing === "upcoming"
                      ? "Date not set yet"
                      : "Available now"}
                </p>
                <Link className="btn pri" href={`/apply?home=${h.id}`}>
                  Apply for this home
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
