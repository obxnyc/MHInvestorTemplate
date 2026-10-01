/**
 * A forwarded notification, read the way a person reads it.
 *
 * What gets stored is the whole email, headers and all, and that is right:
 * the original is the record, and a parser that quietly drops a line is a
 * parser that eventually drops the line that mattered. But the whole email is
 * not what anybody wants to look at in a thread. Four lines of Gmail
 * forwarding furniture sit above the one sentence that says the toilet is
 * leaking.
 *
 * So this reads the shape back out for display only. Nothing here changes
 * what is stored, and every field is optional: a provider rewording its
 * template must degrade to showing the original, never to showing nothing.
 */

export type IntakeView = {
  /** Who really sent it, out of the forwarded headers. */
  from: string | null;
  /** When they sent it -- the original Date line, not when we happened to
   *  forward it. A repair reported on Tuesday and forwarded on Thursday is a
   *  two-day-old repair, and the thread should not claim otherwise. */
  sentAt: string | null;
  /** The place, as the subject line writes it. */
  place: string | null;
  title: string | null;
  description: string | null;
  tenant: string | null;
  phone: string | null;
  /** True when enough was understood to be worth showing instead of the raw
   *  text. One field is not enough; a heading with nothing under it is worse
   *  than the email. */
  readable: boolean;
};

const line = (text: string, ...labels: string[]): string | null => {
  for (const label of labels) {
    const re = new RegExp(`^[ \\t>]*${label}[ \\t]*:[ \\t]*(.*)$`, "im");
    const m = re.exec(text);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
};

export function readIntake(raw: string): IntakeView {
  const text = raw ?? "";

  const fromLine = line(text, "From");
  // "Rent Manager Event Notifier <donotreply@rentmanager.com>" -- the name,
  // because the address is noise to everyone except a debugger.
  const from = fromLine
    ? (/^\s*"?([^"<]+?)"?\s*</.exec(fromLine)?.[1]?.trim() ?? fromLine)
    : null;

  const subject = line(text, "Subject");
  const place = subject
    ? (/from TWA:\s*(.+)$/i.exec(subject)?.[1]?.trim() ?? null)
    : null;

  const title = line(text, "Issue Title", "Issue");
  const description = line(text, "Description", "Details");
  const tenant = line(text, "Tenant", "Resident");
  const phone = line(text, "Number", "Phone", "Phone Number");

  const sentAt = line(text, "Date");

  return {
    from, sentAt, place, title, description, tenant, phone,
    // Two fields, not one. A card showing only a heading tells you less than
    // the email it replaced.
    readable: [title, description, place, tenant].filter(Boolean).length >= 2,
  };
}

/** The original Date header as something to show. Returns the string
 *  unchanged when it cannot be parsed, because a date we cannot read is still
 *  a date somebody wrote, and dropping it would lose the only record of when
 *  the tenant actually reported this. */
export function sentWhen(sentAt: string | null): string | null {
  if (!sentAt) return null;
  const t = Date.parse(sentAt);
  if (Number.isNaN(t)) return sentAt;
  return new Date(t).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
