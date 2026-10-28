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
  /** WHO SUBMITTED IT, as Rent Manager's own id for the Tenant Web Access
   *  account that filled the form in.
   *
   *  This IS on the bare record and was being read past and thrown away,
   *  which is the whole reason a request could arrive with nothing to
   *  identify it. The Property, Unit and Tenant embeds all 404 on this
   *  account -- measured -- so this number is the only thread on the record
   *  that leads back to a person, and until now nothing held on to it.
   *
   *  It is not a name. It is the key that gets one. */
  webUserId: string | null;
  /** The staff account that opened it, where the office raised it rather
   *  than a tenant. Kept for the same reason: it says which of the two this
   *  is. */
  openedById: string | null;
};

export type PullResult = {
  ok: boolean;
  signedIn: boolean;
  dryRun: boolean;
  /** How many requests had a tenant put back on them from the web user id.
   *  Zero with issues missing one means no candidate endpoint answered. */
  whoFound: number;
  /** Every path tried for the first lookup, so a failure names the guesses
   *  rather than just not working. */
  whoTried?: WhoAttempt[];
  /** The field names on whatever answered. The map for the next guess. */
  whoShape?: string[] | null;
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

  /* The submitter. `CreateWebUserID` is the Tenant Web Access account that
     filled the form in -- a tenant. `CreateUserID` is a staff login, which
     means the office raised it. Both are plain numbers on the bare record. */
  const webUserId = pick(row,
    ["CreateWebUserID", "WebUserID", "TenantWebUserID"], readAs, "webUserId");
  const openedById = pick(row, ["CreateUserID", "CreatedByUserID"], readAs, "openedById");

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
    webUserId: text(webUserId),
    openedById: text(openedById),
  };
}

/** How the issue reads in the inbox: where it is, then what is wrong. */
export function summarise(issue: Issue): string {
  const where = [issue.property, issue.unit && `Lot ${issue.unit}`]
    .filter(Boolean).join(" ");
  const what = issue.title || issue.description || "Maintenance request";
  return [where, what].filter(Boolean).join(" — ");
}

/* ----------------------------------------------- who submitted a request
 *
 * `/ServiceManagerIssues` hands an issue over with no tenant, no phone and
 * no lot -- the Property, Unit and Tenant embeds all 404 on this account,
 * which was measured rather than assumed. What IS on the record is
 * `CreateWebUserID`: Rent Manager's own id for the Tenant Web Access account
 * that filled the form in.
 *
 * It is not a name. It is the key that gets one, and nothing was holding on
 * to it, which is why a request could arrive identifying nobody.
 *
 * WHICH ENDPOINT TURNS THAT KEY IS A HYPOTHESIS. Rent Manager Express, docs
 * not reachable from here, no credentials on this machine. So this does what
 * `closeIssue` does with its verb: tries the candidates in order, reports
 * exactly what each attempt did, and remembers the one that answered. A guess
 * that reports what it saw can be corrected in one round; a guess that fails
 * silently cannot be corrected at all.
 */
const WHO_PATHS = [
  (id: string) => `/TenantWebUsers/${id}?embeds=Tenant,Tenant/Unit,Tenant/Unit/Property,Tenant/PhoneNumbers`,
  (id: string) => `/TenantWebUsers/${id}?embeds=Tenant`,
  (id: string) => `/TenantWebUsers/${id}`,
  (id: string) => `/WebUsers/${id}?embeds=Tenant`,
  (id: string) => `/WebUsers/${id}`,
  (id: string) => `/TenantWebUsers?filters=TenantWebUserID,eq,${id}&embeds=Tenant`,
  (id: string) => `/WebUsers?filters=WebUserID,eq,${id}&embeds=Tenant`,
];

/** Which of them answered last time. Tried first from then on. */
let whoWorked: number | null = null;
/** Set once every candidate has failed, so a run stops asking. Asking seven
 *  times per issue on an account that has never seen API traffic is not a
 *  good way to behave, and the answer will not have changed within a run. */
let whoHopeless = false;

export type WhoAttempt = {
  path: string; status: number; ok: boolean; detail: string | null;
};

/** What a web user turned out to be, and what was tried to find out. */
export type Who = {
  tenant: string | null;
  phone: string | null;
  email: string | null;
  unit: string | null;
  property: string | null;
  /** Every attempt, in order, so a failure says which names were tried. */
  tried: WhoAttempt[];
  /** The field names on whatever answered -- the map, for the next guess. */
  shape: string[] | null;
};

const EMPTY_WHO: Who = {
  tenant: null, phone: null, email: null, unit: null, property: null,
  tried: [], shape: null,
};

