import { NextResponse } from "next/server";
import { checkTwilioSignature, formToObject, publicBase } from "@/lib/twilio";
import { twiml, say, callSettings, inLang, asLang, PHRASE } from "@/lib/voice";
import { callBySid } from "@/lib/calllog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 *   k=leasing         somebody looking for a home, after hours
 *   k=leasing-texted  the same, and the listings have just been texted to them
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const base = publicBase(req);
  const sig = checkTwilioSignature(req, `/api/twilio/voice/voicemail${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const s = await callSettings();
  const lang = asLang((await callBySid(params.CallSid))?.language);
  const k = url.searchParams.get("k") ?? "";
  const prompt = k.startsWith("leasing")
    ? inLang(s, "leasing_prompt", lang) + (k === "leasing-texted"
        ? (lang === "es"
          ? " Mientras tanto, le enviamos un mensaje de texto con nuestras casas disponibles."
          : " In the meantime, we have sent you a text message with our available homes.")
        : "")
    : inLang(s, "voicemail_prompt", lang);

  // maxLength is 120 on purpose. Twilio's built-in transcription only covers
  // recordings between 2 and 120 seconds, so a longer cap would silently
  // produce voicemails with no transcript at all.
  //
  // The action is not optional. Without one, Twilio posts the finished
  // recording back to THIS document -- and the caller hears the greeting again
  // and is asked to leave a second message.
  return twiml(
    say(prompt, lang)
    + `<Record maxLength="120" playBeep="true" trim="trim-silence" transcribe="true"`
    + ` action="${base}/api/twilio/voice/voicemail/done" method="POST"`
    + ` transcribeCallback="${base}/api/twilio/voice/transcription"`
    + ` recordingStatusCallback="${base}/api/twilio/voice/recording?k=voicemail"/>`
    + say(PHRASE.nothing[lang], lang)
    + "<Hangup/>"
  );
}
