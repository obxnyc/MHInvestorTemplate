/**
 * New people wanting a home, for the morning report: the last 24 hours.
 *
 * TWO PLACES, BECAUSE ONE OF THEM HAS NEVER HELD ANYTHING. On 22 November
 * 2026 the app's own `inquiries`, `prequal_submissions` and `showings` had
 * not one row between them, ever -- the applications and inquiries were
 * arriving somewhere this application does not read. A section built on
 * those tables alone would say "none" every morning, confidently, which is
 * the worst thing a report can say about the thing the owner asked to see.
 *
 * So Rent Manager's prospects are asked as well. Field names there are a
 * hypothesis like everything else on this account, read through `pick`,
 * and what was read is reported in `probe` for the dry run, so one run
 * settles what the records look like.
 */
import { rmAuthorize, type RmSession } from "./rentmanager";
import { supabaseAdmin } from "./supabase-admin";
import { pick, readName, type Lead, type Leads } from "./delinquency";

const PAGE = 100;

export type LeadsProbe = {
  rmUsing: string | null;
  rmRead: number;
  rmShape: string[] | null;
  rmReadAs: Record<string, string>;
  rmTried: string[];
};

const money = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? `$${Math.round(v).toLocaleString("en-US")}` : null;
};

type Contact = { full_name: string | null; phone: string | null } | null;
const realPhone = (p: string | null | undefined) => (p && /^\+\d{8,15}$/.test(p) ? p : null);

async function fromApp(since: string, notes: string[]): Promise<Lead[]> {
  const db = supabaseAdmin();
  const out: Lead[] = [];

  const [apps, inq, shows] = await Promise.all([
    db.from("prequal_submissions")
      .select("decided_at, outcome, contacts(full_name, phone), units(label, properties(name))")
      .gte("decided_at", since),
    db.from("inquiries")
      .select("inquired_at, source, bedrooms_min, price_ceiling, area, contacts(full_name, phone)")
      .gte("inquired_at", since),
    db.from("showings")
      .select("created_at, scheduled_for, contacts(full_name, phone), units(label, properties(name))")
      .gte("created_at", since),
  ]);

  const where = (u: unknown) => {
    const x = u as { label: string | null; properties: { name: string | null } | null } | null;
    if (!x) return null;
    const prop = x.properties?.name ?? null;
    return !prop ? x.label : !x.label || x.label === prop ? prop : `${prop} · ${x.label}`;
  };
  const OUTCOME: Record<string, string> = {
    auto_approve: "pre-approved, can book a showing", manual_review: "needs a review",
    declined: "declined", withdrawn: "withdrawn",
  };

  if (apps.error) notes.push(`Applications could not be read: ${apps.error.message}`);
  for (const a of (apps.data ?? []) as unknown as
    { decided_at: string; outcome: string; contacts: Contact; units: unknown }[]) {
    out.push({
      kind: "application", source: "app", at: a.decided_at,
      name: a.contacts?.full_name ?? "Name not given",
      phone: realPhone(a.contacts?.phone),
      what: [where(a.units) ? `for ${where(a.units)}` : null, OUTCOME[a.outcome] ?? a.outcome]
        .filter(Boolean).join(" · "),
    });
  }

  if (inq.error) notes.push(`Inquiries could not be read: ${inq.error.message}`);
  for (const q of (inq.data ?? []) as unknown as
    { inquired_at: string; source: string | null; bedrooms_min: number | null;
      price_ceiling: number | null; area: string | null; has_pets?: boolean; contacts: Contact }[]) {
    const want = [
      q.bedrooms_min ? `${q.bedrooms_min}+ bed` : null,
      money(q.price_ceiling) ? `under ${money(q.price_ceiling)}` : null,
      q.area,
    ].filter(Boolean).join(", ");
    out.push({
      kind: "inquiry", source: "app", at: q.inquired_at,
      name: q.contacts?.full_name ?? "Name not given",
      phone: realPhone(q.contacts?.phone),
      what: [want || "looking for a home", q.source ? `via ${q.source}` : null].filter(Boolean).join(" · "),
    });
  }

  if (shows.error) notes.push(`Showings could not be read: ${shows.error.message}`);
  for (const s of (shows.data ?? []) as unknown as
    { created_at: string; scheduled_for: string; contacts: Contact; units: unknown }[]) {
    const when = new Date(s.scheduled_for).toLocaleString("en-US", {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: "America/New_York",
    });
    out.push({
      kind: "showing", source: "app", at: s.created_at,
      name: s.contacts?.full_name ?? "Name not given",
      phone: realPhone(s.contacts?.phone),
      what: [where(s.units), when].filter(Boolean).join(" · "),
    });
  }
  return out;
}

/* Rent Manager keeps dates as local time with no zone. Read as New York,
   which is close enough for "in the last day". */
