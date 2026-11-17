import { NextResponse } from "next/server";
import { checkTwilioSignature, formToObject } from "@/lib/twilio";
import { twiml, say, asLang, PHRASE } from "@/lib/voice";
import { callBySid } from "@/lib/calllog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** After the beep: thank them and let them go. The recording itself arrives
 *  separately, at /recording and /transcription. */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, "/api/twilio/voice/voicemail/done", params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });
  const lang = asLang((await callBySid(params.CallSid))?.language);
  return twiml(say(PHRASE.thanks[lang], lang) + "<Hangup/>");
}
