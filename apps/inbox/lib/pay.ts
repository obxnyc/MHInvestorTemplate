/**
 * What to pay each man for a week, and what each crew comes to.
 *
 * Money is whole cents throughout. Hours are the clock's own -- finished
 * shifts, recorded breaks off -- and nothing here rounds them up or docks
 * them down.
 *
 * A SHIFT STILL OPEN IS NOT PAID HERE. It is counted and named, so the screen
 * can say "Juan has a shift nobody closed", but an amount for it would be a
 * guess at an end time paid out as a wage. Close it (a correction, approved)
 * and it is in the next look at the same week.
 *
 * OVERTIME is hours past 40 in the week at time and a half, which is what the
 * federal rule says for hourly employees. It is a switch, because people paid
 * as contractors are not owed it -- and which of those somebody is, is a
 * question for the business, not for arithmetic.
 */

import { shiftHours, RULES, type Rules, type Shift } from "./shift";

export type Method = "zelle" | "cashapp" | "venmo" | "cash" | "check" | "other";

export const METHOD_SAID: Record<Method, string> = {
  zelle: "Zelle", cashapp: "Cash App", venmo: "Venmo",
  cash: "Cash", check: "Check", other: "Other",
};

export type Payee = {
  id: string;
  name: string;
  leadId: string | null;
  rateCents: number | null;
  method: Method | null;
  /** $cashtag, @venmo, or the Zelle phone/email. */
  handle: string | null;
};

export type PayLine = {
  staffId: string;
  name: string;
  crewId: string | null;
  crew: string;
  hours: number;
  regular: number;
  overtime: number;
  rateCents: number | null;
  amountCents: number | null;
  method: Method | null;
  handle: string | null;
  /** Shifts in the week nobody closed. Not paid until they are. */
  openShifts: number;
  /** Finished shifts the man himself has not agreed. */
  unsigned: number;
  /** Shifts the clock closed because he never clocked out. Paid, and to be
   *  looked at: the end time is the clock's best evidence, not his. */
  autoClosed: number;
  /** A tap that opens the payment with the amount filled in, where one exists. */
  payLink: string | null;
};

export type Crew = { id: string | null; name: string; hours: number; amountCents: number; people: number };

export const OT_AFTER = 40;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Cash App and Venmo will open a payment with the amount already in it.
 *  Zelle has no such link -- it lives inside each bank's own app. */
export function payLink(method: Method | null, handle: string | null, cents: number | null,
                        note = "Wages"): string | null {
  if (!handle || !cents || cents <= 0) return null;
  const amt = (cents / 100).toFixed(2);
  if (method === "cashapp") {
    const tag = handle.trim().replace(/^\$/, "");
    return /^[A-Za-z0-9_-]{1,20}$/.test(tag) ? `https://cash.app/$${tag}/${amt}` : null;
  }
  if (method === "venmo") {
    const user = handle.trim().replace(/^@/, "");
    return /^[A-Za-z0-9_-]{1,30}$/.test(user)
      ? `https://venmo.com/${user}?txn=pay&amount=${amt}&note=${encodeURIComponent(note)}`
      : null;
  }
  return null;
}

export function payWeek(
  payees: Payee[], shifts: (Shift & { autoOut?: boolean })[], crewNames: Record<string, string>,
  opts: { overtime?: boolean; rules?: Rules; note?: string } = {},
): { lines: PayLine[]; crews: Crew[]; totalCents: number; missingRates: number } {
  const rules = opts.rules ?? RULES;
  const ot = opts.overtime ?? true;

  const lines: PayLine[] = payees.map((p) => {
    const mine = shifts.filter((s) => s.staffId === p.id);
    const hours = r2(mine.reduce((a, s) => a + (shiftHours(s, rules) ?? 0), 0));
    const overtime = ot ? r2(Math.max(0, hours - OT_AFTER)) : 0;
    const regular = r2(hours - overtime);
    const amountCents = p.rateCents === null ? null
      : Math.round(regular * p.rateCents + overtime * p.rateCents * 1.5);
    return {
      staffId: p.id,
      name: p.name,
      crewId: p.leadId,
      crew: p.leadId ? `${crewNames[p.leadId] ?? "Unknown"}'s crew` : "No crew",
      hours, regular, overtime,
      rateCents: p.rateCents,
      amountCents,
      method: p.method,
      handle: p.handle,
      openShifts: mine.filter((s) => !s.endedAt).length,
      unsigned: mine.filter((s) => s.endedAt && !s.signedOffAt).length,
      autoClosed: mine.filter((s) => s.autoOut && s.endedAt).length,
      payLink: payLink(p.method, p.handle, amountCents, opts.note),
    };
  }).sort((a, b) => a.crew.localeCompare(b.crew) || a.name.localeCompare(b.name));

  const crewMap = new Map<string | null, Crew>();
  for (const l of lines) {
    const c = crewMap.get(l.crewId) ?? { id: l.crewId, name: l.crew, hours: 0, amountCents: 0, people: 0 };
    c.hours = r2(c.hours + l.hours);
    c.amountCents += l.amountCents ?? 0;
    c.people += 1;
    crewMap.set(l.crewId, c);
  }
  const crews = [...crewMap.values()].sort((a, b) =>
    (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0) || a.name.localeCompare(b.name));

  return {
    lines,
    crews,
    totalCents: lines.reduce((a, l) => a + (l.amountCents ?? 0), 0),
    // Hours with no rate are not zero dollars, they are an unanswered question.
    missingRates: lines.filter((l) => l.hours > 0 && l.rateCents === null).length,
  };
}
