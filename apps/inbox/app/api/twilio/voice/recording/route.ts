import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkTwilioSignature, formToObject } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recordings are dual-channel by default now — each party on its own channel,
 *  at the same price as mono — which is what you want if a recording ever has
 *  to settle a dispute about who said what. */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, "/api/twilio/voice/recording", params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  await supabaseAdmin().from("calls").update({
    recording_sid: params.RecordingSid,
    recording_url: params.RecordingUrl,
    duration_seconds: params.RecordingDuration ? parseInt(params.RecordingDuration, 10) : null,
  }).eq("twilio_call_sid", params.CallSid);

  return new NextResponse(null, { status: 204 });
}
