/**
 * Owner distributions: the monthly statement and the plan for paying it.
 *
 * Pure functions only -- the route and the screen both use them, and the
 * check in lib/__fixtures__/distribute.test.mjs runs them without a database.
 *
 * Money is integer cents throughout. A statement line is positive when it is
 * money to the owner and negative when it is a deduction.
 */

/** One row of a statement. Positive is money to the owner (rent), negative
 *  is a cost (lot rent, loan, a repair). Date, merchant and category are
 *  shown when the sheet had them. */
export type Line = { label: string; cents: number; date?: string; merchant?: string; category?: string };

export const netCents = (lines: Line[]) => lines.reduce((s, l) => s + (Number(l.cents) || 0), 0);

export const usd = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/* ----------------------------------------------------------- bank days */

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const at = (s: string) => new Date(`${s}T12:00:00Z`);

/** nth weekday (0=Sun) of a month; n = -1 for the last. */
function nth(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1, 12));
    const shift = (weekday - first.getUTCDay() + 7) % 7;
    return ymd(new Date(Date.UTC(year, month, 1 + shift + (n - 1) * 7, 12)));
  }
  const last = new Date(Date.UTC(year, month + 1, 0, 12));
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return ymd(new Date(Date.UTC(year, month + 1, -back, 12)));
}

/** Federal Reserve holidays, when banks do not move money. A holiday on a
 *  Sunday is observed Monday; on a Saturday the Fed does not shift it. */
export function bankHolidays(year: number): Set<string> {
  const fixed = [[0, 1], [5, 19], [6, 4], [10, 11], [11, 25]].map(([m, d]) => {
    const x = new Date(Date.UTC(year, m, d, 12));
    if (x.getUTCDay() === 0) x.setUTCDate(x.getUTCDate() + 1);
    return ymd(x);
  });
  return new Set([
    ...fixed,
    nth(year, 0, 1, 3),   // MLK
    nth(year, 1, 1, 3),   // Presidents
    nth(year, 4, 1, -1),  // Memorial
    nth(year, 8, 1, 1),   // Labor
    nth(year, 9, 1, 2),   // Columbus
    nth(year, 10, 4, 4),  // Thanksgiving
  ]);
}

export function isBankDay(s: string): boolean {
  const d = at(s);
  const w = d.getUTCDay();
  return w !== 0 && w !== 6 && !bankHolidays(d.getUTCFullYear()).has(s);
}

/** The first bank day on or after s. */
export function bankDayFrom(s: string): string {
  const d = at(s);
  while (!isBankDay(ymd(d))) d.setUTCDate(d.getUTCDate() + 1);
  return ymd(d);
}

/** n bank days after s (s itself is day 0). */
export function addBankDays(s: string, n: number): string {
  const d = at(bankDayFrom(s));
  for (let i = 0; i < n; ) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBankDay(ymd(d))) i++;
  }
  return ymd(d);
}

/* -------------------------------------------------------------- the plan */

export type Owed = { id: string; name: string; cents: number; settleDays: number };
export type Planned = { id: string; sendOn: string; cents: number; arrivesOn: string };

/**
 * Spread what is owed across bank days so no day goes over the cap.
 *
 * `taken` is what is already committed on a day (payments marked paid), so
 * re-planning half-way through a month never overfills a day that is gone.
 *
 * Owners whose bank takes longest go first -- they need the earliest send to
 * arrive with everybody else -- then the larger amounts, so the big ones are
 * not left to be chopped up at the end. A payment is kept whole when it fits
 * on a day; only an amount bigger than a whole day's room is split, and then
 * across consecutive days.
 */
export function planPayments(
  owed: Owed[], capCents: number, startOn: string, taken: Record<string, number> = {},
): Planned[] {
  if (!(capCents > 0)) throw new Error("the daily limit must be more than nothing");
  const used: Record<string, number> = { ...taken };
  const room = (d: string) => capCents - (used[d] ?? 0);
  const out: Planned[] = [];
  const first = bankDayFrom(startOn);
  const order = owed.filter((o) => o.cents > 0)
    .sort((a, b) => b.settleDays - a.settleDays || b.cents - a.cents || a.name.localeCompare(b.name));

  for (const o of order) {
    let left = o.cents;
    // Whole if it can be: the first day with room for all of it.
    if (left <= capCents) {
      let d = first;
      for (let i = 0; i < 400 && room(d) < left; i++) d = addBankDays(d, 1);
      if (room(d) >= left) {
        used[d] = (used[d] ?? 0) + left;
        out.push({ id: o.id, sendOn: d, cents: left, arrivesOn: addBankDays(d, o.settleDays) });
        continue;
      }
    }
    // Too big for one day: as much as each day allows, in order.
    let d = first;
    for (let i = 0; left > 0 && i < 400; i++, d = addBankDays(d, 1)) {
      const take = Math.min(left, room(d));
      if (take <= 0) continue;
      used[d] = (used[d] ?? 0) + take;
      out.push({ id: o.id, sendOn: d, cents: take, arrivesOn: addBankDays(d, o.settleDays) });
      left -= take;
    }
  }
  return out.sort((a, b) => a.sendOn.localeCompare(b.sendOn));
}

