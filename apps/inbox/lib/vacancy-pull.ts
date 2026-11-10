/**
 * What is empty this morning, for the vacancy half of the morning report.
 *
 * THREE SOURCES, AND THE EMAIL SAYS WHICH ONE EACH LINE CAME FROM:
 *
 *   Rent Manager's own vacant list, read fresh. Vacancy there is not a flag
 *   on a unit but `Property.VacantUnitIDs` (see rm-import.ts), so it is
 *   asked for every morning rather than trusted from the last import.
 *
 *   A unit marked vacant here (`units.is_vacant`), which is the import's
 *   copy plus anything somebody flipped by hand.
 *
 *   A home with a showing booked in the last or next fortnight. A home
 *   being shown is being marketed, whatever any flag says.
 *
 * "Listed online" is not recorded anywhere in this app or, as far as the
 * API shows, in Rent Manager -- so it is not claimed.
 */
import { rmAuthorize, type RmSession } from "./rentmanager";
import { supabaseAdmin } from "./supabase-admin";
import { daysBetween, type Vacancy } from "./delinquency";

const PAGE = 100;

function vacantSet(v: unknown): Set<number> {
  if (Array.isArray(v)) return new Set(v.map(Number).filter(Number.isFinite));
  if (typeof v === "string") return new Set(v.split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite));
  return new Set();
}

async function properties(session: RmSession, path: string, until: number): Promise<Record<string, unknown>[] | null> {
  const out: Record<string, unknown>[] = [];
  for (let p = 1; p <= 20; p++) {
    if (Date.now() > until) return null;
    const join = path.includes("?") ? "&" : "?";
    const res = await fetch(`${session.base}${path}${join}pagesize=${PAGE}&pagenumber=${p}`, {
      headers: { [session.header]: session.token, Accept: "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(Math.max(1000, until - Date.now())),
    });
    if (!res.ok) return null;
    const batch = await res.json().catch(() => null);
    if (!Array.isArray(batch)) return null;
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

export type VacancyResult = { list: Vacancy[]; rmOk: boolean; note: string | null };

export async function pullVacancies(day: string, seconds = 40): Promise<VacancyResult> {
  const until = Date.now() + seconds * 1000;
  const db = supabaseAdmin();

  /* ---- Rent Manager's list, fresh */
  const rmVacant = new Set<number>();
  let rmOk = false;
  let note: string | null = null;
  try {
    const auth = await rmAuthorize();
    if (auth.ok) {
      // Bare first, because it is quick; the Units embed only if the bare
      // record does not carry the list.
      for (const path of ["/Properties", "/Properties?embeds=Units"]) {
        const rows = await properties(auth.session, path, until);
        if (!rows) continue;
        if (!rows.some((r) => "VacantUnitIDs" in r)) continue;
        for (const r of rows) for (const id of vacantSet(r.VacantUnitIDs)) rmVacant.add(id);
        rmOk = true;
        break;
      }
      if (!rmOk) note = "Rent Manager's vacant list could not be read this morning, so this is the app's own record only.";
    } else {
      note = "Rent Manager would not accept the sign-in, so this is the app's own record only.";
    }
  } catch (e) {
    note = `Rent Manager's vacant list could not be read (${(e as Error).message}), so this is the app's own record only.`;
  }

  /* ---- the app's units, and showings around today */
  type U = {
    id: string; label: string | null; rm_unit_id: number | null; is_vacant: boolean | null;
    monthly_rent: number | null; tenant_rent_cents: number | null;
    bedrooms: number | null; bathrooms: number | null;
    vacant_since: string | null; available_on: string | null; blocker: string | null;
    properties: { name: string | null } | null;
  };
  const sel = "id, label, rm_unit_id, is_vacant, monthly_rent, tenant_rent_cents, bedrooms, bathrooms, vacant_since, available_on, blocker, properties(name)";
  const wanted = new Map<string, U>();

  const { data: flagged } = await db.from("units").select(sel).eq("is_vacant", true);
  for (const u of (flagged ?? []) as unknown as U[]) wanted.set(u.id, u);

  if (rmVacant.size) {
    const { data } = await db.from("units").select(sel).in("rm_unit_id", [...rmVacant]);
    const found = (data ?? []) as unknown as U[];
    for (const u of found) wanted.set(u.id, u);
    // Empty in Rent Manager and unknown here is still empty. Said, rather
    // than dropped from a list whose whole point is what is empty.
    const missing = rmVacant.size - new Set(found.map((u) => u.rm_unit_id)).size;
    if (missing > 0) {
      note = `${missing} more unit${missing === 1 ? " is" : "s are"} vacant in Rent Manager but not yet in this app, so ${missing === 1 ? "it is" : "they are"} not listed by name. Running the Rent Manager import brings them across.`;
    }
  }

  const from = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const { data: shows } = await db.from("showings")
    .select("unit_id, scheduled_for").not("unit_id", "is", null)
    .gte("scheduled_for", from).lte("scheduled_for", to);
  const now = Date.now();
  const showing = new Map<string, { upcoming: number; recent: number; next: string | null }>();
  for (const s of (shows ?? []) as { unit_id: string; scheduled_for: string }[]) {
    const e = showing.get(s.unit_id) ?? { upcoming: 0, recent: 0, next: null };
    if (Date.parse(s.scheduled_for) >= now) {
      e.upcoming++;
      if (!e.next || s.scheduled_for < e.next) e.next = s.scheduled_for;
    } else e.recent++;
    showing.set(s.unit_id, e);
  }
  const shownIds = [...showing.keys()].filter((id) => !wanted.has(id));
  if (shownIds.length) {
    const { data } = await db.from("units").select(sel).in("id", shownIds);
    for (const u of (data ?? []) as unknown as U[]) wanted.set(u.id, u);
  }

  const list: Vacancy[] = [...wanted.values()].map((u) => {
    const s = showing.get(u.id);
    const since = u.vacant_since ?? null;
    const rent = u.tenant_rent_cents != null ? u.tenant_rent_cents / 100
      : u.monthly_rent != null ? Number(u.monthly_rent) : null;
    const why: string[] = [];
    if (u.rm_unit_id != null && rmVacant.has(u.rm_unit_id)) why.push("Rent Manager");
    if (u.is_vacant) why.push("marked vacant");
    if (s) why.push("showing");
    return {
      place: [u.properties?.name, u.label].filter(Boolean).join(" · ") || "Unnamed unit",
      rent, beds: u.bedrooms, baths: u.bathrooms != null ? Number(u.bathrooms) : null,
      daysEmpty: since ? daysBetween(since, day) : null,
      availableOn: u.available_on, blocker: u.blocker,
      upcomingShowings: s?.upcoming ?? 0, recentShowings: s?.recent ?? 0,
      nextShowing: s?.next ?? null,
      why,
    };
  });

  return { list, rmOk, note };
}
