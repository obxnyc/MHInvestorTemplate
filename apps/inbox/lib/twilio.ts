import twilio from "twilio";

/**
 * Verify a request really came from Twilio.
 *
 * Twilio signs the full URL it called plus the sorted POST body. Two things
 * break this in practice:
 *   - reading the body with req.formData() first (the raw text is consumed)
 *   - a PUBLIC_BASE_URL that doesn't byte-for-byte match the webhook URL
 *     configured in the console, including scheme and any trailing path
 *
 * Without this check the endpoint is a public API for anyone who guesses the
 * URL: they could inject messages into tenant threads.
 */
export function verifyTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature) return false;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) throw new Error("TWILIO_AUTH_TOKEN is not set");
  return twilio.validateRequest(token, signature, url, params);
}

/** Parse an x-www-form-urlencoded body that we have already read as text. */
export function formToObject(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  new URLSearchParams(raw).forEach((v, k) => { out[k] = v; });
  return out;
}

export function twilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
}

/** Digits-only US numbers to E.164, which is the join key for every contact. */
export function toE164(input: string): string {
  const d = input.replace(/\D/g, "");
  if (input.trim().startsWith("+")) return "+" + d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return "+" + d;
}
