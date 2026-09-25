import { parsePhoneNumberFromString } from "libphonenumber-js";

/* Phone numbers, with nothing server-only in the file.
 *
 * These live apart from lib/twilio because components need them, and
 * lib/twilio imports the Twilio SDK -- importing canSmsFromLine from there
 * into a client component would ship the whole SDK to the browser. */

/** To E.164, which is the join key for every contact.
 *
 *  A bare ten digits is assumed to be American, because nearly every number
 *  typed into this system is. Anything written with a leading + is taken as
 *  given -- that is how somebody enters a number that is not.
 *
 *  The digit handling underneath is kept as a fallback. This is a join key: a
 *  half-typed number still has to normalise to the SAME string every time, or
 *  the same person comes back as two contacts. */
export function toE164(input: string): string {
  const raw = String(input ?? "");
  const parsed = parsePhoneNumberFromString(raw, "US");
  if (parsed) return parsed.number;

  const d = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return "+" + d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return "+" + d;
}

/** A real, reachable number -- anywhere. Checked against the actual numbering
 *  plan of the country it belongs to, so +57 314 4504939 passes and a US number
 *  with nine digits does not. */
export function isValidPhone(e164: string): boolean {
  return parsePhoneNumberFromString(e164)?.isValid() ?? false;
}

/**
 * Whether the shared line can send this number a text.
 *
 * Only the United States and Canada, and that is a carrier rule rather than a
 * choice: the shared line is a US 10-digit long code, and American long codes
 * are not permitted to send SMS outside the US and Canada. A message to any
 * other country is rejected by Twilio, not delivered late.
 *
 * So anywhere a number is about to be texted, ask this first. Somebody it
 * returns false for is not unreachable -- they are staff, and the app reaches
 * them anywhere. It is the text that cannot get there, not the message.
 */
export function canSmsFromLine(e164: string): boolean {
  return /^\+1\d{10}$/.test(e164);
}
