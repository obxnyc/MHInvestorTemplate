import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { routeEmail, type RawEmail } from "@/lib/parse-email";
import { ingest } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretOk(given: string | null) {
  const want = process.env.INTAKE_SECRET;
  if (!want || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Postmark's inbound webhook payload (the fields we use). */
type PostmarkInbound = {
  From?: string;
  FromFull?: { Email?: string; Name?: string };
  To?: string;
  OriginalRecipient?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  MessageID?: string;
  Headers?: { Name: string; Value: string }[];
};

/**
 * Inbound email via Postmark, which needs no DNS changes at all.
 *
 * This is the path to use when larabeehomesllc.com already carries your
 * business email: Cloudflare Email Routing REPLACES a domain's MX records, so
 * turning it on where Google Workspace or Microsoft 365 is running would stop
 * your real mail. Here you keep your MX exactly as it is and add a forwarding
 * filter in Gmail instead.
 *
 * Postmark does not sign inbound webhooks, so the shared secret travels as a
 * query parameter on the webhook URL. Keep that URL secret; it is a
 * credential.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!secretOk(url.searchParams.get("secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const p = (await req.json()) as PostmarkInbound;

  // Gmail forwarding rewrites the envelope, so the original sender is the
  // reliable signal for routing -- not who the message was addressed to.
  const from = p.FromFull?.Email ?? p.From ?? "";
  const text = p.TextBody?.trim()
    || stripHtml(p.HtmlBody ?? "")
    || "(no message body)";

  const mail: RawEmail = {
    from,
    to: p.OriginalRecipient ?? p.To ?? "",
    subject: p.Subject ?? "",
    messageId: p.MessageID ?? `pm:${Date.now()}`,
    text,
  };

  const item = routeEmail(mail);
  if (!item) {
    // 200 so Postmark stops retrying, but loud in the logs: a silently ignored
    // maintenance email is the worst outcome this endpoint has.
    console.warn("intake/postmark: no parser matched", { from: mail.from, subject: mail.subject });
    return NextResponse.json({ ok: true, ignored: true });
  }

  return NextResponse.json(await ingest(item));
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}
