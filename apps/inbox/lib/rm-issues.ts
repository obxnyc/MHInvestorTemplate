/**
 * The maintenance requests tenants submitted, fetched from Rent Manager.
 *
 * A tenant fills the form in Tenant Web Access. Rent Manager records it as a
 * Service Manager issue and emails a notification. This app was built to
 * catch that email -- `parseRentManager` reads it, and the router already
 * recognises it three ways -- but the email only arrives if a Gmail filter
 * forwards it to Postmark and Postmark reaches here, and every one of those
 * is somewhere a request can fall down silently.
 *
 * The issue itself never falls down: it is in Rent Manager, which is where
 * the tenant put it. So this asks for it rather than waiting to be told.
 *
 * Two things follow from that:
 *
 *   - It is re-runnable. `ingest` refuses an `external_id` it has seen, so
 *     the same issue pulled twice is one conversation.
 *   - It backfills. Everything already submitted comes across the first time
 *     it runs, which is the point: those requests exist, and nobody has them.
 *
 * FIELD NAMES ARE A HYPOTHESIS. This account is on Rent Manager Express, the
 * documentation is not reachable from the machine this was written on, and
 * the probe can see that /ServiceManagerIssues answers but not what it calls
 * things. So every field is read through `pick`, which tries the spellings
 * rmAPI is known to use and the ones its other endpoints use, and the result
 * reports which ones it actually found. Guessing once and failing silently is
 * the failure this whole function exists to end.
 */
import { rmAuthorize, type RmSession } from "./rentmanager";
import { ingest } from "./intake";

const PAGE = 100;

/** One issue, as much of it as the account turns out to carry. */
export type Issue = {
  id: string;
  title: string | null;
  description: string | null;
  tenant: string | null;
  phone: string | null;
  email: string | null;
  unit: string | null;
  property: string | null;
  status: string | null;
  priority: string | null;
  category: string | null;
  createdAt: string | null;
};

export type PullResult = {
  ok: boolean;
  signedIn: boolean;
  dryRun: boolean;
  /** What came back, before anything was written. */
  found: number;
  filed: number;
  alreadyHad: number;
  failed: number;
  /** The field names on the first record. The map, when something is
   *  missing and nobody knows what this account calls it. */
  shape: string[] | null;
  /** Which spelling answered for each thing we wanted. Empty where the
   *  record carried none of them. */
  readAs: Record<string, string>;
  samples: Issue[];
  error: string | null;
};

/** The first of these keys the record actually has, and what it was called. */
function pick(
  row: Record<string, unknown>, keys: string[], found?: Record<string, string>,
  as?: string,
): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") {
      if (found && as) found[as] = k;
      return v;
    }
  }
  return null;
}

/** A nested record's name, whatever the nesting is called. */
function nameOf(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["Name", "Description", "Number", "UnitNumber", "ShortName"]) {
      const got = o[k];
      if (typeof got === "string" && got.trim()) return got.trim();
      if (typeof got === "number") return String(got);
    }
  }
  return null;
}

const text = (v: unknown): string | null => {
  const s = nameOf(v);
  return s && s.trim() ? s.trim() : null;
};

/**
 * The embeds that make an issue readable.
 *
 * Asked for together because this is a fetch and not a probe -- if the whole
 * list is refused, the bare records still come back on the retry below, and a
 * request with no tenant name on it still beats not knowing it exists.
 */
const EMBEDS = "Property,Unit,Tenant,ServiceManagerStatus,"
  + "ServiceManagerCategory,ServiceManagerPriority";

