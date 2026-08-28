/**
 * Cloudflare Email Worker — the intake pipe for every notification email.
 *
 * Zego maintenance requests, Zillow leads, and Squarespace form submissions all
 * arrive as email. This receives them and POSTs a normalized shape to the app.
 * Cloudflare Email Routing is free, so this costs nothing.
 *
 * Deploy:
 *   1. Cloudflare dashboard → your domain → Email → Email Routing → enable
 *   2. Create address  intake@larabeehomes.com  → route to Worker
 *   3. wrangler deploy, then set the secrets:
 *        wrangler secret put INTAKE_URL      # https://<app>/api/intake/email
 *        wrangler secret put INTAKE_SECRET   # must match the app's env var
 *   4. In Zego, Zillow, and Squarespace, add intake@ as a notification
 *      recipient — alongside your existing ones, not instead of them.
 */
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text();

    // Prefer the text/plain part; fall back to stripping tags from HTML.
    let text = extractPart(raw, "text/plain");
    if (!text) {
      const html = extractPart(raw, "text/html") ?? raw;
      text = html.replace(/<style[\s\S]*?<\/style>/gi, "")
                 .replace(/<[^>]+>/g, " ")
                 .replace(/&nbsp;/g, " ")
                 .replace(/&amp;/g, "&")
                 .replace(/[ \t]+/g, " ")
                 .replace(/\n\s*\n\s*\n+/g, "\n\n")
                 .trim();
    }

    const res = await fetch(env.INTAKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-intake-secret": env.INTAKE_SECRET,
      },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.headers.get("subject") ?? "",
        messageId: message.headers.get("message-id") ?? `cf:${crypto.randomUUID()}`,
        text,
      }),
    });

    // Throwing tells Cloudflare to retry. Better a retry than a lost
    // maintenance request; the app dedupes on messageId.
    if (!res.ok) throw new Error(`intake responded ${res.status}`);
  },
};

function extractPart(raw, mime) {
  const i = raw.toLowerCase().indexOf(`content-type: ${mime}`);
  if (i === -1) return null;
  const start = raw.indexOf("\r\n\r\n", i);
  if (start === -1) return null;
  const rest = raw.slice(start + 4);
  const end = rest.search(/\r?\n--[-\w]+/);
  const body = end === -1 ? rest : rest.slice(0, end);
  return decodeQuotedPrintable(body).trim() || null;
}

function decodeQuotedPrintable(s) {
  return s.replace(/=\r?\n/g, "")
          .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