/* ------------------------------------------------------- reading a paste */

/** "$1,234.56" -> 123456; "(1,234.56)" and "-1234.56" -> -123456. */
export function parseMoney(raw: string): number | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
  if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(s)) return null;
  const c = Math.round(parseFloat(s) * 100);
  return neg ? -c : c;
}

export const nameKey = (s: string) => String(s ?? "").toLowerCase()
  .replace(/\b(llc|l\.l\.c\.|inc|corp|co|ltd|the)\b/g, "").replace(/[^a-z0-9]/g, "");

const TOTAL = /^(net( (owed|due|distribution|to owner|amount))?|total( due| owed)?|amount (owed|due)|distribution)$/i;

export type Pasted = {
  byOwner: Record<string, { lines: Line[]; statedNetCents: number | null }>;
  unmatched: string[];
};

/**
 * Read a block copied out of Excel (tab-separated) or typed by hand.
 *
 * Two shapes are understood, and can be mixed:
 *  - a row holding just an owner's name, then that owner's lines beneath it
 *    as `label <tab> amount`;
 *  - rows of `owner <tab> label <tab> amount`.
 *
 * A row labelled Net / Total / Net owed is NOT added as a line: it is kept as
 * the figure the spreadsheet says, so the screen can say when the lines do
 * not add up to it rather than one silently winning.
 */
export function readPaste(text: string, owners: { id: string; name: string }[]): Pasted {
  const keyed = owners.map((o) => ({ ...o, k: nameKey(o.name) })).filter((o) => o.k);
  const find = (cell: string) => {
    const k = nameKey(cell);
    if (!k) return null;
    return keyed.find((o) => o.k === k)
      ?? keyed.find((o) => k.length >= 5 && (o.k.startsWith(k) || k.startsWith(o.k)))
      ?? null;
  };
  const byOwner: Pasted["byOwner"] = {};
  const unmatched: string[] = [];
  const slot = (id: string) => (byOwner[id] ??= { lines: [], statedNetCents: null });
  let current: string | null = null;

  for (const raw of String(text ?? "").split(/\r?\n/)) {
    let filled = raw.split(/\t|\s{2,}|\|/).map((c) => c.trim()).filter(Boolean);
    if (!filled.length) continue;
    // "Rent collected 4,125.00" typed with single spaces: the last word is the amount.
    if (filled.length === 1) {
      const m = filled[0].match(/^(.*\S)\s+(\S+)$/);
      if (m && parseMoney(m[2]) !== null) filled = [m[1], m[2]];
    }

    const money = filled.map(parseMoney);
    let amountAt = -1;
    money.forEach((m, i) => { if (m !== null) amountAt = i; });

    if (amountAt < 0) {
      const o = find(filled.join(" "));
      // An unknown name ends the previous owner's block: lines under it must
      // not land on whoever came before.
      if (o) { current = o.id; slot(o.id); } else { current = null; unmatched.push(raw.trim()); }
      continue;
    }
    const cents = money[amountAt]!;
    const words = filled.slice(0, amountAt).filter((w) => parseMoney(w) === null);
    if (!words.length && !current) { unmatched.push(raw.trim()); continue; }

    // owner <tab> label <tab> amount
    let owner = current;
    let label = words.join(" ");
    if (words.length >= 2) {
      const o = find(words[0]);
      if (o) { owner = o.id; current = o.id; label = words.slice(1).join(" "); }
    }
    if (!owner) { unmatched.push(raw.trim()); continue; }
    if (!label) label = "Distribution";
    if (TOTAL.test(label.trim())) { slot(owner).statedNetCents = cents; continue; }
    slot(owner).lines.push({ label, cents });
  }
  return { byOwner, unmatched };
}

/* ---------------------------------------------------------- the statement */

