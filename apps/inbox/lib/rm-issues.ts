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
  /** Rent Manager's own flag, which is the one that decides whether this
   *  is still somebody's problem. */
  closed: boolean;
  closedOn: string | null;
  /** What was done about it. Written back when we close it here. */
  resolution: string | null;
};

export type PullResult = {
  ok: boolean;
  signedIn: boolean;
  dryRun: boolean;
  /** What came back, before anything was written. */
  found: number;
  /** The clock ran out or the page cap was reached, and Rent Manager has
   *  more. Pressing again carries on from where this stopped. */
  more: boolean;
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
 * These three and no others. The first version of this asked for
 * Property, Unit, Tenant, ServiceManagerStatus, ServiceManagerCategory
 * and ServiceManagerPriority, and the deep probe against this account
 * answered 404 to every single one -- which, asked as one list, would
 * have failed the whole request and quietly fallen back to bare records
 * with no status and no category on them.
 *
 * What answers is Category, Status and Priority, named plainly.
 *
 * NOTE WHAT IS NOT HERE. The issue record carries no PropertyID, no
 * UnitID and no TenantID, and Property, Unit and Tenant are not embeds
 * it accepts. So a Service Manager issue, as this endpoint hands it
 * over, DOES NOT SAY WHICH LOT IT IS FOR. That is not a thing to guess
 * at: `whereProbe` below is how to find out where Rent Manager keeps
 * it, and until it does, an issue arrives honestly saying its location
 * is unknown.
 */
const EMBEDS = "Category,Status,Priority";

/**
 * Pages, until there are no more or the clock runs out.
 *
 * The clock is the point. This deployment is on Vercel's Hobby plan,
 * where a function is killed at sixty seconds -- and when it is killed
 * the browser does not get a JSON error, it gets whatever Vercel serves
 * instead, which is how a working pull reported "Unexpected end of JSON
 * input" and said nothing about why.
 *
 * So it stops with time to spare and says there is more, which is a
 * true answer that arrives. Pressing the button again carries on, since
 * everything already filed is recognised and skipped.
 */
async function rows(
  session: RmSession, path: string,
  opts: { pages?: number; deadline?: number } = {},
): Promise<{ got: Record<string, unknown>[]; more: boolean }> {
  const out: Record<string, unknown>[] = [];
  const cap = opts.pages ?? 40;
  const deadline = opts.deadline ?? (Date.now() + 40_000);
  for (let p = 1; p <= cap; p++) {
    if (Date.now() > deadline) return { got: out, more: true };
    const join = path.includes("?") ? "&" : "?";
    const res = await fetch(
      `${session.base}${path}${join}pagesize=${PAGE}&pagenumber=${p}`,
      {
        headers: { [session.header]: session.token, Accept: "application/json" },
        cache: "no-store",
        // Well under what is left, so a slow page cannot eat the whole
        // allowance and leave nothing to report with.
        signal: AbortSignal.timeout(
          Math.max(5_000, Math.min(20_000, deadline - Date.now()))),
      },
    );
    if (!res.ok) {
      throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const body = await res.json();
    const batch = Array.isArray(body) ? body as Record<string, unknown>[] : [];
    out.push(...batch);
    if (batch.length < PAGE) return { got: out, more: false };
  }
  return { got: out, more: true };
}

/** The record, read into something this app understands. */
export function readIssue(
  row: Record<string, unknown>, readAs: Record<string, string> = {},
): Issue {
  // The real names first, from the deep probe against this account. The
  // alternatives stay behind them because another Rent Manager company
  // may well differ, and a list that has already been proved right for
  // the one that matters costs nothing to keep.
  const id = pick(row, ["ServiceManagerIssueID", "IssueID", "ID", "Id"], readAs, "id");
  const title = pick(row, ["Title", "Summary", "IssueTitle", "Subject", "Name"], readAs, "title");
  // `Description` is what the office typed. `CustomerDescription` is what
  // the tenant typed in Tenant Web Access, which on a request somebody
  // submitted themselves is the one that says what is actually wrong.
  const description = pick(row,
    ["CustomerDescription", "Description", "Details", "NoteText", "Comment"],
    readAs, "description");
  const tenant = pick(row, ["Tenant", "TenantName", "Contact"], readAs, "tenant");
  const unit = pick(row, ["Unit", "UnitNumber", "UnitName"], readAs, "unit");
  const property = pick(row, ["Property", "PropertyName"], readAs, "property");
  const status = pick(row,
    ["Status", "ServiceManagerStatus", "StatusName"], readAs, "status");
  const priority = pick(row,
    ["Priority", "ServiceManagerPriority", "PriorityName"], readAs, "priority");
  const category = pick(row,
    ["Category", "ServiceManagerCategory", "CategoryName"], readAs, "category");
  const createdAt = pick(row,
    ["CreateDate", "CreatedDate", "DateCreated", "ReportedDate"],
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
    closed: row.IsClosed === true,
    closedOn: text(pick(row, ["CloseDate"])),
    resolution: text(pick(row, ["Resolution"])),
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
  opts: {
    dryRun?: boolean; limit?: number;
    /** How many pages at most. */
    pages?: number;
    /** How long to spend before stopping and saying there is more. */
    seconds?: number;
  } = {},
): Promise<PullResult> {
  const dryRun = opts.dryRun !== false;
  const blank: PullResult = {
    ok: false, signedIn: false, dryRun, found: 0, more: false, filed: 0,
    alreadyHad: 0, failed: 0, shape: null, readAs: {}, samples: [], error: null,
  };

  const auth = await rmAuthorize();
  if (!auth.ok) {
    return { ...blank, error: "Rent Manager would not accept the sign-in." };
  }
  const session = auth.session;

  // With the embeds if they are accepted, without them if they are not. The
  // bare record still carries the issue; it just names fewer things.
  // A rehearsal reads one page. It exists to show what the records look
  // like and whether the field names are right, and forty pages of that
  // is forty round trips to answer a question the first page answers.
  const budget = {
    pages: dryRun ? 1 : (opts.pages ?? 40),
    deadline: Date.now() + (opts.seconds ?? 35) * 1000,
  };
  let raw: Record<string, unknown>[];
  let more = false;
  try {
    const got = await rows(session, `/ServiceManagerIssues?embeds=${EMBEDS}`, budget);
    raw = got.got; more = got.more;
  } catch {
    try {
      const got = await rows(session, "/ServiceManagerIssues", budget);
      raw = got.got; more = got.more;
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
    more,
    shape: raw[0] ? Object.keys(raw[0]) : null,
    readAs,
    samples: issues.slice(0, 5),
  };
  if (dryRun) return out;

  const until = Date.now() + (opts.seconds ?? 35) * 1000;
  for (const issue of issues) {
    // Each of these is a round trip of its own. Stopping with time left
    // and saying there is more beats being killed with nothing said.
    if (Date.now() > until) { out.more = true; break; }
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

/**
 * Closing an issue in Rent Manager, because it was closed here.
 *
 * The fields are known, from the deep probe against this account:
 * `IsClosed`, `CloseDate` and `Resolution` are all on the record. What is
 * NOT known is the verb and the shape rmAPI wants for an update, and that
 * is not something to find out by assuming -- a wrong write against
 * somebody's live property-management system is a worse outcome than no
 * write at all.
 *
 * So it tries, in order, and reports exactly what each attempt did:
 * PATCH the one record, PUT the one record, then POST a collection of one
 * (which is how several rmAPI endpoints take updates). The first that is
 * accepted wins and is remembered for the life of the instance, so the
 * searching happens once.
 *
 * Nothing here deletes, and nothing touches a field other than the three.
 */
type Writer = { verb: "PATCH" | "PUT" | "POST"; collection: boolean };
let worked: Writer | null = null;

const WRITERS: Writer[] = [
  { verb: "PATCH", collection: false },
  { verb: "PUT", collection: false },
  { verb: "POST", collection: true },
  { verb: "PATCH", collection: true },
];

export type CloseAttempt = {
  verb: string;
  path: string;
  status: number;
  ok: boolean;
  detail: string | null;
};

export type CloseResult = {
  ok: boolean;
  /** Which combination was accepted, so the next one goes straight there. */
  using: string | null;
  tried: CloseAttempt[];
};

export async function closeIssue(
  issueId: string, resolution: string, when = new Date(),
): Promise<CloseResult> {
  const auth = await rmAuthorize();
  if (!auth.ok) {
    return { ok: false, using: null, tried: [{
      verb: "-", path: "-", status: 0, ok: false,
      detail: "Rent Manager would not accept the sign-in.",
    }] };
  }
  const session = auth.session;
  const id = Number(issueId);
  if (!Number.isFinite(id)) {
    return { ok: false, using: null, tried: [{
      verb: "-", path: "-", status: 0, ok: false,
      detail: `"${issueId}" is not a Rent Manager issue id.`,
    }] };
  }

  // Only the three. Everything else on the record is somebody else's.
  const patch = {
    ServiceManagerIssueID: id,
    IsClosed: true,
    CloseDate: when.toISOString(),
    Resolution: resolution.slice(0, 4000),
  };

  const tried: CloseAttempt[] = [];
  const order = worked ? [worked, ...WRITERS.filter((w) => w !== worked)] : WRITERS;

  for (const w of order) {
    const path = w.collection ? "/ServiceManagerIssues" : `/ServiceManagerIssues/${id}`;
    try {
      const res = await fetch(`${session.base}${path}`, {
        method: w.verb,
        headers: {
          [session.header]: session.token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(w.collection ? [patch] : patch),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      const text = (await res.text()).slice(0, 220);
      tried.push({
        verb: `${w.verb}${w.collection ? " (as a list)" : ""}`,
        path, status: res.status, ok: res.ok, detail: res.ok ? null : text,
      });
      if (res.ok) {
        worked = w;
        return { ok: true, using: `${w.verb} ${path}`, tried };
      }
    } catch (e) {
      tried.push({
        verb: `${w.verb}${w.collection ? " (as a list)" : ""}`,
        path, status: 0, ok: false, detail: (e as Error).message,
      });
    }
  }
  return { ok: false, using: null, tried };
}