const rmTime = (v: unknown): number | null => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}-05:00`);
  return Number.isFinite(t) ? t : null;
};

async function fromRentManager(sinceMs: number, until: number, probe: LeadsProbe, notes: string[]): Promise<Lead[]> {
  let auth = await rmAuthorize();
  if (!auth.ok) { notes.push("Rent Manager would not accept the sign-in, so its prospects were not read."); return []; }

  const read = async (session: RmSession, path: string) => {
    const rows: Record<string, unknown>[] = [];
    for (let p = 1; p <= 20; p++) {
      if (Date.now() > until) break;
      const join = path.includes("?") ? "&" : "?";
      const res = await fetch(`${session.base}${path}${join}pagesize=${PAGE}&pagenumber=${p}`, {
        headers: { [session.header]: session.token, Accept: "application/json" },
        cache: "no-store", signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw Object.assign(new Error(`${path} answered ${res.status}`), { status: res.status });
      const batch = await res.json().catch(() => null);
      if (!Array.isArray(batch)) break;
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    return rows;
  };

  let rows: Record<string, unknown>[] | null = null;
  for (const path of ["/Prospects?embeds=PhoneNumbers", "/Prospects"]) {
    try {
      rows = await read(auth.session, path);
      probe.rmUsing = path;
      break;
    } catch (e) {
      const status = (e as { status?: number }).status;
      probe.rmTried.push((e as Error).message);
      // A remembered sign-in gone stale (see delinquency-pull): once, afresh.
      if (status === 401 && auth.cached) {
        auth = await rmAuthorize(true);
        if (!auth.ok) break;
        try { rows = await read(auth.session, path); probe.rmUsing = path; break; }
        catch (e2) { probe.rmTried.push((e2 as Error).message); }
      }
    }
  }
  if (!rows) {
    notes.push("Rent Manager's prospect list could not be read this morning, so only what reached the app is counted.");
    return [];
  }

  probe.rmRead = rows.length;
  probe.rmShape = rows[0] ? Object.keys(rows[0]) : null;
  const readAs = probe.rmReadAs;
  const out: Lead[] = [];
  for (const r of rows) {
    const at = rmTime(pick(r, ["CreateDate", "ProspectDate", "DateCreated", "FirstContactDate"], readAs, "date"));
    if (at === null || at < sinceMs) continue;
    const first = pick(r, ["FirstName"], readAs, "first");
    const last = pick(r, ["LastName"], readAs, "last");
    const name = readName(String(pick(r, ["Name", "DisplayName"], readAs, "name") ?? ""))
      ?? ([first, last].filter(Boolean).join(" ") || "Name not given");
    const phones = (r.PhoneNumbers ?? r.phoneNumbers) as Record<string, unknown>[] | undefined;
    let phone: string | null = null;
    for (const n of Array.isArray(phones) ? phones : []) {
      const raw = String(pick(n, ["PhoneNumber", "Number"], readAs, "phone") ?? "").replace(/\D/g, "");
      if (raw.length === 10) { phone = `+1${raw}`; break; }
      if (raw.length === 11 && raw.startsWith("1")) { phone = `+${raw}`; break; }
    }
    const status = pick(r, ["Status", "ProspectStatus"], readAs, "status");
    const src = pick(r, ["Source", "ProspectSource", "MarketingSource", "LeadSource"], readAs, "source");
    const moveIn = pick(r, ["DesiredMoveInDate", "MoveInDate"], readAs, "moveIn");
    const what = [
      typeof status === "string" ? status : null,
      typeof src === "string" ? `via ${src}` : null,
      typeof moveIn === "string" ? `move in ${moveIn.slice(0, 10)}` : null,
    ].filter(Boolean).join(" · ") || "new in Rent Manager";
    out.push({ kind: "prospect", source: "rent manager", at: new Date(at).toISOString(), name, phone, what });
  }
  return out;
}

export async function pullLeads(seconds = 30): Promise<{ leads: Leads; probe: LeadsProbe }> {
  const sinceMs = Date.now() - 24 * 3600_000;
  const until = Date.now() + seconds * 1000;
  const notes: string[] = [];
  const probe: LeadsProbe = { rmUsing: null, rmRead: 0, rmShape: null, rmReadAs: {}, rmTried: [] };

  const [app, rm] = await Promise.all([
    fromApp(new Date(sinceMs).toISOString(), notes).catch((e) => {
      notes.push(`The app's applications could not be read: ${(e as Error).message}`); return [] as Lead[];
    }),
    fromRentManager(sinceMs, until, probe, notes).catch((e) => {
      notes.push(`Rent Manager's prospects could not be read: ${(e as Error).message}`); return [] as Lead[];
    }),
  ]);
  return { leads: { list: [...app, ...rm], notes }, probe };
}
