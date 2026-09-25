import { NextResponse } from "next/server";
import { formToObject, checkTwilioSignature } from "@/lib/twilio";
import { twiml } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The keypress that accepts a call.
 *
 * A whisper ends when its TwiML runs out, and the leg is then bridged to the
 * caller. So "accept" is an EMPTY response: nothing more to say to this person,
 * connect them. Anything else -- another Say, another Gather -- keeps the
 * whisper going, which is exactly the loop this route exists to end.
 *
 * Without an action URL, a Gather posts the digit back to the document it came
 * from. The whisper then plays again, and pressing one repeats the prompt for
 * as long as anybody is willing to keep pressing it.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(
    req, `/api/twilio/voice/whisper/accept${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  // Only 1 accepts. Any other key is a pocket, or somebody who meant to
  // decline, and a call bridged to a pocket is a caller talking to nobody.
  if (params.Digits === "1") return twiml("");

  return twiml(
    `<Say voice="Polly.Joanna">Not accepted.</Say><Hangup/>`
  );
}
