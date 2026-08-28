import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTwilioSignature, formToObject } from "@/lib/twilio";
import { pushToTeam } from "@/lib/push";
import { prettyPhone } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Voicemail transcript. Also drops the text into the caller's conversation
 * thread, so the voicemail sits in the same timeline as their texts rather
 * than in a separate place nobody checks.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = formToObject(raw);
  const base = process.env.PUBLIC_BASE_URL;
  if (!verifyTwilioSignature(req.headers.get("x-twilio-signature"), `${base}/api/twilio/voice/transcription`, params)) {
    return new NextResponse("invalid signature", { status: 403 });
  }

  const db = supabaseAdmin();
  const text = params.TranscriptionStatus === "completed"
    ? params.TranscriptionText
    : "(voicemail could not be transcribed — play the recording)";

  const { data: call } = await db.from("calls")
    .update({ voicemail_text: text })
    .eq("twilio_call_sid", params.CallSid)
    .select("id, contact_id, conversation_id")
    .maybeSingle();
  if (!call) return new NextResponse(null, { status: 204 });

  const { data: contact } = await db.from("contacts")
    .select("phone, full_name").eq("id", call.contact_id!).maybeSingle();

  // Attach the voicemail to their open thread, opening one if needed.
  let conversationId = call.conversation_id;
  if (!conversationId) {
    const { data: existing } = await db.from("conversations")
      .select("id").eq("contact_id", call.contact_id!).neq("status", "closed").maybeSingle();
    if (existing) conversationId = existing.id;
    else {
      const { data } = await db.from("conversations").insert({
        contact_id: call.contact_id,
        category: "other",
        source: "call",
        subject: `Voicemail: ${(text ?? "").slice(0, 60)}`,
      }).select("id").single();
      conversationId = data!.id;
    }
    await db.from("calls").update({ conversation_id: conversationId }).eq("id", call.id);
  }

  await db.from("messages").insert({
    conversation_id: conversationId,
    direction: "inbound",
    channel: "voicemail",
    body: `Voicemail: ${text}`,
    external_id: `vm:${params.TranscriptionSid ?? params.CallSid}`,
    status: "received",
  });
  await db.from("conversations")
    .update({ last_message_at: new Date().toISOString(), status: "open",
              last_message_preview: `Voicemail: ${(text ?? "").slice(0, 150)}` })
    .eq("id", conversationId);

  const who = contact?.full_name || prettyPhone(contact?.phone ?? "");
  await pushToTeam(null, {
    title: `Voicemail — ${who}`,
    body: (text ?? "").slice(0, 140),
    url: `/c/${conversationId}`,
    tag: `vm:${call.id}`,
  });

  return new NextResponse(null, { status: 204 });
}
