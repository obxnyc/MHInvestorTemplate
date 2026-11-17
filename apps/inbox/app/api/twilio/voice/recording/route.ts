import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkTwilioSignature, formToObject } from "@/lib/twilio";
import { callBySid } from "@/lib/calllog";
import { startTranscript } from "@/lib/transcribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A recording has finished.
 *
 *   k=call       a conversation, dual-channel: the caller on one side and us
 *                on the other, which is what lets the transcript say who
 *                said what
 *   k=voicemail  a message left after the beep
 *
 * A call can make more than one -- a transfer starts a second -- so they are
 * rows of their own rather than one column that the second overwrites.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, `/api/twilio/voice/recording${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  if (params.RecordingStatus && params.RecordingStatus !== "completed") {
    return new NextResponse(null, { status: 204 });
  }

  const kind = url.searchParams.get("k") === "voicemail" ? "voicemail" : "call";
  const call = await callBySid(params.CallSid);
  if (!call || !params.RecordingSid) return new NextResponse(null, { status: 204 });

  const db = supabaseAdmin();
  const duration = params.RecordingDuration ? parseInt(params.RecordingDuration, 10) : null;

  const { data: rec } = await db.from("call_recordings").upsert({
    call_id: call.id,
    recording_sid: params.RecordingSid,
    kind,
    duration_seconds: duration,
  }, { onConflict: "recording_sid" }).select("id").single();

  // Kept for anything still reading the old single column.
  await db.from("calls").update({
    recording_sid: params.RecordingSid,
    recording_url: params.RecordingUrl,
    ...(kind === "call" && duration ? { duration_seconds: duration } : {}),
  }).eq("id", call.id);

  // Voicemails are transcribed by <Record transcribe>, which arrives at
  // /transcription. Conversations are transcribed here.
  if (rec && kind === "call" && (duration ?? 0) >= 5) {
    await startTranscript(rec.id, params.RecordingSid);
  }

  return new NextResponse(null, { status: 204 });
}
