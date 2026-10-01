import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { routeEmail, parseCourtFiling, isCourtFilingEmail, type RawEmail } from "@/lib/parse-email";
import { ingest, ingestCourtFiling } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time compare so the shared secret can't be recovered by timing. */
function secretOk(given: string | null) {
  // Trimmed, because a value pasted into a hosting dashboard collects a
  // trailing newline more often than anyone admits, and an untrimmed one
  // rejects every request while looking perfectly correct in the box. The
  // Twilio token has been trimmed for this reason since the beginning; this
  // one was not, and spent an afternoon answering 401 to a webhook whose
  // secret was right.
  const want = (process.env.INTAKE_SECRET ?? "").trim();
  const got = (given ?? "").trim();
  if (!want || !got) return false;

  const a = Buffer.from(got), b = Buffer.from(want);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    // Lengths, never values. "Both 32" says the secrets differ; "32 and 33"
    // says one of them has something on the end of it, and those are two
    // different afternoons.
    console.error("intake: secret did not match",
      { configured: want.length, received: got.length });
  }
  return ok;
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

  // Court filings never become conversations -- see ingestCourtFiling().
  if (isCourtFilingEmail(mail)) {
    return NextResponse.json(await ingestCourtFiling(parseCourtFiling(mail)));
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
