import { NextResponse } from "next/server";
import { checkTwilioSignature, formToObject } from "@/lib/twilio";
import { twiml, say, asLang } from "@/lib/voice";
import { callBySid } from "@/lib/calllog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Twilio's own hold music, served from its public bucket. */
const MUSIC = "http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3";

/** The caller, while the person they were talking to chooses where to send
 *  them. Music rather than silence: silence on a phone reads as a dropped
 *  call, and a caller who thinks they were dropped hangs up. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, `/api/twilio/voice/hold${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });
  const lang = asLang((await callBySid(params.CallSid))?.language);
  return twiml(say(lang === "es" ? "Por favor espere." : "Please hold.", lang)
    + `<Play loop="0">${MUSIC}</Play>`);
}
