/**
 * Who owes, read from Rent Manager this morning and placed at their unit
 * from what the tenant import already joined.
 *
 * The arithmetic and the wording are in `delinquency.ts`; this is the
 * fetching, which nothing on this machine can reach, so it reports what it
 * saw rather than assuming.
 */
import { rmAuthorize, type RmSession } from "./rentmanager";
import { supabaseAdmin } from "./supabase-admin";
import {
  daysBetween, pick, readName, readOwed, num,
  type Debtor, type Report,
} from "./delinquency";

const PAGE = 100;

/* The spellings to try, most informative first. One at a time and never
   as one embeds list: an embed this account refuses fails the whole
   request, and the request would then fall back to bare records that say
   nothing about money. Open receivables come first because they also say
   how OLD the debt is, which a bare balance cannot. */
const TENANT_PATHS = [
  "/Tenants?embeds=OpenReceivables",
  "/Tenants?embeds=Balance",
  "/Tenants",
];

async function page(session: RmSession, path: string, p: number): Promise<Record<string, unknown>[]> {
  const join = path.includes("?") ? "&" : "?";
  const res = await fetch(`${session.base}${path}${join}pagesize=${PAGE}&pagenumber=${p}`, {
    headers: { [session.header]: session.token, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data as Record<string, unknown>[] : [];
}

/** Read the whole roster through one spelling. Null when that spelling is
 *  refused OR answers without any balance on it -- a roster with no money
 *  on it is not "nobody owes". */
async function through(
  session: RmSession, path: string, until: number, tried: string[],
): Promise<{ rows: Record<string, unknown>[]; partial: boolean; readAs: Record<string, string> } | null> {
  const rows: Record<string, unknown>[] = [];
  let partial = false;
  try {
    for (let p = 1; p <= 60; p++) {
      if (Date.now() > until) { partial = true; break; }
      const batch = await page(session, path, p);
      rows.push(...batch);
      if (batch.length < PAGE) break;
      // Check the first page says something about money before reading
      // the other fifty -- a spelling with no balance on it is a waste of
      // the minute this has.
      if (p === 1) {
        const probe: Record<string, string> = {};
        if (!batch.some((t) => readOwed(t, probe) !== null)) {
          tried.push(`${path}: no balance on the records (fields: ${Object.keys(batch[0] ?? {}).join(", ")})`);
          return null;
        }
      }
    }
  } catch (e) {
    tried.push((e as Error).message);
    return null;
  }
  const readAs: Record<string, string> = {};
  if (!rows.some((t) => readOwed(t, readAs) !== null)) {
    tried.push(`${path}: no balance on the records (fields: ${Object.keys(rows[0] ?? {}).join(", ")})`);
    return null;
  }
  return { rows, partial, readAs };
}

export async function pullDelinquency(day: string, seconds = 42): Promise<Report> {
  const blank: Report = {
    day, ok: false, error: null, debtors: [], tenantsRead: 0, partial: false,
    using: null, readAs: {},
  };

  const auth = await rmAuthorize();
  if (!auth.ok) {
    return { ...blank, error: "Rent Manager would not accept the sign-in, so no balances could be read." };
  }
  const until = Date.now() + seconds * 1000;
  const tried: string[] = [];

  let got: Awaited<ReturnType<typeof through>> = null;
  let using: string | null = null;
  for (const path of TENANT_PATHS) {
    got = await through(auth.session, path, until, tried);
    if (got) { using = path; break; }
    if (Date.now() > until) break;
  }
  if (!got) {
    return {
      ...blank,
      error: "Rent Manager answered, but none of the ways of asking returned a balance. "
        + tried.join(" | "),
    };
  }

  const { rows, partial, readAs } = got;
  const owing: { id: number; name: string; status: string | null; balance: number; oldest: string | null }[] = [];
  for (const t of rows) {
    const id = num(pick(t, ["TenantID", "TenantId", "ID"], readAs, "tenantId"));
    if (id === null) continue;
    const o = readOwed(t, readAs);
    // A credit is not a debt, and a few cents is rounding.
    if (!o || o.balance < 1) continue;
    const name = readName(String(pick(t, ["Name", "LastNameFirstName", "TenantDisplayID"], readAs, "name") ?? ""))
      ?? `Tenant ${id}`;
    const status = pick(t, ["Status", "TenantStatus"], readAs, "status");
    owing.push({
      id, name,
      status: typeof status === "string" ? status : null,
      balance: o.balance, oldest: o.oldest,
    });
  }

  /* WHERE THEY LIVE, from what the tenant import already joined:
     contacts.rm_tenant_id -> unit -> property. A tenant the import never
     placed still appears, saying so, rather than vanishing from a list
     about money. */
  const place = new Map<number, string>();
  if (owing.length) {
    const db = supabaseAdmin();
    const { data } = await db.from("contacts")
      .select("rm_tenant_id, units(label, properties(name))")
      .in("rm_tenant_id", owing.map((o) => o.id));
    for (const c of (data ?? []) as unknown as {
      rm_tenant_id: number;
      units: { label: string | null; properties: { name: string | null } | null } | null;
    }[]) {
      const u = c.units;
      if (!u) continue;
      const where = [u.properties?.name, u.label].filter(Boolean).join(" · ");
      if (where) place.set(Number(c.rm_tenant_id), where);
    }
  }

  const debtors: Debtor[] = owing.map((o) => ({
    rmTenantId: o.id, name: o.name, status: o.status,
    place: place.get(o.id) ?? null,
    balance: o.balance, oldest: o.oldest,
    daysLate: o.oldest ? daysBetween(o.oldest, day) : null,
  }));

  return { ...blank, ok: true, debtors, tenantsRead: rows.length, partial, using, readAs };
}
