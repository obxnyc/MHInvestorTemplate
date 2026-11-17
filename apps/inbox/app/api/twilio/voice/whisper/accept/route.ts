import { NextResponse } from "next/server";
import { formToObject, checkTwilioSignature, publicBase } from "@/lib/twilio";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { twiml, say, loadPerson } from "@/lib/voice";
import { claim, stopRinging, moveCaller, callerStillThere, agentTwiml } from "@/lib/legs";
import { twilioClient } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pressing 1: this phone takes the call.
 *
 * In order, because each step depends on the one before:
 *   1. claim the round -- one conditional update, so two phones answering in
 *      the same second cannot both connect; the loser is told, politely
 *   2. make sure the caller is still there
 *   3. write down who took it, now, when it is certain
 *   4. stop every other phone still ringing
 *   5. bring the caller into the conference, and start recording their side
 *   6. put this phone in the conference too, with * to step out
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(
    req, `/api/twilio/voice/whisper/accept${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  // Only 1 accepts. Any other key is a pocket, or somebody who meant to
  // decline, and a call put through to a pocket is a caller talking to nobody.
  if (params.Digits !== "1") return twiml(say("Not accepted.") + "<Hangup/>");

  const base = publicBase(req);
  const callId = url.searchParams.get("c") ?? "";
  const round = Number(url.searchParams.get("n") ?? "0");
  const personId = url.searchParams.get("p") ?? "";
  const db = supabaseAdmin();

  if (!(await claim(callId, round))) {
    return twiml(say("Someone else has already answered this call.") + "<Hangup/>");
  }

  const { data: call } = await db.from("calls")
    .select("id, twilio_call_sid, answered_at, recording_on").eq("id", callId).single();
  if (!call?.twilio_call_sid || !(await callerStillThere(call.twilio_call_sid))) {
    await db.from("calls").update({ ended_at: new Date().toISOString(), missed: true }).eq("id", callId);
    await stopRinging(callId, round, params.CallSid);
    return twiml(say("Sorry, the caller hung up before you answered.") + "<Hangup/>");
  }

  const person = await loadPerson(personId);
  await db.from("calls").update({
    answered_person: person?.id ?? null,
    answered_by: person?.staffId ?? null,
    answered_at: new Date().toISOString(),
    agent_leg_sid: params.CallSid,
    ended_at: null,
    missed: false,
  }).eq("id", callId);

  await stopRinging(callId, round, params.CallSid);

  try {
    await moveCaller(call.twilio_call_sid, `${base}/api/twilio/voice/connect?c=${callId}`);
  } catch {
    return twiml(say("Sorry, the call could not be connected.") + "<Hangup/>");
  }

  // Recorded on the CALLER's leg, two channels: the caller on one, everybody
  // they speak to on the other -- so the transcript knows who said what, and
  // one recording covers the call through any number of transfers.
  if (!call.recording_on) {
    try {
      await twilioClient().calls(call.twilio_call_sid).recordings.create({
        recordingChannels: "dual",
        recordingStatusCallback: `${base}/api/twilio/voice/recording?k=call`,
        recordingStatusCallbackEvent: ["completed"],
      });
      await db.from("calls").update({ recording_on: true }).eq("id", callId);
    } catch (e) {
      console.error("recording did not start", e instanceof Error ? e.message : e);
    }
  }

  return twiml(agentTwiml(base, callId, personId));
}
