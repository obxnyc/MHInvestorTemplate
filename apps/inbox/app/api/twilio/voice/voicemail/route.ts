import { NextResponse } from "next/server";
import { checkTwilioSignature, formToObject, publicBase } from "@/lib/twilio";
import { twiml } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const params = formToObject(raw);
  const base = publicBase(req);
  const sig = checkTwilioSignature(req, "/api/twilio/voice/voicemail", params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  // maxLength is 120 on purpose. Twilio's built-in transcription only covers
  // recordings between 2 and 120 seconds, so a longer cap would silently
  // produce voicemails with no transcript at all. Anyone who needs more than
  // two minutes needs a callback anyway.
  return twiml(
    `<Say voice="Polly.Joanna">Sorry we missed you. Please leave a message `
    + `after the tone, and someone will call you back.</Say>`
    + `<Record maxLength="120" playBeep="true" trim="trim-silence" transcribe="true"`
    + ` transcribeCallback="${base}/api/twilio/voice/transcription"`
    + ` recordingStatusCallback="${base}/api/twilio/voice/recording"/>`
    + `<Say voice="Polly.Joanna">We did not get a message. Goodbye.</Say>`
  );
}
