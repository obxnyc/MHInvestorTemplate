import { parsePhoneNumberFromString } from "libphonenumber-js";
export function prettyPhone(e164: string) {
  // The local form for local numbers, because that is how the office reads and
  // says them. (252) 642-2995, not +1 252 642 2995.
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  // Everywhere else, that country's own grouping. Country codes are one to
  // three digits with no way to tell which from the number alone, so this is a
  // lookup rather than a regex -- splitting +573144504939 by guesswork gives
  // "+573 144..." , which is a different country and a number nobody can ring.
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

export function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString("en-US", { timeZone: ZONE });
}

/* The zone lives in lib/zone.ts, on its own, so that importing it does not
   drag this file's phone-number parser along. Re-exported here because
   everything that formats a time already asks this file for it. */
import { ZONE } from "@/lib/zone";
export { ZONE };

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: ZONE, hour: "numeric", minute: "2-digit",
  });
}

/** The day separator in a thread, in the same zone for the same reason: a
 *  message sent at 9pm must not sit under tomorrow's heading. */
export function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: ZONE, weekday: "long", month: "short", day: "numeric",
  });
}

/** A name gives initials; an unsaved number gives its last two digits, because
 *  "(2" tells you nothing and reads like a rendering fault. */
export function initials(n: string) {
  const s = String(n).trim();
  if (/^[\d\s()+\-.]+$/.test(s)) return s.replace(/\D/g, "").slice(-2) || "#";
  return s.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

/** Tinted per person so a face is recognisable down a list. Derived from the
 *  name rather than stored, so the same person is the same colour everywhere
 *  without a column to keep in step. */
const SWATCH: [string, string][] = [
  ["#E3ECFA", "#2F4E7E"], ["#FAE6EC", "#7E3350"], ["#E4F0E9", "#0F4B36"],
  ["#F0EAFA", "#54417F"], ["#FBEEE3", "#8A4418"], ["#E6F1F4", "#1F5566"],
];

export const swatch = (n: string): [string, string] =>
  SWATCH[[...String(n)].reduce((a, c) => a + c.charCodeAt(0), 0) % SWATCH.length];

/** A real, dialable number — or nothing.
 *
 *  `contacts.phone` is `not null unique` and is the join key every webhook
 *  matches on, so a request that arrives with no number still needs
 *  something in that column. Intake writes a synthetic one:
 *  `email:rm:issue:251`.
 *
 *  That is fine as a key and a disaster on screen. `prettyPhone` hands back
 *  anything it cannot parse, so the inbox listed a column of threads called
 *  "email:rm:issue:251", "email:rm:issue:250" -- an internal id where the
 *  tenant's name should be, which is unreadable and looks broken.
 *
 *  So: a number is only a number if it is one. Everything else is nothing,
 *  and the caller shows what it actually knows instead.
 */
export function realPhone(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v || !v.startsWith("+")) return null;
  return /^\+[1-9]\d{6,14}$/.test(v) ? v : null;
}

/** What to call a thread, given what little may be known about it.
 *
 *  In order: the person's name, then their number, then what the thread is
 *  ABOUT, and only then a generic word. A Rent Manager issue with no tenant
 *  on it reads as "Water is coming out green" rather than as an id -- which
 *  is not who, but it is something a person can act on, and it is honest
 *  about not knowing who.
 */
export function threadLabel(
  fullName: string | null | undefined,
  phone: string | null | undefined,
  about: string | null | undefined,
): string {
  const named = (fullName ?? "").trim();
  if (named) return named;
  const real = realPhone(phone);
  if (real) return prettyPhone(real);
  const subject = (about ?? "").trim();
  if (subject) return subject.length > 60 ? `${subject.slice(0, 57)}…` : subject;
  return "Unknown sender";
}
