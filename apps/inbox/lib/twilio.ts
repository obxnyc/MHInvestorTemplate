import twilio from "twilio";

/**
 * Verify a request really came from Twilio.
 *
 * Twilio signs the exact URL it called plus the sorted POST body, so the check
 * fails unless we hash the same string Twilio did. Two things break that in
 * practice:
 *   - reading the body with req.formData() first (the raw text is consumed)
 *   - validating against a configured origin that does not byte-for-byte match
 *     the URL in the Twilio console -- a trailing slash, http vs https, or a
 *     deployment host that is not the one the webhook points at
 *
 * The second used to be a silent 403 that looked identical to an attack. So the
 * URL is now rebuilt from the host the request actually arrived on, with
 * PUBLIC_BASE_URL kept as a second candidate for anyone running behind a proxy
 * that rewrites Host.
 *
 * Trusting the Host header here does not weaken anything: forging it cannot
 * produce a valid signature without the auth token, and the path is written by
 * the route rather than taken from the request, so a signed body from a
 * different Twilio webhook cannot be replayed into this one. The only thing the
 * header admits is a replay of this same endpoint, which the unique index on
 * twilio_sid already refuses.
 *
 * Without this check the endpoint is a public API for anyone who guesses the
 * URL: they could inject messages into tenant threads.
 */

export type SignatureCheck =
  | { ok: true }
  | { ok: false; status: number; reason: string };

/** Hostnames only -- a Host header carrying a scheme or a path is malformed,
 *  and would build a candidate URL that is not a URL. */
const HOSTNAME = /^[a-z0-9.-]+(:\d+)?$/i;

/** Every URL this request could plausibly have been signed as.
 *
 *  More than one because Twilio hashes the URL exactly as it was configured,
 *  and a console entry can differ from the route in ways that never reach the
 *  application: a trailing slash (which Next redirects away, after the
 *  signature is already fixed), or a query string on the webhook URL. Each
 *  candidate costs one HMAC -- microseconds -- and the alternative is a 403
 *  that looks identical to an attack.
 *
 *  Widening this does not weaken the check. Every candidate still has to be
 *  signed with the account's auth token, and the paths are built from the
 *  route, not accepted from the caller. */
function candidateUrls(req: Request, path: string): string[] {
  const urls: string[] = [];
  const add = (u: string) => { if (!urls.includes(u)) urls.push(u); };

  // The path as the request actually arrived, which picks up a query string
  // on the configured webhook URL. It is still this route's own path -- Next
  // routed the request here -- so it cannot name some other endpoint.
  let asArrived = path;
  try {
    const u = new URL(req.url);
    asArrived = u.pathname + u.search;
  } catch { /* keep the route's own path */ }

  const origins: string[] = [];
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") ?? "https")
    .split(",")[0].trim();
  if (HOSTNAME.test(host) && (proto === "https" || proto === "http")) {
    origins.push(`${proto}://${host}`);
  }
  const base = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (base) origins.push(base);

  for (const origin of origins) {
    add(`${origin}${asArrived}`);
    add(`${origin}${path}`);
    add(`${origin}${path}/`);          // console entry with a trailing slash
  }

  return urls;
}

/** The result says which precondition failed, and callers put that in the
 *  response body. Twilio records the body against the error in its console, so
 *  a misconfigured deployment explains itself there instead of presenting as an
 *  unexplained 11200. None of the values are secret: they are the public URL
 *  the caller already knows, and the names of variables that are missing. */
export function checkTwilioSignature(
  req: Request,
  path: string,
  params: Record<string, string>,
): SignatureCheck {
  // Also logged, not only returned. Twilio keeps the response body, but reading
  // it means finding the right screen in their console; the same sentence in the
  // hosting logs is one search away. Neither the signature nor the token is
  // included -- the reason says what is wrong, not what the secret is.
  const refuse = (status: number, reason: string): SignatureCheck => {
    console.error(`twilio webhook refused ${path}: ${reason}`);
    return { ok: false, status, reason };
  };

  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return refuse(403, "no x-twilio-signature header");

  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return refuse(500, "TWILIO_AUTH_TOKEN is not set on the server");

  const urls = candidateUrls(req, path);
  if (!urls.length) {
    return refuse(500,
      "cannot determine the URL this was called on: no Host header and no PUBLIC_BASE_URL");
  }

  for (const url of urls) {
    if (twilio.validateRequest(token, signature, url, params)) return { ok: true };
  }

  return refuse(403, `signature did not match; validated against ${urls.join(" and ")}`);
}

/** The origin to put inside TwiML we hand back to Twilio, for the callbacks it
 *  will make next. PUBLIC_BASE_URL wins here -- a callback should go to the
 *  canonical host rather than whichever alias this request happened to arrive
 *  on -- but the request host is a working fallback, so a missing variable
 *  degrades to "still works" instead of Twilio fetching "undefined/...". */
export function publicBase(req: Request): string {
  const configured = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;

  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
  return HOSTNAME.test(host) ? `${proto}://${host}` : "";
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