export async function whoSubmitted(
  webUserId: string, session: RmSession,
): Promise<Who> {
  if (!webUserId || whoHopeless) return { ...EMPTY_WHO };

  const order = whoWorked === null
    ? WHO_PATHS.map((_, i) => i)
    : [whoWorked, ...WHO_PATHS.map((_, i) => i).filter((i) => i !== whoWorked)];

  const tried: WhoAttempt[] = [];
  for (const i of order) {
    const path = WHO_PATHS[i]!(webUserId);
    try {
      const res = await fetch(`${session.base}${path}`, {
        headers: { [session.header]: session.token, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.text();
      if (!res.ok) {
        tried.push({ path, status: res.status, ok: false,
                     detail: body.slice(0, 160) || res.statusText });
        continue;
      }
      let data: unknown;
      try { data = JSON.parse(body); } catch {
        tried.push({ path, status: res.status, ok: false,
                     detail: "answered, but not JSON" });
        continue;
      }
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (!row || typeof row !== "object") {
        tried.push({ path, status: res.status, ok: true,
                     detail: "answered, but with nothing in it" });
        continue;
      }

      /* The tenant may be the record itself or hung off it, and the field
         names are the same hypothesis as everywhere else in this file. */
      const t = (row.Tenant ?? row.tenant ?? row) as Record<string, unknown>;
      const name = text(pick(t, ["Name", "TenantName", "DisplayName", "FullName"]))
        ?? text(pick(row, ["Name", "TenantName", "DisplayName"]));
      const u = (t.Unit ?? row.Unit) as Record<string, unknown> | undefined;
      const prop = (u?.Property ?? t.Property ?? row.Property) as Record<string, unknown> | undefined;
      const phones = (t.PhoneNumbers ?? row.PhoneNumbers) as unknown;

      const found: Who = {
        tenant: name,
        phone: Array.isArray(phones) && phones.length
          ? text((phones[0] as Record<string, unknown>)?.PhoneNumber
              ?? (phones[0] as Record<string, unknown>)?.Number)
          : text(pick(t, ["Phone", "PhoneNumber", "Number"])),
        email: text(pick(t, ["Email", "EmailAddress"]))
          ?? text(pick(row, ["Email", "EmailAddress"])),
        unit: text(pick((u ?? {}) as Record<string, unknown>,
          ["Name", "UnitNumber", "UnitName"])),
        property: text(pick((prop ?? {}) as Record<string, unknown>,
          ["Name", "PropertyName"])),
        tried: [...tried, { path, status: res.status, ok: true, detail: null }],
        shape: Object.keys(row),
      };

      /* A 200 with nothing recognisable on it is not an answer. Remembering
         it would pin every later lookup to an endpoint that never helps. */
      if (found.tenant || found.unit || found.property) {
        whoWorked = i;
        return found;
      }
      tried.push({ path, status: res.status, ok: true,
                   detail: `answered, but nothing here names a tenant: ${
                     Object.keys(row).slice(0, 12).join(", ")}` });
    } catch (e) {
      tried.push({ path, status: 0, ok: false, detail: (e as Error).message });
    }
  }

  // Every one refused. Say so once and stop asking for the rest of this run.
  whoHopeless = true;
  return { ...EMPTY_WHO, tried };
}

/** For the harness: forget what was learned. */
export function forgetWho() { whoWorked = null; whoHopeless = false; }

/** Everything about the issue, as the body of the message. */
export function detail(issue: Issue): string {
  /* WHAT IS MISSING IS SAID, NOT LEFT BLANK.
   *
   * A request can arrive here with no tenant, no number and no lot, because
   * `/ServiceManagerIssues` hands the issue over without them -- the Property,
   * Unit and Tenant embeds all 404 on this account and the bare record carries
   * no PropertyID, UnitID or TenantID either. Proved by the probe, not
   * assumed.
   *
   * Left blank, that reads as the inbox losing the details. Said out loud, it
   * is a known gap with a known cause and somebody can act on it: the
   * notification email carries the tenant's name, their number and the lot in
   * its subject line, so a request that came the other way has all three.
   *
   * The same rule as the property line that only ever said whether a line
   * existed. A screen that leaves a field empty is answering "we do not have
   * this" and "nobody has looked" with the same blank.
   */
  const missing = [
    !issue.tenant && "who submitted it",
    !issue.phone && !issue.email && "any way to contact them",
    !issue.unit && !issue.property && "which lot it is for",
  ].filter(Boolean) as string[];

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
    missing.length
      && `Rent Manager did not say ${missing.join(", nor ")}. It does not put`
         + ` that on a Service Manager issue. The notification email does —`
         + ` tenant, number and lot — so a request that arrives by email`
         + ` carries all of it.`,
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
  whoFound: 0,
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

  /* WHO SENT IT, where the record did not say.
   *
   * Cached by web user for the run: several requests from the same tenant in
   * one pull cost one lookup, not one each. Only asked when the issue has no
   * tenant on it already -- an issue that arrived complete is not improved by
   * another round trip. */
  const people = new Map<string, Who>();
  const lookUp = async (id: string): Promise<Who> => {
    const had = people.get(id);
    if (had) return had;
    const got = await whoSubmitted(id, session);
    people.set(id, got);
    if (got.tried.length && !out.whoTried) out.whoTried = got.tried;
    if (got.shape && !out.whoShape) out.whoShape = got.shape;
    return got;
  };

  for (const issue of issues) {
    // Each of these is a round trip of its own. Stopping with time left
    // and saying there is more beats being killed with nothing said.
    if (Date.now() > until) { out.more = true; break; }
    /* Filled in BEFORE filing, so the thread has a name and a number on it
       from the first moment rather than being corrected later. */
    if (issue.webUserId && !issue.tenant) {
      const who = await lookUp(issue.webUserId);
      issue.tenant ??= who.tenant;
      issue.phone ??= who.phone;
      issue.email ??= who.email;
      issue.unit ??= who.unit;
      issue.property ??= who.property;
      if (who.tenant) out.whoFound += 1;
    }

    try {
      const res = await ingest({
        /* `source` is the maintenance-intake key, the same one the email
           path uses -- but it is NOT what stops a double. The duplicate
           check in `ingest` is on `external_id`, and the two paths cannot
           agree on one: this knows the Rent Manager issue number, the
           notification email knows only its own Message-ID, and neither
           appears in the other. So a request arriving BOTH ways is two
           threads -- and the comment that used to sit here said the
           opposite. A comment promising a guarantee the code does not give
           is worse than no comment: it is where somebody stops looking. */
        source: "zego",
        /* WHEN THE TENANT SUBMITTED IT, not when we got round to asking.
           Without this every backfilled issue is stamped now, so eight
           months of history arrives at the top of the inbox reading "just
           now" -- which is what "a lot of maintenance requests today"
           turned out to be. */
        at: issue.createdAt,
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
