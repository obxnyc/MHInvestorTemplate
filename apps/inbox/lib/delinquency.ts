/**
 * The morning delinquency report: who owes, how much, and for how long.
 *
 * Pure functions, no imports, so `delinquency-check.mjs` can run every one
 * of them without a database or Rent Manager. The fetching lives in
 * `delinquency-pull.ts`.
 *
 * THE BALANCE IS RENT MANAGER'S. This app keeps no rent ledger -- the home
 * dashboard says so in as many words -- so the only honest source for "who
 * is behind" is the system the payments are posted in, asked fresh every
 * morning. Nothing here is stored or totalled from anywhere else.
 *
 * FIELD NAMES ARE A HYPOTHESIS, as everywhere else against this account:
 * Rent Manager Express, documentation not reachable from the machine this
 * was written on. So the balance is read through `pick` over the spellings
 * rmAPI is known to use, and the report says which spelling answered. A
 * guess that says what it saw is correctable in one round.
 */

export type Charge = { open: number; date: string | null };

export type Debtor = {
  rmTenantId: number;
  name: string;
  status: string | null;
  /** "The Retreat · Lot 14", when we know which unit they are in. */
  place: string | null;
  /** Dollars owed, positive. */
  balance: number;
  /** Date of the oldest charge still open, YYYY-MM-DD, when known. */
  oldest: string | null;
  /** Days since that charge, when known. */
  daysLate: number | null;
  /** A number to ring, E.164, when we hold one for them. */
  phone?: string | null;
};

export type Report = {
  /** New York calendar day, YYYY-MM-DD. */
  day: string;
  ok: boolean;
  /** Why there is no report, in a sentence somebody can act on. */
  error: string | null;
  debtors: Debtor[];
  /** How many tenant records were read, so "nobody owes" can be told apart
   *  from "nothing was read". */
  tenantsRead: number;
  /** True when the run stopped before reading every page. */
  partial: boolean;
  /** Which request and which fields answered. */
  using: string | null;
  readAs: Record<string, string>;
};

/* ---------------------------------------------------------------- reading */

export function pick(
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

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const dateOnly = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
};

/** One open charge: what is still owed on it, and when it was charged.
 *  An amount still due beats amount-minus-paid, because it is what Rent
 *  Manager itself says is left; the subtraction is the fallback. */
export function readCharge(c: Record<string, unknown>, readAs: Record<string, string>): Charge | null {
  let open = num(pick(c, ["AmountDue", "OpenAmount", "Balance", "AmountOpen", "RemainingAmount"],
    readAs, "chargeOpen"));
  if (open === null) {
    const amount = num(pick(c, ["Amount", "ChargeAmount", "TotalAmount"], readAs, "chargeAmount"));
    if (amount === null) return null;
    const paid = num(pick(c, ["AmountAllocated", "AllocatedAmount", "AmountPaid", "PaidAmount"],
      readAs, "chargePaid")) ?? 0;
    open = amount - paid;
  }
  return {
    open,
    date: dateOnly(pick(c, ["TransactionDate", "DueDate", "ChargeDate", "PostDate", "Date"],
      readAs, "chargeDate")),
  };
}

/**
 * What a tenant record says they owe, or null when it says nothing.
 *
 * NULL IS NOT ZERO. A record with no balance field on it has not said the
 * tenant is paid up, and a report built on that reading would tell four
 * people every morning that nobody owes anything.
 */
export function readOwed(
  t: Record<string, unknown>, readAs: Record<string, string>,
): { balance: number; oldest: string | null } | null {
  const list = t.OpenReceivables ?? t.openReceivables ?? t.OpenCharges;
  if (Array.isArray(list)) {
    let balance = 0;
    let oldest: string | null = null;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const c = readCharge(raw as Record<string, unknown>, readAs);
      if (!c || c.open <= 0.004) continue;
      balance += c.open;
      if (c.date && (!oldest || c.date < oldest)) oldest = c.date;
    }
    readAs.balance ??= "OpenReceivables";
    return { balance: Math.round(balance * 100) / 100, oldest };
  }

  let b = pick(t, ["Balance", "OpenBalance", "CurrentBalance", "TotalBalance", "BalanceDue"],
    readAs, "balance");
  // An embed can come back as a little record rather than a number.
  if (b && typeof b === "object" && !Array.isArray(b)) {
    b = pick(b as Record<string, unknown>, ["Balance", "TotalBalance", "Amount", "Value"],
      readAs, "balanceInner");
  }
  const n = num(b);
  return n === null ? null : { balance: Math.round(n * 100) / 100, oldest: null };
}

