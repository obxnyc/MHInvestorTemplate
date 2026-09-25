import { NextResponse } from "next/server";
import { checkTwilioSignature, formToObject, publicBase } from "@/lib/twilio";
import { ringStages, groupIntro, twiml, escapeXml } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ringing a group, one rung at a time.
 *
 * The same endpoint both starts a rung and is what Twilio calls when that rung
 * ends, because they are the same question asked twice: who is next. The stage
 * number lives in the URL, so no state is kept between calls and a retry cannot
 * ring somebody twice or skip them.
 *
 * Every leg still has to press 1. That is not ceremony -- a phone that is off
 * answers INSTANTLY with its owner's personal voicemail, which would swallow
 * the call while four other phones stopped ringing. A voicemail box cannot
 * press 1, so it can never win.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, `/api/twilio/voice/ring${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const base = publicBase(req);
  const groupId = url.searchParams.get("g") ?? "";
  const from = Math.max(1, Number(url.searchParams.get("s") ?? "1"));

  // Arriving from a finished <Dial>. Somebody took it: nothing more to do, and
  // the call is already bridged.
  if (params.DialCallStatus === "completed") return twiml("");

  const stages = await ringStages(groupId);

  // The first rung with anybody on it. An empty rung is skipped rather than
  // ringing nobody for forty seconds, which from the caller's end is
  // indistinguishable from being ignored.
  const stage = stages.find((s) => s.position >= from && s.numbers.length);
  if (!stage) {
    return twiml(`<Redirect>${base}/api/twilio/voice/voicemail</Redirect>`);
  }

  const intro = from === 1 ? await groupIntro(groupId) : null;
  const next = `${base}/api/twilio/voice/ring?g=${groupId}&amp;s=${stage.position + 1}`;

  const numbers = stage.numbers.map((n) =>
    `<Number url="${base}/api/twilio/voice/whisper"`
    + ` statusCallbackEvent="answered completed">${escapeXml(n)}</Number>`
  ).join("");

  return twiml(
    (intro ? `<Say voice="Polly.Joanna">${escapeXml(intro)}</Say>` : "")
    + `<Dial timeout="${stage.seconds}" answerOnBridge="true"`
    + ` record="record-from-answer-dual"`
    + ` recordingStatusCallback="${base}/api/twilio/voice/recording"`
    + ` action="${next}">${numbers}</Dial>`
  );
}
