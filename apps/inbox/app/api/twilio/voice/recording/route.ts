import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTwilioSignature, formToObject } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recordings are dual-channel by default now — each party on its own channel,
 *  at the same price as mono — which is what you want if a recording ever has
 *  to settle a dispute about who said what. */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = formToObject(raw);
  const base = process.env.PUBLIC_BASE_URL;
  if (!verifyTwilioSignature(req.headers.get("x-twilio-signature"), `${base}/api/twilio/voice/recording`, params)) {
    return new NextResponse("invalid signature", { status: 403 });
  }

  await supabaseAdmin().from("calls").update({
    recording_sid: params.RecordingSid,
    recording_url: params.RecordingUrl,
    duration_seconds: params.RecordingDuration ? parseInt(params.RecordingDuration, 10) : null,
  }).eq("twilio_call_sid", params.CallSid);

  return new NextResponse(null, { status: 204 });
}