/** "Larabee, Megan" is how Rent Manager writes a name and not how anybody
 *  says one. */
export function readName(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const comma = s.indexOf(",");
  if (comma < 0) return s || null;
  const last = s.slice(0, comma).trim();
  const first = s.slice(comma + 1).trim();
  return first && last ? `${first} ${last}` : s;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/* ---------------------------------------------------------------- the clock */

/** The calendar day and hour in New York for a given instant. The office is
 *  in North Carolina, so "10am" is Eastern whichever side of daylight saving
 *  the morning falls on. */
export function newYork(at: Date): { day: string; hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    weekday: get("weekday"),
  };
}

/** The hour the report goes out, Eastern. The database asks twice a day, an
 *  hour apart, because a schedule written in UTC lands on 10 in New York
 *  for half the year and 9 or 11 for the other half; only the one that is
 *  actually 10 sends. */
export const SEND_HOUR = 10;

/* ---------------------------------------------------------------- who gets it */

export type Recipient = { email: string; name: string | null; starts_on: string | null; ends_on: string | null };

/** Who gets today's report. Somebody starting on the 15th is on the list
 *  now and receives nothing until the 15th. */
export function activeRecipients(all: Recipient[], day: string): Recipient[] {
  return all.filter((r) =>
    r.email && r.email.includes("@")
    && (!r.starts_on || r.starts_on <= day)
    && (!r.ends_on || r.ends_on > day));
}

/* ---------------------------------------------------------------- writing it */

export const usd = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const BUCKETS = [
  { label: "0–30 days", lo: 0, hi: 30 },
  { label: "31–60 days", lo: 31, hi: 60 },
  { label: "61–90 days", lo: 61, hi: 90 },
  { label: "Over 90 days", lo: 91, hi: Infinity },
] as const;

export function isCurrent(status: string | null): boolean {
  return status === null || /current|active|notice/i.test(status);
}

function longDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/* ---------------------------------------------------------------- vacancies */

/**
 * A home on the vacancy list.
 *
 * The list is what the office has marked FOR RENT or UPCOMING on the
 * Properties page (`units.listing`, migration 052) -- not Rent Manager's
 * vacant flag, which counts every bare pad in a park bought last month and
 * would bury the six homes anybody can actually show under a hundred lots
 * with nothing on them.
 */
export type Vacancy = {
  place: string;
  status: "for_rent" | "upcoming";
  /** Dollars a month, when on file. */
  rent: number | null;
  beds: number | null;
  baths: number | null;
  /** Days since it was marked for rent. Null when nobody measured -- a home
   *  already on the market before the field existed. */
  daysListed: number | null;
  /** Upcoming: the best guess at when it is ready, YYYY-MM-DD. */
  readyOn: string | null;
  /** What it is waiting on, when somebody has said. */
  blocker: string | null;
  upcomingShowings: number;
  recentShowings: number;
  nextShowing: string | null;
};

export type Vacancies = {
  list: Vacancy[];
  /** Anything the reader needs to know about how complete this is. */
  note: string | null;
} | null;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US",
  { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });

const dayDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US",
  { month: "short", day: "numeric", timeZone: "UTC" });

/** "ready about Dec 1 (3 weeks)", or "overdue since Nov 12" -- a date that
 *  has passed on a home still marked upcoming is the thing to chase. */
export function readyText(readyOn: string | null, day: string): string | null {
  if (!readyOn) return null;
  if (readyOn < day) return `overdue, was due ${dayDate(readyOn)}`;
  const n = daysBetween(day, readyOn);
  const away = n === 0 ? "today" : n === 1 ? "tomorrow"
    : n < 14 ? `${n} days` : `${Math.round(n / 7)} weeks`;
  return `ready about ${dayDate(readyOn)} (${away})`;
}

function size(v: Vacancy): string | null {
  return v.beds != null || v.baths != null ? `${v.beds ?? "?"} bd / ${v.baths ?? "?"} ba` : null;
}

