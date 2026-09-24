import { formToObject, checkTwilioSignature } from "@/lib/twilio";
import { twiml } from "@/lib/voice";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Played to the employee's leg only, before the call bridges. Pressing 1 both
 *  accepts the call and proves a human is on the line. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  // The query string is part of what Twilio signed, so it belongs in the path
  // we validate against -- and it is read back from the request rather than
  // rebuilt, so it matches character for character.
  const sig = checkTwilioSignature(req, `/api/twilio/voice/whisper${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  return twiml(
    `<Gather numDigits="1" timeout="8">`
    + `<Say voice="Polly.Joanna">Larabee Homes call. Press one to accept.</Say>`
    + `</Gather><Hangup/>`
  );
}
