import { formToObject, checkTwilioSignature, publicBase } from "@/lib/twilio";
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

  // The action is the whole fix. A Gather with no action posts the digit back
  // to the document it came from -- so pressing one played the prompt again,
  // and again, for as long as anybody kept pressing.
  //
  // publicBase rather than a relative path: Twilio resolves this URL itself,
  // and it signs the absolute address it ends up calling.
  const accept = `${publicBase(req)}/api/twilio/voice/whisper/accept`;

  return twiml(
    `<Gather numDigits="1" timeout="8" action="${accept}" method="POST">`
    + `<Say voice="Polly.Joanna">Larabee Homes call. Press one to accept.</Say>`
    + `</Gather>`
    // Reached only when nothing was pressed: this leg declines and the caller
    // stays with whoever else is still ringing.
    + `<Hangup/>`
  );
}