function showText(v: Vacancy): string {
  const out: string[] = [];
  if (v.upcomingShowings) out.push(`${v.upcomingShowings} showing${v.upcomingShowings === 1 ? "" : "s"} booked${v.nextShowing ? `, next ${shortDate(v.nextShowing)}` : ""}`);
  if (v.recentShowings) out.push(`${v.recentShowings} shown in the last 2 weeks`);
  return out.join("; ");
}

/** For rent: longest on the market first, because that one is costing the
 *  most. Upcoming: soonest ready first, because that is the next one to
 *  list. */
export function sortVacancies(list: Vacancy[]): { forRent: Vacancy[]; upcoming: Vacancy[] } {
  const forRent = list.filter((v) => v.status === "for_rent").sort((a, b) =>
    (b.daysListed ?? -1) - (a.daysListed ?? -1) || a.place.localeCompare(b.place));
  const upcoming = list.filter((v) => v.status === "upcoming").sort((a, b) =>
    (a.readyOn ?? "9999") .localeCompare(b.readyOn ?? "9999") || a.place.localeCompare(b.place));
  return { forRent, upcoming };
}

/* ---------------------------------------------------------------- the email */

/* ---------------------------------------------------------------- new leads */

/**
 * Somebody new wanting a home, in the last day.
 *
 * Applications and inquiries recorded in this app, showings booked here,
 * and prospects Rent Manager has on file -- wherever the person actually
 * turned up. `source` says which, because the app's own tables had never
 * held a single row when this was written: the leads were arriving
 * somewhere else, and a section reading only the app would have said
 * "none" every morning with total confidence.
 */
export type Lead = {
  kind: "application" | "inquiry" | "showing" | "prospect";
  name: string;
  phone: string | null;
  /** One line: what they want or did. */
  what: string;
  /** When it came in, ISO. */
  at: string;
  source: "app" | "rent manager";
};

export type Leads = {
  list: Lead[];
  /** What could not be read, said rather than shown as zero. */
  notes: string[];
} | null;

const KIND_WORD: Record<Lead["kind"], string> = {
  application: "Application", inquiry: "Inquiry", showing: "Showing booked", prospect: "Prospect",
};

/** Applications first: somebody who has filled in the form is the
 *  nearest thing to a signed lease on this list. Newest first within. */
export function sortLeads(list: Lead[]): Lead[] {
  const rank = { application: 0, showing: 1, inquiry: 2, prospect: 3 } as const;
  return [...list].sort((a, b) => rank[a.kind] - rank[b.kind] || b.at.localeCompare(a.at));
}

/** The reading from `intake-health`, passed in rather than imported.
 *
 *  THIS FILE HAS NO IMPORTS ON PURPOSE -- its own header says so, and
 *  `delinquency-check.mjs` loads it as a data: URL, where a relative
 *  import cannot resolve at all. Importing `intakeVerdict` here took
 *  the whole harness down with ERR_INVALID_URL. The verdict is worked
 *  out by the caller, which already has the database open. */
export type IntakeVerdict = {
  level: "ok" | "warn" | "bad";
  headline: string;
  detail: string;
};

