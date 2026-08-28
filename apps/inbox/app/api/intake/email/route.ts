import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { routeEmail, type RawEmail } from "@/lib/parse-email";
import { ingest } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time compare so the shared secret can't be recovered by timing. */
function secretOk(given: string | null) {
  const want = process.env.INTAKE_SECRET;
  if (!want || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Receives forwarded notification email — Zego maintenance requests, Zillow
 * leads — as JSON from an email-routing worker. See cloudflare/email-worker.js.
 *
 * Provider-agnostic on purpose: any inbound-parse service can be adapted to
 * this shape, so switching providers doesn't touch the parsing.
 */
export async function POST(req: Request) {
  if (!secretOk(req.headers.get("x-intake-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const mail = (await req.json()) as RawEmail;
  if (!mail?.messageId || !mail?.text) {
    return NextResponse.json({ error: "missing messageId or text" }, { status: 400 });
  }

  const item = routeEmail(mail);
  if (!item) {
    // Unrecognized sender. Accept it so the worker doesn't retry forever, but
    // say so loudly in the logs -- a silently ignored maintenance email is the
    // worst possible outcome here.
    console.warn("intake/email: no parser matched", { from: mail.from, subject: mail.subject });
    return NextResponse.json({ ok: true, ignored: true });
  }

  const result = await ingest(item);
  return NextResponse.json(result);
}
