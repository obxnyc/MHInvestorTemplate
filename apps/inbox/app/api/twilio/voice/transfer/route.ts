import { NextResponse } from "next/server";
import { checkTwilioSignature, formToObject, publicBase } from "@/lib/twilio";
import { twiml, say, escapeXml, asLang, PHRASE } from "@/lib/voice";
import { callBySid } from "@/lib/calllog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where a transferred caller is sent. /api/calls/[id]/transfer points the
 * caller's leg here, which ends the conversation they were in and starts this:
 * a sentence, then the same ringing as any other call -- one person (p) or a
 * group (g) -- with the whisper saying "Transferred" first.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, `/api/twilio/voice/transfer${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const q = new URLSearchParams();
  for (const k of ["p", "g", "r"]) {
    const v = url.searchParams.get(k);
    if (v) q.set(k, v);
  }
  q.set("s", "1");
  q.set("t", "1");

  const lang = asLang((await callBySid(params.CallSid))?.language);
  return twiml(say(PHRASE.transfer[lang], lang)
    + `<Redirect method="POST">${publicBase(req)}/api/twilio/voice/ring?${escapeXml(q.toString())}</Redirect>`);
}
