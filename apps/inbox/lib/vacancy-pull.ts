/**
 * The vacancy half of the morning report: the homes the office has marked
 * FOR RENT or UPCOMING on the Properties page (`units.listing`, 052).
 *
 * NOT RENT MANAGER'S VACANT LIST. Rent Manager calls a lot vacant when there
 * is no lease on it, and a park bought last month is fifty such lots with no
 * home on any of them -- the right answer to "is anybody paying lot rent"
 * and the wrong one to "what can we show somebody this week". The first
 * version of this read that list and would have opened every morning with
 * a page of bare pads.
 *
 * Showings booked in the last or next fortnight are counted against each
 * home, from the showings table.
 */
import { supabaseAdmin } from "./supabase-admin";
import { daysBetween, type Vacancies, type Vacancy } from "./delinquency";

export async function pullVacancies(day: string): Promise<Vacancies> {
  const db = supabaseAdmin();

  type U = {
    id: string; label: string | null; listing: "for_rent" | "upcoming";
    monthly_rent: number | null; tenant_rent_cents: number | null;
    bedrooms: number | null; bathrooms: number | null;
    ready_on: string | null; listed_at: string | null; blocker: string | null;
    properties: { name: string | null } | null;
  };
  const { data, error } = await db.from("units")
    .select("id, label, listing, monthly_rent, tenant_rent_cents, bedrooms, bathrooms, ready_on, listed_at, blocker, properties(name)")
    .not("listing", "is", null);
  if (error) {
    return { list: [], note: `The for-rent list could not be read: ${error.message}` };
  }
  const units = (data ?? []) as unknown as U[];

  const showing = new Map<string, { upcoming: number; recent: number; next: string | null }>();
  if (units.length) {
    const from = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const { data: shows } = await db.from("showings")
      .select("unit_id, scheduled_for")
      .in("unit_id", units.map((u) => u.id))
      .gte("scheduled_for", from).lte("scheduled_for", to);
    const now = Date.now();
    for (const s of (shows ?? []) as { unit_id: string; scheduled_for: string }[]) {
      const e = showing.get(s.unit_id) ?? { upcoming: 0, recent: 0, next: null };
      if (Date.parse(s.scheduled_for) >= now) {
        e.upcoming++;
        if (!e.next || s.scheduled_for < e.next) e.next = s.scheduled_for;
      } else e.recent++;
      showing.set(s.unit_id, e);
    }
  }

  const list: Vacancy[] = units.map((u) => {
    const s = showing.get(u.id);
    // A label that already says the property's name ("1212 Harris Dr" on the
    // property "1212 Harris Dr") is said once, not twice.
    const prop = u.properties?.name ?? null;
    const place = !prop ? (u.label ?? "Unnamed home")
      : !u.label || u.label === prop ? prop : `${prop} · ${u.label}`;
    return {
      place,
      status: u.listing,
      rent: u.tenant_rent_cents != null ? u.tenant_rent_cents / 100
        : u.monthly_rent != null ? Number(u.monthly_rent) : null,
      beds: u.bedrooms,
      baths: u.bathrooms != null ? Number(u.bathrooms) : null,
      daysListed: u.listed_at ? daysBetween(u.listed_at.slice(0, 10), day) : null,
      readyOn: u.ready_on,
      blocker: u.blocker,
      upcomingShowings: s?.upcoming ?? 0,
      recentShowings: s?.recent ?? 0,
      nextShowing: s?.next ?? null,
    };
  });

  return { list, note: null };
}
