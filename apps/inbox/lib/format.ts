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

/** Every time in this application is Elizabeth City time.
 *
 *  Not the browser's, and emphatically not the server's -- which is UTC, and
 *  was showing a text sent at 9:02 in the evening as 1:02 AM. A timestamp that
 *  is four hours out is worse than no timestamp: it gets read to a tenant, or
 *  used to argue about when a repair was reported.
 *
 *  Pinned rather than local because the business is in one place. A manager
 *  looking at the inbox from a hotel in Denver needs to see the hour the tenant
 *  meant, not the hour on their own wrist. */
export const ZONE = "America/New_York";

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
