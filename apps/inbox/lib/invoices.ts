/**
 * Vendor invoices, and the one rule that makes them worth having: what was
 * first submitted can always be read, next to whatever replaced it and why.
 *
 * The database enforces that. These are the parts the application needs in
 * order to speak about it -- reading a typed amount, and working out which
 * row of a chain is the one that counts.
 */

export type Invoice = {
  id: string;
  amountCents: number;
  invoiceNo: string | null;
  description: string | null;
  filePath: string | null;
  replaces: string | null;
  reason: string | null;
  createdAt: string;
  emailedAt: string | null;
  rmPushedAt: string | null;
};

/** Money as somebody types it, in cents.
 *
 *  Cents, never a float: 0.1 + 0.2 is not 0.3, and a total that is a cent out
 *  is an argument with a contractor who is right.
 *
 *  Tolerant of what a person actually types into a box on a phone -- a dollar
 *  sign, thousands separators, a trailing period -- and refuses anything it
 *  cannot read rather than guessing. Returning null matters: a misread amount
 *  that silently becomes 0 is worse than a form that says "that doesn't look
 *  like an amount". */
export function parseMoney(input: string): number | null {
  const cleaned = (input ?? "").trim().replace(/[$\s,]/g, "");
  if (!cleaned) return null;
  // One optional decimal point and up to two places after it. "380.", "380.5"
  // and "380.50" are all things people type on a phone, and the first of them
  // is a finished number with a stray keystroke on the end, not a mistake
  // worth refusing. "380.555" is not an amount.
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * The invoice that counts, out of a chain of corrections.
 *
 * A chain is rows pointing backwards: the correction names what it replaces.
 * The one that counts is therefore the row nothing else replaces. Worked out
 * rather than stored, because a stored "is_current" flag is a second source
 * of truth, and the first thing a second source of truth does is disagree.
 */
export function currentOf(chain: Invoice[]): Invoice | null {
  if (!chain.length) return null;
  const replaced = new Set(chain.map((i) => i.replaces).filter(Boolean) as string[]);
  const live = chain.filter((i) => !replaced.has(i.id));
  // Exactly one, normally. More than one means two unrelated invoices on the
  // same job -- a plumber's and an electrician's -- and the newest is the one
  // being asked about.
  return live.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** Oldest first, so the history reads the way it happened. */
export function chronological(chain: Invoice[]): Invoice[] {
  return [...chain].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** What changed between a correction and what it replaced, in words.
 *
 *  Said out loud rather than left for the reader to diff two numbers: "was
 *  $380.00, now $830.00" is the sentence somebody needs when they are
 *  deciding whether to query it. */
export function whatChanged(from: Invoice, to: Invoice): string[] {
  const out: string[] = [];
  if (from.amountCents !== to.amountCents) {
    out.push(`was ${money(from.amountCents)}, now ${money(to.amountCents)}`);
  }
  if ((from.invoiceNo ?? "") !== (to.invoiceNo ?? "")) {
    out.push(`invoice number ${from.invoiceNo || "(none)"} → ${to.invoiceNo || "(none)"}`);
  }
  if ((from.description ?? "") !== (to.description ?? "")) {
    out.push("description changed");
  }
  if ((from.filePath ?? null) !== (to.filePath ?? null)) {
    out.push(to.filePath ? "a new file was attached" : "the file was removed");
  }
  return out;
}

/**
 * Who gets told, out of BOOKKEEPER_EMAIL.
 *
 * One address or several, separated however somebody felt like separating
 * them in a hosting dashboard at nine at night -- commas, semicolons, a
 * newline from a paste. All of those are the same intention and none of them
 * should be the reason a bookkeeper stops hearing about invoices.
 *
 * Anything without an @ in it is dropped rather than sent to. A typo that
 * silently becomes a recipient is how a bounce queue starts.
 */
export function recipients(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(/[,;\n]/)
    .map((a) => a.trim())
    .filter((a) => a.includes("@") && !a.includes(" "))
    // The same address twice is one email, not two.
    .filter((a, i, all) => all.indexOf(a) === i);
}