/** What a statement says beyond its lines, as the accountant's sheet has it. */
export type Carry = {
  previousOwedCents?: number | null;  // last month's "Owed to"
  priorPaidCents?: number | null;     // what was actually paid against it
  priorPaidOn?: string | null;
  depositsCents?: number | null;      // security deposits on file
  statedNetCents?: number | null;     // the sheet's "Monthly Net Cashflow"
  statedOwedCents?: number | null;    // the sheet's "Owed to ..."
};

/** Owed this month = this month's net + whatever of last month's was not paid. */
export const owedCents = (lines: Line[], c: Carry = {}) =>
  netCents(lines) + ((c.previousOwedCents ?? 0) - (c.priorPaidCents ?? 0));

/** Lot numbers mentioned in a piece of text: "Lots #13, #32" / "Lot 13". */
export const lotsIn = (s: string) =>
  [...String(s ?? "").matchAll(/(?:lots?\s*#?\s*|#\s*)(\d{1,3})\b/gi)].map((m) => Number(m[1]));

/**
 * The things worth a look before a statement goes out. Each is said as a
 * sentence because each is a decision somebody makes, not an error the app
 * can fix: the sheet is the accountant's, and a statement is somebody's money.
 */
export function checks(title: string | null | undefined, lines: Line[], c: Carry = {}): string[] {
  const out: string[] = [];
  const net = netCents(lines);
  const owed = owedCents(lines, c);
  if (c.statedNetCents != null && c.statedNetCents !== net) {
    out.push(`The lines add up to ${money(net)} but the sheet's Monthly Net Cashflow says ${money(c.statedNetCents)}.`);
  }
  if (c.statedOwedCents != null && c.statedOwedCents !== owed) {
    out.push(`Net plus last month's balance comes to ${money(owed)} but the sheet's Owed line says ${money(c.statedOwedCents)}.`);
  }
  if (c.previousOwedCents != null && c.priorPaidCents != null && c.previousOwedCents !== c.priorPaidCents) {
    out.push(`Last month ${money(c.previousOwedCents)} was owed and ${money(c.priorPaidCents)} was paid; the ${money(c.previousOwedCents - c.priorPaidCents)} difference carries into this month.`);
  }
  if (owed < 0) out.push(`Nothing to pay: the month comes out ${money(owed)}.`);
  const said = new Set(lotsIn(title ?? ""));
  const used = new Set(lines.flatMap((l) => lotsIn(l.label)));
  if (said.size && used.size) {
    const missing = [...used].filter((n) => !said.has(n)).sort((a, b) => a - b);
    const idle = [...said].filter((n) => !used.has(n)).sort((a, b) => a - b);
    if (missing.length) out.push(`Lines mention lot${missing.length > 1 ? "s" : ""} ${missing.join(", ")}, which the title does not list.`);
    if (idle.length) out.push(`The title lists lot${idle.length > 1 ? "s" : ""} ${idle.join(", ")}, which no line mentions.`);
  }
  return out;
}

const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (c: number) => (c < 0 ? `-${usd(-c)}` : usd(c));

export const monthLabel = (month: string) =>
  new Date(`${month.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** "November 2026 Owner Distribution" -- the subject the owners already know. */
export const subjectFor = (month: string) => `${monthLabel(month)} Owner Distribution`;

const dayLabel = (s: string) =>
  at(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** "2026-11-14" or "11/1/2026" to "Nov 14"; anything else as written. */
const shortDate = (s?: string) => {
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))
    : (m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)) ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], 12)) : null;
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : s;
};

export type StatementInput = Carry & {
  month: string; payee: string; title?: string | null; lines: Line[]; note?: string | null;
  payments?: { sendOn: string; cents: number; arrivesOn?: string }[];
};

/** Email-safe HTML: tables and inline styles, because mail clients ignore
 *  stylesheets. Laid out the way the accountant's sheet is -- expenses, then
 *  revenue, then the balance -- because that is what the owners are used to
 *  reading. Light ground on purpose: a statement is read and printed. */
export function statementHtml(s: StatementInput): string {
  const net = netCents(s.lines);
  const owed = owedCents(s.lines, s);
  const costs = s.lines.filter((l) => l.cents < 0);
  const income = s.lines.filter((l) => l.cents >= 0);
  const F = "font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif";
  const cell = "padding:7px 6px;border-bottom:1px solid #E6E8EC;vertical-align:top";
  const num = `${cell};text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap`;
  const row = (l: Line) => `<tr>
      <td style="${cell};color:#6B7280;white-space:nowrap">${esc(shortDate(l.date))}</td>
      <td style="${cell};color:#1F2937">${esc(l.label)}${l.merchant ? `<div style="color:#6B7280;font-size:12px">${esc(l.merchant)}</div>` : ""}</td>
      <td style="${num};color:${l.cents < 0 ? "#9B2C2C" : "#1F2937"}">${money(l.cents)}</td></tr>`;
  const table = (name: string, rows: Line[]) => rows.length ? `
    <p style="margin:22px 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-weight:700">${name}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
      ${rows.map(row).join("")}
      <tr><td></td><td style="${cell};font-weight:700;color:#111827;border-bottom:0">Subtotal</td>
      <td style="${num};font-weight:700;color:#111827;border-bottom:0">${money(netCents(rows))}</td></tr>
    </table>` : "";
  const sum = (label: string, c: number, strong = false) => `<tr>
      <td style="padding:6px 0;color:${strong ? "#111827" : "#374151"};${strong ? "font-weight:800;font-size:16px" : ""}">${label}</td>
      <td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;color:#111827;${strong ? "font-weight:800;font-size:18px" : ""}">${money(c)}</td></tr>`;
  const carried = (s.previousOwedCents ?? 0) - (s.priorPaidCents ?? 0);
  const pays = (s.payments ?? []).filter((p) => p.cents > 0);

  return `<!doctype html><html><body style="margin:0;padding:0;background:#F3F4F6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#FFFFFF;border-radius:12px;overflow:hidden;${F};font-size:15px">
  <tr><td style="background:#1F3554;padding:22px 28px;color:#FFFFFF">
    <div style="font-size:20px;font-weight:800;letter-spacing:-.01em">Larabee Homes</div>
    <div style="font-size:13px;opacity:.85;margin-top:2px">Owner Distribution &middot; ${esc(monthLabel(s.month))}</div>
  </td></tr>
  <tr><td style="padding:24px 28px 8px">
    <div style="font-size:19px;font-weight:700;color:#111827">${esc(s.payee)}</div>
    ${s.title ? `<div style="color:#6B7280;font-size:13px;margin-top:3px">${esc(s.title)}</div>` : ""}
    ${table("Revenue", income)}
    ${table("Expenses", costs)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:2px solid #111827;border-collapse:collapse;font-size:14px">
      ${sum("Monthly net cashflow", net)}
      ${carried ? sum(`Carried from last month${s.priorPaidOn ? ` (${esc(money(s.previousOwedCents ?? 0))} owed, ${esc(money(s.priorPaidCents ?? 0))} paid ${esc(shortDate(s.priorPaidOn))})` : ""}`, carried) : ""}
      ${sum(owed < 0 ? "Balance" : "Distribution owed to you", owed, true)}
    </table>
    ${owed < 0 ? `<p style="margin:10px 0 0;color:#374151;line-height:1.6">Expenses this month exceeded revenue, so there is no distribution this month.</p>` : ""}
    ${pays.length ? `
    <p style="margin:22px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-weight:700">Payment</p>
    <p style="margin:0;color:#374151;line-height:1.6">${pays.map((p) =>
      `${usd(p.cents)} sent ${dayLabel(p.sendOn)}${p.arrivesOn ? `, expected by ${dayLabel(p.arrivesOn)}` : ""}`).join("<br>")}</p>` : ""}
    ${s.depositsCents ? `<p style="margin:18px 0 0;color:#6B7280;font-size:13px">Security deposits we hold on file: ${usd(s.depositsCents)}</p>` : ""}
    ${s.note ? `<p style="margin:18px 0 0;color:#374151;line-height:1.6;white-space:pre-wrap">${esc(s.note)}</p>` : ""}
  </td></tr>
  <tr><td style="padding:20px 28px 26px;color:#6B7280;font-size:12px;line-height:1.6;border-top:1px solid #E6E8EC">
    Questions about this statement? Reply to this email.<br>Larabee Homes LLC
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

export function statementText(s: StatementInput): string {
  const net = netCents(s.lines);
  const owed = owedCents(s.lines, s);
  const carried = (s.previousOwedCents ?? 0) - (s.priorPaidCents ?? 0);
  const pad = (l: string, a: string) => `${l}${" ".repeat(Math.max(2, 56 - l.length - a.length))}${a}`;
  const block = (name: string, rows: Line[]) => rows.length
    ? [name, ...rows.map((l) => pad(`${shortDate(l.date) ? `${shortDate(l.date)}  ` : ""}${l.label}`, money(l.cents))), pad("Subtotal", money(netCents(rows))), ""]
    : [];
  return [
    `Larabee Homes -- Owner Distribution, ${monthLabel(s.month)}`,
    s.payee, ...(s.title ? [s.title] : []), ``,
    ...block("REVENUE", s.lines.filter((l) => l.cents >= 0)),
    ...block("EXPENSES", s.lines.filter((l) => l.cents < 0)),
    pad("Monthly net cashflow", money(net)),
    ...(carried ? [pad("Carried from last month", money(carried))] : []),
    pad(owed < 0 ? "Balance" : "Distribution owed to you", money(owed)),
    ...((s.payments ?? []).length ? ["", ...s.payments!.map((p) =>
      `${usd(p.cents)} sent ${dayLabel(p.sendOn)}${p.arrivesOn ? `, expected by ${dayLabel(p.arrivesOn)}` : ""}`)] : []),
    ...(s.depositsCents ? ["", `Security deposits we hold on file: ${usd(s.depositsCents)}`] : []),
    ...(s.note ? ["", s.note] : []),
    ``, `Questions about this statement? Reply to this email.`, `Larabee Homes LLC`,
  ].join("\n");
}

/* --------------------------------------------- against last month's */

export type Versus = {
  lastCents: number | null;      // what was sent last month
  lastOn: string | null;
  diffCents: number | null;
  loud: boolean;                 // a swing big enough to look at before paying
  says: string[];                // why, one sentence each
};

const lotOf = (label: string) => lotsIn(label)[0] ?? null;
const kindOf = (l: Line) => {
  const s = `${l.category ?? ""} ${l.label}`.toLowerCase();
  if (/monthly rent|^rent\b|\brent - lot/.test(s) && l.cents > 0) return "rent";
  if (/mortgage|loan/.test(s)) return "loan";
  if (/consult/.test(s)) return "consultant fee";
  if (/lot rent|lots rent/.test(s)) return "lot rent";
  return "other";
};

/**
 * This month's payment beside last month's, because the breakdown is typed
 * by a person and a typo in it is somebody paid wrong.
 *
 * A swing is loud when it is both more than $250 and more than 20% of last
 * month's -- either alone fires on ordinary months (a $90 pest call on a
 * $400 owner, a 5% move on a $10,000 one). When last month's lines are on
 * file, it also says which lots stopped or started paying rent, which lots
 * gained or lost their loan or lot-rent line, and any one-off costs.
 */
export function versusLast(
  thisCents: number,
  last: { sentCents: number | null; sentOn?: string | null; lines?: Line[] | null },
  lines: Line[],
): Versus {
  const says: string[] = [];
  const lastCents = last.sentCents;
  const diff = lastCents === null ? null : thisCents - lastCents;
  const loud = diff !== null && Math.abs(diff) > 25000 && Math.abs(diff) > Math.abs(lastCents ?? 0) * 0.2;
  if (lastCents !== null && diff !== null && loud) {
    says.push(`${diff > 0 ? "Up" : "Down"} ${usd(Math.abs(diff))} on last month's ${usd(lastCents)}.`);
  }
  if (last.lines?.length) {
    const lotsBy = (ls: Line[], k: string) => new Set(ls.filter((l) => kindOf(l) === k).map((l) => lotOf(l.label)).filter((x): x is number => x !== null));
    for (const k of ["rent", "loan", "lot rent", "consultant fee"]) {
      const before = lotsBy(last.lines, k), now = lotsBy(lines, k);
      const gone = [...before].filter((x) => !now.has(x)).sort((a, b) => a - b);
      const added = [...now].filter((x) => !before.has(x)).sort((a, b) => a - b);
      if (gone.length) says.push(`No ${k} line this month for lot${gone.length > 1 ? "s" : ""} ${gone.join(", ")}, which had one last month.`);
      if (added.length) says.push(`A ${k} line for lot${added.length > 1 ? "s" : ""} ${added.join(", ")} that was not there last month.`);
    }
    const rentNow = lines.filter((l) => kindOf(l) === "rent");
    for (const l of rentNow) {
      const lot = lotOf(l.label);
      const was = last.lines.find((x) => kindOf(x) === "rent" && lotOf(x.label) === lot);
      if (was && was.cents !== l.cents) says.push(`Lot ${lot} rent is ${usd(l.cents)}; it was ${usd(was.cents)} last month.`);
    }
    const dup = new Map<string, number>();
    for (const l of lines) { const k = `${l.label.trim().toLowerCase()}|${l.cents}`; dup.set(k, (dup.get(k) ?? 0) + 1); }
    for (const [k, c] of dup) if (c > 1) says.push(`"${k.split("|")[0]}" appears ${c} times for the same amount.`);
  }
  return { lastCents, lastOn: last.sentOn ?? null, diffCents: diff, loud: loud || says.length > 0, says };
}