async function rows(session: RmSession, path: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let p = 1; p <= 40; p++) {
    const join = path.includes("?") ? "&" : "?";
    const res = await fetch(
      `${session.base}${path}${join}pagesize=${PAGE}&pagenumber=${p}`,
      {
        headers: { [session.header]: session.token, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!res.ok) {
      throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const body = await res.json();
    const batch = Array.isArray(body) ? body as Record<string, unknown>[] : [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/** The record, read into something this app understands. */
export function readIssue(
  row: Record<string, unknown>, readAs: Record<string, string> = {},
): Issue {
  const id = pick(row, ["ServiceManagerIssueID", "IssueID", "ID", "Id"], readAs, "id");
  const title = pick(row, ["Summary", "Title", "IssueTitle", "Subject", "Name"], readAs, "title");
  const description = pick(row,
    ["Description", "Details", "IssueDescription", "Comment", "Notes"], readAs, "description");
  const tenant = pick(row, ["Tenant", "TenantName", "Contact"], readAs, "tenant");
  const unit = pick(row, ["Unit", "UnitNumber", "UnitName"], readAs, "unit");
  const property = pick(row, ["Property", "PropertyName"], readAs, "property");
  const status = pick(row,
    ["ServiceManagerStatus", "Status", "StatusName"], readAs, "status");
  const priority = pick(row,
    ["ServiceManagerPriority", "Priority", "PriorityName"], readAs, "priority");
  const category = pick(row,
    ["ServiceManagerCategory", "Category", "CategoryName"], readAs, "category");
  const createdAt = pick(row,
    ["CreateDate", "CreatedDate", "DateCreated", "ReportedDate", "CreateUserDate"],
    readAs, "createdAt");

  // A phone and an email live on the embedded tenant where there is one.
  const t = typeof tenant === "object" && tenant ? tenant as Record<string, unknown> : null;
  const phones = t?.PhoneNumbers;
  const phone = Array.isArray(phones) && phones.length
    ? text((phones[0] as Record<string, unknown>)?.PhoneNumber
        ?? (phones[0] as Record<string, unknown>)?.Number)
    : text(pick(row, ["Phone", "PhoneNumber", "Number"]));

  return {
    id: String(id ?? ""),
    title: text(title),
    description: text(description),
    tenant: text(tenant),
    phone,
    email: text(t?.Email ?? pick(row, ["Email", "EmailAddress"])),
    unit: text(unit),
    property: text(property),
    status: text(status),
    priority: text(priority),
    category: text(category),
    createdAt: text(createdAt),
  };
}

/** How the issue reads in the inbox: where it is, then what is wrong. */
export function summarise(issue: Issue): string {
  const where = [issue.property, issue.unit && `Lot ${issue.unit}`]
    .filter(Boolean).join(" ");
  const what = issue.title || issue.description || "Maintenance request";
  return [where, what].filter(Boolean).join(" — ");
}

/** Everything about the issue, as the body of the message. */
export function detail(issue: Issue): string {
  return [
    issue.title && `Issue: ${issue.title}`,
    issue.description && `Description: ${issue.description}`,
    issue.tenant && `Tenant: ${issue.tenant}`,
    issue.phone && `Number: ${issue.phone}`,
    issue.email && `Email: ${issue.email}`,
    issue.property && `Property: ${issue.property}`,
    issue.unit && `Unit: ${issue.unit}`,
    issue.category && `Category: ${issue.category}`,
    issue.priority && `Priority: ${issue.priority}`,
    issue.status && `Status: ${issue.status}`,
    issue.createdAt && `Submitted: ${issue.createdAt}`,
    `\nFrom Rent Manager Service Manager, issue ${issue.id}.`,
  ].filter(Boolean).join("\n");
}

/**
 * Pull them across.
 *
 * A rehearsal unless told otherwise, for the same reason the portfolio import
 * is: the first run of something that writes to the inbox should be readable
 * before it is believed.
 */
export async function pullServiceIssues(
  opts: { dryRun?: boolean; limit?: number } = {},
): Promise<PullResult> {
  const dryRun = opts.dryRun !== false;
  const blank: PullResult = {
    ok: false, signedIn: false, dryRun, found: 0, filed: 0, alreadyHad: 0,
    failed: 0, shape: null, readAs: {}, samples: [], error: null,
  };

  const auth = await rmAuthorize();
  if (!auth.ok) {
    return { ...blank, error: "Rent Manager would not accept the sign-in." };
  }
  const session = auth.session;

  // With the embeds if they are accepted, without them if they are not. The
  // bare record still carries the issue; it just names fewer things.
  let raw: Record<string, unknown>[];
  try {
    raw = await rows(session, `/ServiceManagerIssues?embeds=${EMBEDS}`);
  } catch {
    try {
      raw = await rows(session, "/ServiceManagerIssues");
    } catch (e) {
      return { ...blank, signedIn: true, error: (e as Error).message };
    }
  }

  const readAs: Record<string, string> = {};
  const issues = raw.map((r) => readIssue(r, readAs))
    .filter((i) => i.id)
    .slice(0, opts.limit ?? 500);

  const out: PullResult = {
    ...blank,
    ok: true, signedIn: true,
    found: issues.length,
    shape: raw[0] ? Object.keys(raw[0]) : null,
    readAs,
    samples: issues.slice(0, 5),
  };
  if (dryRun) return out;

  for (const issue of issues) {
    try {
      const res = await ingest({
        // The same key the email path uses, so an issue that arrives both
        // ways is one thread and not two.
        source: "zego",
        name: issue.tenant,
        phone: issue.phone,
        email: issue.email,
        unitHint: issue.unit,
        summary: summarise(issue),
        raw: detail(issue),
        category: "maintenance",
        externalId: `rm:issue:${issue.id}`,
      });
      if (res.duplicate) out.alreadyHad += 1;
      else if (res.ok) out.filed += 1;
      else out.failed += 1;
    } catch {
      out.failed += 1;
    }
  }
  return out;
}
