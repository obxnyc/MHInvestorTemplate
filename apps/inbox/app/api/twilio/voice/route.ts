import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTwilioSignature, formToObject, toE164 } from "@/lib/twilio";
import { ringGroup, twiml, escapeXml } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An inbound call to the shared line.
 *
 * Every staff cell rings at once, but each leg has to press 1 to accept. That
 * whisper is not a nicety: a phone that is off or out of service answers
 * INSTANTLY with its owner's personal voicemail, which silently swallows the
 * call. A voicemail box cannot press 1, so it can never win the race.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = formToObject(raw);
  const base = process.env.PUBLIC_BASE_URL;
  if (!verifyTwilioSignature(req.headers.get("x-twilio-signature"), `${base}/api/twilio/voice`, params)) {
    return new NextResponse("invalid signature", { status: 403 });
  }

  const from = toE164(params.From ?? "");
  const db = supabaseAdmin();

  let { data: contact } = await db.from("contacts").select("id").eq("phone", from).maybeSingle();
  if (!contact) {
    const { data } = await db.from("contacts")
      .insert({ phone: from, party: "other" }).select("id").single();
    contact = data!;
  }

  await db.from("calls").insert({
    contact_id: contact.id,
    direction: "inbound",
    twilio_call_sid: params.CallSid,
  });

  const staff = await ringGroup();
  const numbers = staff.map((s) =>
    `<Number url="${base}/api/twilio/voice/whisper?staff=${s.id}"`
    + ` statusCallbackEvent="answered completed">${escapeXml(s.forward_to!)}</Number>`
  ).join("");

  // No one configured to ring yet: go straight to voicemail rather than
  // hanging up on a tenant.
  if (!numbers) {
    return twiml(`<Redirect>${base}/api/twilio/voice/voicemail</Redirect>`);
  }

  // Recording consent varies by state; two-party states require notice. This
  // announcement is one line and removes the question entirely.
  return twiml(
    `<Say voice="Polly.Joanna">Thanks for calling Larabee Homes. `
    + `This call may be recorded.</Say>`
    + `<Dial timeout="20" answerOnBridge="true" record="record-from-answer-dual"`
    + ` recordingStatusCallback="${base}/api/twilio/voice/recording"`
    + ` action="${base}/api/twilio/voice/after-dial">${numbers}</Dial>`
  );
}
