/**
 * Owner distributions: the monthly statement and the plan for paying it.
 *
 * Pure functions only -- the route and the screen both use them, and the
 * check in lib/__fixtures__/distribute.test.mjs runs them without a database.
 *
 * Money is integer cents throughout. A statement line is positive when it is
 * money to the owner and negative when it is a deduction.
 */

export type Line = { label: string; cents: number };

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

const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const monthLabel = (month: string) =>
  new Date(`${month.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export const subjectFor = (month: string) => `${monthLabel(month)} Owner Distribution`;

const dayLabel = (s: string) =>
  at(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export type StatementInput = {
  month: string; ownerName: string; lines: Line[]; note?: string | null;
  payments?: { sendOn: string; cents: number; arrivesOn?: string }[];
};

/** Email-safe HTML: tables and inline styles, because mail clients ignore
 *  stylesheets. Light ground on purpose -- a statement is read and printed. */
export function statementHtml(s: StatementInput): string {
  const net = netCents(s.lines);
  const income = s.lines.filter((l) => l.cents >= 0);
  const costs = s.lines.filter((l) => l.cents < 0);
  const row = (l: Line) => `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #E6E8EC;color:#1F2937">${esc(l.label)}</td>
    <td style="padding:8px 0;border-bottom:1px solid #E6E8EC;text-align:right;color:${l.cents < 0 ? "#9B2C2C" : "#1F2937"};font-variant-numeric:tabular-nums;white-space:nowrap">${l.cents < 0 ? `(${usd(-l.cents)})` : usd(l.cents)}</td>
  </tr>`;
  const head = (t: string) => `<tr><td colspan="2" style="padding:18px 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-weight:700">${t}</td></tr>`;
  const pays = (s.payments ?? []).filter((p) => p.cents > 0);
  const payBlock = pays.length ? `
    <p style="margin:22px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-weight:700">Payment</p>
    <p style="margin:0;color:#374151;line-height:1.6">${pays.map((p) =>
      `${usd(p.cents)} sent ${dayLabel(p.sendOn)}${p.arrivesOn ? `, expected by ${dayLabel(p.arrivesOn)}` : ""}`).join("<br>")}
      <br><span style="color:#6B7280">by Wells Fargo Business Bill Pay</span></p>` : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background:#F3F4F6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px">
  <tr><td style="background:#1F3554;padding:22px 28px;color:#FFFFFF">
    <div style="font-size:20px;font-weight:800;letter-spacing:-.01em">Larabee Homes</div>
    <div style="font-size:13px;opacity:.85;margin-top:2px">Owner Distribution Statement</div>
  </td></tr>
  <tr><td style="padding:24px 28px 8px">
    <div style="color:#6B7280;font-size:13px">${esc(monthLabel(s.month))}</div>
    <div style="font-size:19px;font-weight:700;color:#111827;margin-top:2px">${esc(s.ownerName)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-collapse:collapse">
      ${income.length ? head("Income") + income.map(row).join("") : ""}
      ${costs.length ? head("Deductions") + costs.map(row).join("") : ""}
      <tr>
        <td style="padding:16px 0 4px;font-weight:800;color:#111827;font-size:16px">Net distribution</td>
        <td style="padding:16px 0 4px;text-align:right;font-weight:800;color:#111827;font-size:18px;font-variant-numeric:tabular-nums;white-space:nowrap">${net < 0 ? `(${usd(-net)})` : usd(net)}</td>
      </tr>
    </table>
    ${payBlock}
    ${s.note ? `<p style="margin:22px 0 0;color:#374151;line-height:1.6;white-space:pre-wrap">${esc(s.note)}</p>` : ""}
  </td></tr>
  <tr><td style="padding:20px 28px 26px;color:#6B7280;font-size:12px;line-height:1.6;border-top:1px solid #E6E8EC">
    Questions about this statement? Reply to this email.<br>Larabee Homes LLC
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

export function statementText(s: StatementInput): string {
  const net = netCents(s.lines);
  const pad = (l: string, a: string) => `${l}${" ".repeat(Math.max(2, 40 - l.length - a.length))}${a}`;
  const money = (c: number) => (c < 0 ? `(${usd(-c)})` : usd(c));
  return [
    `Larabee Homes -- Owner Distribution Statement`,
    `${monthLabel(s.month)} -- ${s.ownerName}`,
    ``,
    ...s.lines.map((l) => pad(l.label, money(l.cents))),
    `-`.repeat(40),
    pad("Net distribution", money(net)),
    ...((s.payments ?? []).length ? ["", ...s.payments!.map((p) =>
      `${usd(p.cents)} sent ${dayLabel(p.sendOn)}${p.arrivesOn ? `, expected by ${dayLabel(p.arrivesOn)}` : ""}`)] : []),
    ...(s.note ? ["", s.note] : []),
    ``,
    `Questions about this statement? Reply to this email.`,
    `Larabee Homes LLC`,
  ].join("\n");
}
