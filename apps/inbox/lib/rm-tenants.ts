/**
 * Who lives in the unit.
 *
 * One unit out of 417 knew. The portfolio import brought properties,
 * units and owners across and stopped — and `/Tenants` and `/Leases`
 * both answer on this account and nothing had ever fetched either. The
 * same shape as `/ServiceManagerIssues`, which sat there readable for
 * weeks while tenants wondered where their maintenance requests went.
 *
 * THE LEASE IS THE JOIN. A tenant record says who somebody is and which
 * property they are on; it does not say which unit. The lease says
 * `TenantID` and `UnitID` in one row, which is exactly "who lives at
 * 114 Lisas Way". Without it a tenant can only be placed at a park, and
 * "somebody at The Retreat" is not an answer to "whose fridge is out".
 *
 * WHAT IT IS FOR. A maintenance request arrives naming nobody. The
 * office picks the property — and then has to type the tenant's name
 * and number from memory. With this, the person arrives with the
 * address.
 *
 * FIELD NAMES ARE A HYPOTHESIS, as everywhere else against this
 * account: Rent Manager Express, documentation not reachable from the
 * machine this was written on. So every field is read through `pick`,
 * which tries the spellings rmAPI is known to use and REPORTS which one
 * answered. A guess that says what it saw is correctable in one round;
 * a guess that fails silently is not correctable at all.
 */
import { rmAuthorize, type RmSession } from "./rentmanager";
import { supabaseAdmin } from "./supabase-admin";
import { toE164, isValidPhone } from "./phone";

const PAGE = 100;

/** The first of these keys the record actually has, and what it was
 *  called. An empty value is NOT an answer: `text()` nulls it, and
 *  recording the name anyway would make the map — which is the whole
 *  diagnosis when a field comes back missing — say the wrong thing. */
function pick(
  row: Record<string, unknown>, keys: string[],
  readAs?: Record<string, string>, as?: string,
): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (readAs && as && !readAs[as]) readAs[as] = k;
    return v;
  }
  return null;
}

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim()
    : typeof v === "number" ? String(v) : "";
  return s || null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
};

/** "Larabee, Megan" is how Rent Manager writes a name and not how
 *  anybody says one. */
function readName(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const comma = s.indexOf(",");
  if (comma < 0) return s;
  const last = s.slice(0, comma).trim();
  const first = s.slice(comma + 1).trim();
  return first && last ? `${first} ${last}` : s;
}

/** The placeholder written into `contacts.phone` for somebody who has
 *  never given us a number. The column will not take a null and is
 *  unique, so two tenants without numbers must not collide. */
export function tenantPlaceholder(tenantId: number | string): string {
  return `rm:tenant:${tenantId}`;
}

/** One lease, as much of it as matters for placing somebody. */
export type Lease = {
  tenantId: number; unitId: number | null;
  propertyId: number | null; movedIn: string;
};

/**
 * Which unit each tenant is in now.
 *
 * A tenant with several leases is the ordinary case over a few years --
 * they move within the park, or renew onto a new lease record -- and
 * the one that matters is the one they are living under TODAY. Take the
 * wrong one and the office is sent to the house they left.
 *
 * Newest move-in wins. Dates compare as strings because Rent Manager
 * writes them ISO-first; a date it writes some other way sorts
 * unpredictably rather than wrongly-but-confidently, and a lease with
 * no date at all loses to any lease that has one.
 */
export function unitByTenant(leases: Lease[]): Map<number, Lease> {
  const best = new Map<number, Lease>();
  for (const l of leases) {
    const had = best.get(l.tenantId);
    if (!had || l.movedIn > had.movedIn) best.set(l.tenantId, l);
  }
  return best;
}

