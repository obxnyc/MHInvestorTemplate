import { NextResponse } from "next/server";
import { formToObject, checkTwilioSignature } from "@/lib/twilio";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { twiml, say, loadPerson, personByPhone } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The keypress that accepts a call -- and the one moment anybody knows for
 * certain who took it.
 *
 * A whisper ends when its TwiML runs out and the leg is then bridged, so
 * "accept" is an EMPTY response. Anything else keeps the whisper going.
 *
 * Who answered is written here rather than after the call. The old way read it
 * back from the Dial's `To`, which is the office number on every call, so it
 * never matched anybody.
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
  if (params.Digits !== "1") return twiml(say("Not accepted.") + "<Hangup/>");

  const pid = url.searchParams.get("p");
  const person = (pid ? await loadPerson(pid) : null) ?? await personByPhone(params.To ?? "");

  if (params.ParentCallSid) {
    await supabaseAdmin().from("calls").update({
      answered_person: person?.id ?? null,
      answered_by: person?.staffId ?? null,
      answered_at: new Date().toISOString(),
      ended_at: null,
      missed: false,
    }).eq("twilio_call_sid", params.ParentCallSid);
  }

  return twiml("");
}