export function render(
  r: Report, vac: Vacancies = null, intake: IntakeVerdict | null = null,
  leads: Leads = null,
): { subject: string; text: string; html: string } {
  const when = longDay(r.day);
  const short = new Date(`${r.day}T12:00:00Z`).toLocaleDateString("en-US",
    { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  const owing = [...(r.debtors ?? [])].sort((a, b) => b.balance - a.balance);
  const sum = (l: Debtor[]) => l.reduce((s, d) => s + d.balance, 0);
  /* TWO DIFFERENT JOBS, NEVER ONE TOTAL. A tenant living in one of our
     homes is rent we can still collect this month; somebody who has moved
     out is a collections file. The owner: "getting money from people who
     are in our houses is paramount". So the current tenants lead the
     subject, the opening section and the aging, and the past tenants are a
     section of their own at the bottom with their own figures. A combined
     $82k mostly made of old move-outs buried a $27k that can be chased
     today. */
  const current = owing.filter((d) => isCurrent(d.status));
  const former = owing.filter((d) => !isCurrent(d.status));
  const curTotal = sum(current);
  const pastTotal = sum(former);
  const aged = owing.some((d) => d.daysLate !== null);
  const { forRent, upcoming } = vac ? sortVacancies(vac.list) : { forRent: [], upcoming: [] };

  /* ---- subject */
  const inc = r.partial ? " (incomplete)" : "";
  const owesPart = !r.ok
    ? "balances could not be read"
    : (current.length
        ? `current tenants owe ${usd(curTotal)} (${current.length})`
        : "no current tenant owes")
      + (former.length ? ` · past tenants ${usd(pastTotal)}` : "") + inc;
  const newLeads = leads ? sortLeads(leads.list) : [];
  const apps = newLeads.filter((l) => l.kind === "application").length;
  const others = newLeads.length - apps;
  /* In the subject only when there is something: "0 new leads" every
     quiet morning trains people to skip the part of the subject that
     matters on the morning it is not zero. */
  const leadPart = !newLeads.length ? ""
    : ` · ${[apps ? `${apps} new application${apps === 1 ? "" : "s"}` : "",
             others ? `${others} new inquir${others === 1 ? "y" : "ies"}` : ""].filter(Boolean).join(", ")}`;
  const vacPart = vac ? ` · ${forRent.length} for rent, ${upcoming.length} upcoming` : "";
  /* It goes in the SUBJECT when it is broken. A fault reported only
     in the body of a daily email is a fault nobody reads about. */
  const intakePart = intake?.level === "bad"
    ? " · MAINTENANCE EMAILS NOT ARRIVING" : "";
  const subject = `Morning report ${short}: ${owesPart}${leadPart}${vacPart}${intakePart}`;

  const partialNote = r.partial
    ? "Rent Manager was still answering when time ran out, so this list is NOT complete. Totals below are a floor, not the figure."
    : null;
  const failNote = !r.ok
    ? `The delinquency list could not be produced this morning. ${r.error ?? "Rent Manager did not answer."} This is not a report saying nobody owes anything -- nothing was read.`
    : null;

  /* ================================================================ text */
  const lines: string[] = [`Morning report for ${when}`, ""];
  /* Above the money, because a request that never arrived is work
     nobody knows about, and a balance can be read any time. */
  if (intake) {
    lines.push("MAINTENANCE REQUESTS", "", intake.headline);
    if (intake.level === "bad") lines.push("", intake.detail);
    lines.push("");
  }
  const textRows = (list: Debtor[]) => {
    for (const d of list) {
      lines.push(`  ${usd(d.balance).padStart(11)}  ${d.name}`
        + (d.place ? ` -- ${d.place}` : "")
        + (d.daysLate !== null ? ` -- ${d.daysLate} day${d.daysLate === 1 ? "" : "s"}` : ""));
    }
  };
  const textAging = (list: Debtor[]) => {
    if (!aged || !list.length) return;
    lines.push("");
    for (const b of BUCKETS) {
      const inB = list.filter((d) => d.daysLate !== null && d.daysLate >= b.lo && d.daysLate <= b.hi);
      if (inB.length) lines.push(`  ${b.label}: ${inB.length}, ${usd(sum(inB))}`);
    }
  };
  lines.push("CURRENT TENANTS -- IN OUR HOMES", "");
  if (failNote) lines.push(failNote);
  else {
    if (partialNote) lines.push(partialNote, "");
    lines.push(current.length
      ? `${current.length} current tenant${current.length === 1 ? "" : "s"} owe ${usd(curTotal)}.`
      : `No current tenant owes anything. ${r.tenantsRead} tenant records were read from Rent Manager.`);
    textAging(current);
    if (current.length) { lines.push(""); textRows(current); }
  }

  if (leads) {
    lines.push("", "", "NEW APPLICATIONS & INQUIRIES -- LAST 24 HOURS", "");
    for (const n of leads.notes) lines.push(n);
    if (leads.notes.length) lines.push("");
    if (!newLeads.length) lines.push("None in the last 24 hours.");
    for (const l of newLeads) {
      lines.push(`  ${KIND_WORD[l.kind]}: ${l.name}${l.phone ? ` (${l.phone})` : ""} -- ${l.what}`);
    }
  }

  if (vac) {
    lines.push("", "", "VACANCIES", "");
    if (vac.note) lines.push(vac.note, "");
    lines.push(`FOR RENT NOW (${forRent.length})`);
    if (!forRent.length) lines.push("  Nothing is marked for rent.");
    for (const v of forRent) {
      const facts = [size(v), v.rent != null ? `${usd(v.rent)}/mo` : null,
        v.daysListed != null ? `listed ${v.daysListed} day${v.daysListed === 1 ? "" : "s"}` : null]
        .filter(Boolean).join(" · ");
      lines.push(`  ${v.place}${facts ? ` -- ${facts}` : ""}`);
      const sh = showText(v);
      lines.push(`      ${sh || "no showings booked"}`);
    }
    lines.push("", `UPCOMING (${upcoming.length})`);
    if (!upcoming.length) lines.push("  Nothing is marked upcoming.");
    for (const v of upcoming) {
      const facts = [readyText(v.readyOn, r.day), size(v)].filter(Boolean).join(" · ");
      lines.push(`  ${v.place}${facts ? ` -- ${facts}` : ""}`);
      if (v.blocker) lines.push(`      Waiting on: ${v.blocker}`);
    }
  }
  if (!failNote && former.length) {
    lines.push("", "", "PAST TENANTS -- MOVED OUT, COLLECTIONS", "");
    lines.push(`${former.length} past tenant${former.length === 1 ? "" : "s"} owe ${usd(pastTotal)}.`, "");
    textRows(former);
  }
  lines.push("", "Balances are Rent Manager's, read at the time this was sent. For rent and upcoming are what the office has marked on the Properties page.");

  /* ================================================================ html */
  const th = `style="text-align:left;padding:6px 10px;border-bottom:2px solid #d5dbe5;font-size:13px;color:#4b5563"`;
  const thr = `style="text-align:right;padding:6px 10px;border-bottom:2px solid #d5dbe5;font-size:13px;color:#4b5563"`;
  const td = `style="padding:6px 10px;border-bottom:1px solid #e8ecf2;vertical-align:top"`;
  const tdr = `style="padding:6px 10px;border-bottom:1px solid #e8ecf2;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;vertical-align:top"`;
  const muted = (s: string) => `<span style="color:#9ca3af">${s}</span>`;
  const h2 = (s: string) => `<h2 style="margin:28px 0 6px;font-size:19px;border-bottom:1px solid #e8ecf2;padding-bottom:6px">${s}</h2>`;
  const banner = (s: string, bold: string) =>
    `<p style="padding:10px 12px;background:#fff4e5;border-left:4px solid #d97706"><b>${bold}</b> ${esc(s)}</p>`;

  /* Three columns, the address under the name: four columns wrapped every
     row on a phone, which is where this is read at 10am. */
  const lateColour = (n: number | null) =>
    n === null ? "#6b7280" : n > 90 ? "#b91c1c" : n > 30 ? "#b45309" : "#4b5563";
  const table = (list: Debtor[], call = false) => !list.length ? "" :
    `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:640px">`
    + `<tr><th ${th}>Tenant</th>`
    + (aged ? `<th ${thr}>Days late</th>` : "")
    + `<th ${thr}>Owes</th></tr>`
    + list.map((d) => `<tr><td ${td}><b style="font-weight:600">${esc(d.name)}</b>`
      + `<div style="font-size:13px;color:#6b7280">${d.place ? esc(d.place) : "not matched to a unit"}`
      + (call && d.phone ? ` · <a href="tel:${esc(d.phone)}" style="color:#405981;text-decoration:none;font-weight:600">Call</a>` : "")
      + `</div></td>`
      + (aged ? `<td ${tdr}><span style="color:${lateColour(d.daysLate)};font-weight:600">${d.daysLate ?? "—"}</span></td>` : "")
      + `<td ${tdr}><b>${usd(d.balance)}</b></td></tr>`).join("")
    + `</table>`;

  const buckets = (list: Debtor[]) => aged && list.length
    ? `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;table-layout:fixed;width:100%;max-width:640px;margin:10px 0 14px"><tr>`
      + BUCKETS.map((b) => {
        const inB = list.filter((d) => d.daysLate !== null && d.daysLate >= b.lo && d.daysLate <= b.hi);
        return `<td style="padding:8px 14px;border:1px solid #e8ecf2"><div style="font-size:12px;color:#6b7280">${b.label}</div>`
          + `<div style="font-weight:600">${usd(inB.reduce((s, d) => s + d.balance, 0))}</div>`
          + `<div style="font-size:12px;color:#6b7280">${inB.length} tenant${inB.length === 1 ? "" : "s"}</div></td>`;
      }).join("") + `</tr></table>`
    : "";

  const currentHtml = h2("Current tenants · in our homes")
    + (failNote
    ? banner(failNote, "Could not be produced.")
    : (partialNote ? banner(partialNote, "Incomplete.") : "")
      + (current.length
        ? `<p style="font-size:18px;margin:6px 0"><b>${current.length}</b> current tenant${current.length === 1 ? "" : "s"} owe <b style="color:#b91c1c">${usd(curTotal)}</b></p>`
        : `<p style="font-size:18px">No current tenant owes anything.</p><p style="color:#6b7280">${r.tenantsRead} tenant records were read from Rent Manager.</p>`)
      + buckets(current)
      + table(current, true));

  /* Last, and quieter: a collections file, not this morning's rent. */
  const pastHtml = failNote || !former.length ? ""
    : `<h2 style="margin:36px 0 6px;font-size:17px;color:#4b5563;border-top:2px solid #e8ecf2;border-bottom:1px solid #e8ecf2;padding:14px 0 6px">Past tenants · moved out</h2>`
      + `<p style="margin:6px 0 10px;color:#4b5563">${former.length} past tenant${former.length === 1 ? "" : "s"} owe <b>${usd(pastTotal)}</b>. Collections, kept apart from the rent above.</p>`
      + table(former);

  const forRentHtml = `<h3 style="margin:18px 0 6px;font-size:15px">For rent now · ${forRent.length}</h3>`
    + (!forRent.length ? `<p>${muted("Nothing is marked for rent.")}</p>`
      : `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:720px">`
        + `<tr><th ${th}>Home</th><th ${thr}>Showings</th></tr>`
        + forRent.map((v) => {
          const shows = [
            v.upcomingShowings ? `${v.upcomingShowings} booked${v.nextShowing ? `, next ${esc(shortDate(v.nextShowing))}` : ""}` : "",
            v.recentShowings ? `${v.recentShowings} in last 2 wks` : "",
          ].filter(Boolean).join("<br>");
          const facts = [size(v), v.rent != null ? `${usd(v.rent)}/mo` : null,
            v.daysListed != null ? `listed ${v.daysListed} days` : null].filter(Boolean).join(" · ");
          return `<tr><td ${td}><b style="font-weight:600">${esc(v.place)}</b>`
            + (facts ? `<div style="font-size:13px;color:#6b7280">${esc(facts)}</div>` : "")
            + `</td><td ${tdr} style="white-space:normal">${shows || muted("none booked")}</td></tr>`;
        }).join("")
        + `</table>`);

  const upcomingHtml = `<h3 style="margin:18px 0 6px;font-size:15px">Upcoming · ${upcoming.length}</h3>`
    + (!upcoming.length ? `<p>${muted("Nothing is marked upcoming.")}</p>`
      : `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:720px">`
        + `<tr><th ${th}>Home</th><th ${thr}>Ready</th></tr>`
        + upcoming.map((v) => {
          const ready = readyText(v.readyOn, r.day);
          const late = !!v.readyOn && v.readyOn < r.day;
          return `<tr><td ${td}><b style="font-weight:600">${esc(v.place)}</b>`
            + (size(v) ? `<div style="font-size:13px;color:#6b7280">${esc(size(v)!)}</div>` : "")
            + (v.blocker ? `<div style="font-size:13px;color:#b45309">Waiting on: ${esc(v.blocker)}</div>` : "")
            + `</td>`
            + `<td style="padding:6px 10px;border-bottom:1px solid #e8ecf2;text-align:right;vertical-align:top">${ready ? (late ? `<b style="color:#b91c1c">${esc(ready)}</b>` : esc(ready)) : muted("no date")}</td></tr>`;
        }).join("")
        + `</table>`);

  const kindColour: Record<Lead["kind"], string> = {
    application: "#1d7a46", showing: "#405981", inquiry: "#a15c07", prospect: "#4b5563",
  };
  const leadsHtml = !leads ? "" :
    h2(`New applications &amp; inquiries${newLeads.length ? ` · ${newLeads.length}` : ""}`)
    + `<div style="font-size:13px;color:#6b7280;margin:-2px 0 8px">Last 24 hours</div>`
    + leads.notes.map((n) => banner(n, "Note.")).join("")
    + (!newLeads.length ? `<p style="margin:4px 0">${muted("None in the last 24 hours.")}</p>`
      : `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:640px">`
        + newLeads.map((l) => `<tr><td ${td}>`
          + `<span style="display:inline-block;font-size:11px;font-weight:700;color:#fff;background:${kindColour[l.kind]};border-radius:999px;padding:1px 8px;margin-right:6px">${KIND_WORD[l.kind]}</span>`
          + `<b style="font-weight:600">${esc(l.name)}</b>`
          + `<div style="font-size:13px;color:#4b5563;margin-top:2px">${esc(l.what)}`
          + (l.phone ? ` · <a href="tel:${esc(l.phone)}" style="color:#405981;text-decoration:none;font-weight:600">Call</a>` : "")
          + `</div></td>`
          + `<td ${tdr}><span style="font-size:12px;color:#6b7280">${esc(new Date(l.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }))}</span></td></tr>`).join("")
        + `</table>`);

  const vacancyHtml = !vac ? "" :
    h2("Vacancies")
    + (vac.note ? banner(vac.note, "Note.") : "")
    + forRentHtml + upcomingHtml;

  /* A section only when it is broken; a line in the footer otherwise. A
     heading for "1 request arrived" pushed the rent below the fold. */
  const intakeHtml = intake?.level === "bad"
    ? h2("Maintenance requests") + banner(`${intake.headline} ${intake.detail}`, "Not arriving.")
    : "";
  const intakeFoot = intake && intake.level !== "bad"
    ? `<p style="color:#6b7280;font-size:13px;margin:24px 0 0">Maintenance: ${esc(intake.headline)}</p>` : "";

  /* The three answers before any table: what current tenants owe, what
     past tenants owe, and how many homes there are to fill. */
  const tile = (label: string, value: string, sub: string, colour: string) =>
    `<td style="width:50%;padding:10px 12px;border:1px solid #e3e8ef;vertical-align:top">`
    + `<div style="font-size:12px;color:#6b7280">${label}</div>`
    + `<div style="font-size:20px;font-weight:700;color:${colour};font-variant-numeric:tabular-nums;white-space:nowrap">${value}</div>`
    + `<div style="font-size:12px;color:#6b7280">${sub}</div></td>`;
  const tiles = failNote ? "" :
    `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:640px;margin:14px 0 4px"><tr>`
    + tile("Current tenants owe", usd(Math.round(curTotal)).replace(/\.00$/, ""),
        `${current.length} tenant${current.length === 1 ? "" : "s"}`, current.length ? "#b91c1c" : "#1d7a46")
    + tile("Past tenants owe", usd(Math.round(pastTotal)).replace(/\.00$/, ""),
        `${former.length} moved out`, "#4b5563")
    + `</tr><tr>`
    + (leads ? tile("New leads, 24 hrs", String(newLeads.length),
        apps ? `${apps} application${apps === 1 ? "" : "s"}` : "applications and inquiries",
        newLeads.length ? "#1d7a46" : "#1d2433") : "")
    + (vac ? tile("Homes to rent", String(forRent.length), `${upcoming.length} on the way`, "#1d2433") : "")
    + `</tr></table>`;

  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#1d2433">`
    + `<h1 style="margin:0 0 2px;font-size:22px">Morning report</h1>`
    + `<div style="color:#6b7280">${esc(when)}</div>`
    + tiles
    + intakeHtml
    + currentHtml
    + leadsHtml
    + vacancyHtml
    + pastHtml
    + intakeFoot
    + `<p style="color:#9ca3af;font-size:12px;margin-top:12px">Balances are Rent Manager's, read at the time this was sent. For rent and upcoming are what the office has marked on the Properties page.</p></div>`;

  return { subject, text: lines.join("\n"), html };
}