async function page<T>(session: RmSession, path: string, p: number): Promise<T[]> {
  const join = path.includes("?") ? "&" : "?";
  const res = await fetch(`${session.base}${path}${join}pagesize=${PAGE}&pagenumber=${p}`, {
    headers: { [session.header]: session.token, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data as T[] : [];
}

/** Every page, or as many as the cap allows. */
async function all<T>(
  session: RmSession, paths: string[], cap: number, until: number,
): Promise<{ rows: T[]; using: string | null; more: boolean }> {
  /* SEVERAL SPELLINGS, TRIED ONE AT A TIME AND NOT AS ONE LIST.
     Asked as a single embeds list, one bad name fails the whole request
     — which is how the first Service Manager attempt silently fell back
     to bare records and dropped the status and the category. */
  for (const path of paths) {
    try {
      const rows: T[] = [];
      let more = false;
      for (let p = 1; p <= cap; p++) {
        if (Date.now() > until) { more = true; break; }
        const batch = await page<T>(session, path, p);
        rows.push(...batch);
        if (batch.length < PAGE) break;
        if (p === cap) more = true;
      }
      return { rows, using: path, more };
    } catch { /* the next spelling */ }
  }
  return { rows: [], using: null, more: false };
}

export type TenantRow = {
  rmTenantId: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  rmUnitId: number | null;
  rmPropertyId: number | null;
};

export type TenantResult = {
  ok: boolean;
  signedIn: boolean;
  dryRun: boolean;
  /** What Rent Manager handed over. */
  tenants: number;
  leases: number;
  /** How many could be put in one of our units. The number that matters:
   *  a tenant with no unit cannot answer "who lives at this address". */
  placed: number;
  /** Written: new people, and people we already had. */
  added: number;
  updated: number;
  /** Already held under a different record and joined to it rather than
   *  duplicated. */
  merged: number;
  failed: number;
  more: boolean;
  /** Which endpoint spelling answered, and which field answered for each
   *  thing we wanted. The map, for when something comes back missing. */
  usingTenants: string | null;
  usingLeases: string | null;
  readAs: Record<string, string>;
  /** The field names on the first record of each, so a missing field can
   *  be named rather than guessed at. */
  tenantShape: string[] | null;
  leaseShape: string[] | null;
  samples: TenantRow[];
  error: string | null;
};

/* The spellings to try, most informative first. An embed this account
   refuses 404s the whole request, so each is its own attempt. */
const TENANT_PATHS = [
  "/Tenants?embeds=Contacts,Contacts/PhoneNumbers,Addresses",
  "/Tenants?embeds=Contacts",
  "/Tenants",
];
const LEASE_PATHS = ["/Leases", "/Leases?embeds=Unit"];

/** A tenant's number and email, which live on their Contacts rather than
 *  on the tenant record itself. */
function reachOf(
  t: Record<string, unknown>, readAs: Record<string, string>,
): { phone: string | null; email: string | null } {
  const people = (t.Contacts ?? t.contacts) as Record<string, unknown>[] | undefined;
  let phone: string | null = null;
  let email: string | null = null;

  for (const c of Array.isArray(people) ? people : []) {
    if (!email) email = text(pick(c, ["Email", "EmailAddress"], readAs, "email"));
    if (!phone) {
      const nums = (c.PhoneNumbers ?? c.phoneNumbers) as Record<string, unknown>[] | undefined;
      for (const n of Array.isArray(nums) ? nums : []) {
        const got = text(pick(n, ["PhoneNumber", "Number", "Phone"], readAs, "phone"));
        if (got) { phone = got; break; }
      }
    }
    if (phone && email) break;
  }
  // Some accounts hang them straight off the tenant.
  email ??= text(pick(t, ["Email", "EmailAddress"], readAs, "email"));
  phone ??= text(pick(t, ["Phone", "PhoneNumber"], readAs, "phone"));
  return { phone, email };
}

/**
 * Bring the tenant roster across and attach each person to their unit.
 *
 * A rehearsal unless told otherwise, same as every other import here:
 * the first run of something that writes hundreds of people into a live
 * inbox should be readable before it is believed.
 */
export async function pullTenants(
  opts: { dryRun?: boolean; seconds?: number; pages?: number } = {},
): Promise<TenantResult> {
  const dryRun = opts.dryRun !== false;
  const blank: TenantResult = {
    ok: false, signedIn: false, dryRun,
    tenants: 0, leases: 0, placed: 0, added: 0, updated: 0, merged: 0,
    failed: 0, more: false,
    usingTenants: null, usingLeases: null, readAs: {},
    tenantShape: null, leaseShape: null, samples: [], error: null,
  };

  const auth = await rmAuthorize();
  if (!auth.ok) {
    return { ...blank, error: "Rent Manager would not accept the sign-in." };
  }
  const session = auth.session;
  const until = Date.now() + (opts.seconds ?? 35) * 1000;
  const cap = opts.pages ?? 40;
  const readAs: Record<string, string> = {};

  let leaseRows: Record<string, unknown>[] = [];
  let tenantRows: Record<string, unknown>[] = [];
  let usingLeases: string | null = null;
  let usingTenants: string | null = null;
  let more = false;
  try {
    const l = await all<Record<string, unknown>>(session, LEASE_PATHS, cap, until);
    leaseRows = l.rows; usingLeases = l.using; more = more || l.more;
    const t = await all<Record<string, unknown>>(session, TENANT_PATHS, cap, until);
    tenantRows = t.rows; usingTenants = t.using; more = more || t.more;
  } catch (e) {
    return { ...blank, signedIn: true, error: (e as Error).message };
  }

  /* WHICH UNIT, FROM THE LEASE.
     A tenant with several leases is the common case over a few years, so
     the newest move-in wins — the one they are living under now. */
  const read: Lease[] = [];
  for (const l of leaseRows) {
    const tid = num(pick(l, ["TenantID", "TenantId"], readAs, "leaseTenant"));
    if (tid === null) continue;
    read.push({
      tenantId: tid,
      unitId: num(pick(l, ["UnitID", "UnitId"], readAs, "leaseUnit")),
      propertyId: num(pick(l, ["PropertyID", "PropertyId"], readAs, "leaseProperty")),
      movedIn: text(pick(l, ["MoveInDate", "ArrivalDate", "CreateDate"])) ?? "",
    });
  }
  const unitOf = unitByTenant(read);

  const out: TenantResult = {
    ...blank, ok: true, signedIn: true,
    tenants: tenantRows.length, leases: leaseRows.length,
    usingTenants, usingLeases, readAs, more,
    tenantShape: tenantRows[0] ? Object.keys(tenantRows[0]) : null,
    leaseShape: leaseRows[0] ? Object.keys(leaseRows[0]) : null,
  };

  const people: TenantRow[] = [];
  for (const t of tenantRows) {
    const id = num(pick(t, ["TenantID", "TenantId", "ID"], readAs, "tenantId"));
    if (id === null) continue;
    const lease = unitOf.get(id);
    const { phone, email } = reachOf(t, readAs);
    people.push({
      rmTenantId: id,
      name: readName(text(pick(t,
        ["Name", "LastNameFirstName", "TenantDisplayID"], readAs, "name"))),
      phone, email,
      status: text(pick(t, ["Status", "TenantStatus"], readAs, "status")),
      rmUnitId: lease?.unitId ?? null,
      rmPropertyId: lease?.propertyId
        ?? num(pick(t, ["PropertyID", "PropertyId"], readAs, "tenantProperty")),
    });
  }
  out.placed = people.filter((p) => p.rmUnitId !== null).length;
  out.samples = people.slice(0, 8);
  if (dryRun) return out;

  /* ----------------------------------------------------------- writing */
  const db = supabaseAdmin();

  const { data: unitRows } = await db.from("units")
    .select("id, rm_unit_id").not("rm_unit_id", "is", null);
  const unitByRm = new Map<number, string>();
  for (const u of unitRows ?? []) {
    unitByRm.set(Number(u.rm_unit_id), String(u.id));
  }

  for (const p of people) {
    if (Date.now() > until) { out.more = true; break; }
    const unitId = p.rmUnitId !== null ? unitByRm.get(p.rmUnitId) ?? null : null;
    const e164 = p.phone ? toE164(p.phone) : null;
    /* A number that is not a number is worse than none: `toE164` never
       returns null, so "n/a" comes back as "+", which every tenant
       without a number would then collide on. */
    const realPhone = e164 && isValidPhone(e164) ? e164 : null;

    const patch: Record<string, unknown> = {
      full_name: p.name ?? undefined,
      email: p.email ?? undefined,
      unit_id: unitId ?? undefined,
      party: "current_tenant",
      rm_tenant_id: p.rmTenantId,
    };

    try {
      // Already imported once: update in place, never a second record.
      const { data: mine } = await db.from("contacts")
        .select("id, phone").eq("rm_tenant_id", p.rmTenantId).maybeSingle();

      if (mine) {
        if (realPhone && mine.phone !== realPhone) patch.phone = realPhone;
        const { error } = await db.from("contacts").update(patch).eq("id", mine.id);
        if (error) throw new Error(error.message);
        out.updated += 1;
        continue;
      }

      /* ALREADY HERE UNDER THEIR OWN NUMBER. A tenant who has texted the
         mainline is a contact already, and `contacts.phone` is unique --
         inserting would be refused and the roster would silently skip
         the people we talk to most. Joined to them instead, which is the
         right answer anyway: one person, one record, their texts and
         their lease together. */
      if (realPhone) {
        const { data: known } = await db.from("contacts")
          .select("id").eq("phone", realPhone).maybeSingle();
        if (known) {
          const { error } = await db.from("contacts").update(patch).eq("id", known.id);
          if (error) throw new Error(error.message);
          out.merged += 1;
          continue;
        }
      }

      const { error } = await db.from("contacts").insert({
        ...patch,
        phone: realPhone ?? tenantPlaceholder(p.rmTenantId),
      });
      if (error) throw new Error(error.message);
      out.added += 1;
    } catch {
      out.failed += 1;
    }
  }

  return out;
}
