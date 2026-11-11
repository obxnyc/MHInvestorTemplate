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
  if (readyOn < day) return `was due ${dayDate(readyOn)} -- overdue`;
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
): { subject: string; text: string; html: string } {
  const when = longDay(r.day);
  const short = new Date(`${r.day}T12:00:00Z`).toLocaleDateString("en-US",
    { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  const owing = [...(r.debtors ?? [])].sort((a, b) => b.balance - a.balance);
  const total = owing.reduce((s, d) => s + d.balance, 0);
  const current = owing.filter((d) => isCurrent(d.status));
  const former = owing.filter((d) => !isCurrent(d.status));
  const aged = owing.some((d) => d.daysLate !== null);
  const { forRent, upcoming } = vac ? sortVacancies(vac.list) : { forRent: [], upcoming: [] };

  /* ---- subject */
  const owesPart = !r.ok
    ? "balances could not be read"
    : owing.length ? `${owing.length} owe ${usd(total)}${r.partial ? " (incomplete)" : ""}`
    : `nobody owes${r.partial ? " (incomplete)" : ""}`;
  const vacPart = vac ? ` · ${forRent.length} for rent, ${upcoming.length} upcoming` : "";
  /* It goes in the SUBJECT when it is broken. A fault reported only
     in the body of a daily email is a fault nobody reads about. */
  const intakePart = intake?.level === "bad"
    ? " · MAINTENANCE EMAILS NOT ARRIVING" : "";
  const subject = `Morning report ${short}: ${owesPart}${vacPart}${intakePart}`;

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
  lines.push("DELINQUENCY", "");
  if (failNote) lines.push(failNote);
  else {
    if (partialNote) lines.push(partialNote, "");
    lines.push(owing.length
      ? `${owing.length} tenant${owing.length === 1 ? "" : "s"} owe ${usd(total)} in total.`
      : `Nobody owes anything. ${r.tenantsRead} tenant records were read from Rent Manager.`);
    if (aged && owing.length) {
      lines.push("");
      for (const b of BUCKETS) {
        const inB = owing.filter((d) => d.daysLate !== null && d.daysLate >= b.lo && d.daysLate <= b.hi);
        if (inB.length) lines.push(`  ${b.label}: ${inB.length}, ${usd(inB.reduce((s, d) => s + d.balance, 0))}`);
      }
    }
    const textGroup = (title: string, list: Debtor[]) => {
      if (!list.length) return;
      lines.push("", `${title} (${list.length}, ${usd(list.reduce((s, d) => s + d.balance, 0))})`);
      for (const d of list) {
        lines.push(`  ${usd(d.balance).padStart(11)}  ${d.name}`
          + (d.place ? ` -- ${d.place}` : "")
          + (d.daysLate !== null ? ` -- ${d.daysLate} days` : ""));
      }
    };
    textGroup(former.length ? "Current tenants" : "Owing", current);
    textGroup("Moved out or not current", former);
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

  const table = (title: string, list: Debtor[]) => !list.length ? "" :
    `<h3 style="margin:18px 0 6px;font-size:15px">${esc(title)} · ${list.length} · ${usd(list.reduce((s, d) => s + d.balance, 0))}</h3>`
    + `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:720px">`
    + `<tr><th ${th}>Tenant</th><th ${th}>Where</th>`
    + (aged ? `<th ${thr}>Days</th>` : "")
    + `<th ${thr}>Owes</th></tr>`
    + list.map((d) => `<tr><td ${td}>${esc(d.name)}</td>`
      + `<td ${td}>${d.place ? esc(d.place) : muted("not matched to a unit")}</td>`
      + (aged ? `<td ${tdr}>${d.daysLate ?? "—"}</td>` : "")
      + `<td ${tdr}><b>${usd(d.balance)}</b></td></tr>`).join("")
    + `</table>`;

  const buckets = aged && owing.length
    ? `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:10px 0"><tr>`
      + BUCKETS.map((b) => {
        const inB = owing.filter((d) => d.daysLate !== null && d.daysLate >= b.lo && d.daysLate <= b.hi);
        return `<td style="padding:8px 14px;border:1px solid #e8ecf2"><div style="font-size:12px;color:#6b7280">${b.label}</div>`
          + `<div style="font-weight:600">${usd(inB.reduce((s, d) => s + d.balance, 0))}</div>`
          + `<div style="font-size:12px;color:#6b7280">${inB.length} tenant${inB.length === 1 ? "" : "s"}</div></td>`;
      }).join("") + `</tr></table>`
    : "";

  const delinquencyHtml = failNote
    ? banner(failNote, "Could not be produced.")
    : (partialNote ? banner(partialNote, "Incomplete.") : "")
      + (owing.length
        ? `<p style="font-size:18px;margin:6px 0"><b>${owing.length}</b> tenant${owing.length === 1 ? "" : "s"} owe <b>${usd(total)}</b></p>`
        : `<p style="font-size:18px">Nobody owes anything.</p><p style="color:#6b7280">${r.tenantsRead} tenant records were read from Rent Manager.</p>`)
      + buckets
      + table(former.length ? "Current tenants" : "Owing", current)
      + table("Moved out or not current", former);

  const forRentHtml = `<h3 style="margin:18px 0 6px;font-size:15px">For rent now · ${forRent.length}</h3>`
    + (!forRent.length ? `<p>${muted("Nothing is marked for rent.")}</p>`
      : `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:720px">`
        + `<tr><th ${th}>Home</th><th ${th}>Size</th><th ${thr}>Rent</th><th ${thr}>Listed</th><th ${th}>Showings</th></tr>`
        + forRent.map((v) => {
          const shows = [
            v.upcomingShowings ? `${v.upcomingShowings} booked${v.nextShowing ? `, next ${esc(shortDate(v.nextShowing))}` : ""}` : "",
            v.recentShowings ? `${v.recentShowings} in last 2 wks` : "",
          ].filter(Boolean).join("<br>");
          return `<tr><td ${td}><b>${esc(v.place)}</b></td>`
            + `<td ${td}>${size(v) ?? muted("—")}</td>`
            + `<td ${tdr}>${v.rent != null ? usd(v.rent) : muted("—")}</td>`
            + `<td ${tdr}>${v.daysListed != null ? `${v.daysListed} days` : muted("—")}</td>`
            + `<td ${td}>${shows || muted("none booked")}</td></tr>`;
        }).join("")
        + `</table>`);

  const upcomingHtml = `<h3 style="margin:18px 0 6px;font-size:15px">Upcoming · ${upcoming.length}</h3>`
    + (!upcoming.length ? `<p>${muted("Nothing is marked upcoming.")}</p>`
      : `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:720px">`
        + `<tr><th ${th}>Home</th><th ${th}>Ready</th><th ${th}>Size</th></tr>`
        + upcoming.map((v) => {
          const ready = readyText(v.readyOn, r.day);
          const late = !!v.readyOn && v.readyOn < r.day;
          return `<tr><td ${td}><b>${esc(v.place)}</b>`
            + (v.blocker ? `<div style="font-size:13px;color:#b45309">Waiting on: ${esc(v.blocker)}</div>` : "")
            + `</td>`
            + `<td ${td}>${ready ? (late ? `<b style="color:#b91c1c">${esc(ready)}</b>` : esc(ready)) : muted("no date")}</td>`
            + `<td ${td}>${size(v) ?? muted("—")}</td></tr>`;
        }).join("")
        + `</table>`);

  const vacancyHtml = !vac ? "" :
    h2("Vacancies")
    + (vac.note ? banner(vac.note, "Note.") : "")
    + forRentHtml + upcomingHtml;

  const intakeHtml = !intake ? ""
    : intake.level === "bad"
      ? h2("Maintenance requests")
        + banner(`${intake.headline} ${intake.detail}`, "Not arriving.")
      : h2("Maintenance requests")
        + `<p style="margin:0 0 8px">${esc(intake.headline)}</p>`;

  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#1d2433">`
    + `<h1 style="margin:0 0 2px;font-size:22px">Morning report</h1>`
    + `<div style="color:#6b7280">${esc(when)}</div>`
    + intakeHtml
    + h2("Delinquency")
    + delinquencyHtml
    + vacancyHtml
    + `<p style="color:#9ca3af;font-size:12px;margin-top:24px">Balances are Rent Manager's, read at the time this was sent. For rent and upcoming are what the office has marked on the Properties page.</p></div>`;

  return { subject, text: lines.join("\n"), html };
}
