import { NextResponse } from "next/server";
import { checkTwilioSignature, formToObject, publicBase } from "@/lib/twilio";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { twilioClient } from "@/lib/twilio";
import { twiml, say, escapeXml } from "@/lib/voice";
import { moveCaller, callerStillThere } from "@/lib/legs";
import { transferMenu } from "@/lib/transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The answerer's phone has left the conversation. Three ways that happens,
 * told apart here because Twilio asks the same question for all three:
 *
 *   they hung up         -- the call is over: hang up the caller too
 *   the caller hung up   -- the conference ended under them: say so
 *   they pressed *       -- put the caller on hold and ask where to send them
 *
 * A phone that is no longer the call's answerer -- somebody transferred the
 * call from the Calls page or by text -- is simply let go.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, `/api/twilio/voice/staff-menu${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const base = publicBase(req);
  const callId = url.searchParams.get("c") ?? "";
  const db = supabaseAdmin();
  const { data: call } = await db.from("calls")
    .select("id, twilio_call_sid, agent_leg_sid").eq("id", callId).maybeSingle();
  if (!call?.twilio_call_sid) return twiml("<Hangup/>");

  if (call.agent_leg_sid !== params.CallSid) {
    return twiml(say("Transferred. Goodbye.") + "<Hangup/>");
  }

  const ended = () => db.from("calls")
    .update({ ended_at: new Date().toISOString(), agent_leg_sid: null }).eq("id", callId);

  if (params.CallStatus === "completed") {
    await ended();
    try {
      await twilioClient().calls(call.twilio_call_sid)
        .update({ twiml: "<Response><Hangup/></Response>" });
    } catch { /* the caller had already gone */ }
    return twiml("");
  }

  if (!(await callerStillThere(call.twilio_call_sid))) {
    await ended();
    return twiml(say("The caller has hung up.") + "<Hangup/>");
  }

  // Pressed *.
  try {
    await moveCaller(call.twilio_call_sid, `${base}/api/twilio/voice/hold?c=${callId}`);
  } catch {
    await ended();
    return twiml(say("The caller has hung up.") + "<Hangup/>");
  }

  const q = escapeXml(new URLSearchParams({ c: callId, p: url.searchParams.get("p") ?? "" }).toString());
  return twiml(
    `<Gather numDigits="1" timeout="10" action="${base}/api/twilio/voice/staff-pick?${q}"`
    + ` method="POST" actionOnEmptyResult="true">`
    + say(await transferMenu()) + `</Gather>`
  );
}
