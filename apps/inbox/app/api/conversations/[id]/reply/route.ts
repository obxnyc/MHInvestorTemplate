import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { twilioClient, publicBase, toMsgStatus } from "@/lib/twilio";
import { fromEnglish } from "@/lib/translate";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Attribution comes from the session, never from the request body. A client
  // that could name its own author would make the audit trail worthless.
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { body } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: "empty message" }, { status: 400 });

  const supabase = await supabaseServer();
  // Reading through the user's client means RLS decides whether they may see
  // this thread at all -- authorization we get for free rather than re-check.
  const { data: convo } = await supabase
    .from("conversations").select("id, contact_id, contacts(phone, language)").eq("id", id).single();
  if (!convo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const person = convo.contacts as unknown as { phone: string; language: string | null };
  const to = person.phone;

  // Sent in the language they read. The English stays as what was typed, and
  // the wire body is what they actually received -- so the thread shows both
  // and neither is a reconstruction.
  //
  // A failed translation falls back to English rather than silently not
  // sending. A worse message that arrives beats a perfect one that does not.
  const translated = person.language && person.language !== "en"
    ? await fromEnglish(body, person.language)
    : null;
  const wire = translated ?? body;

  let sid: string | null = null;
  let status = "queued";
  try {
    const sent = await twilioClient().messages.create({
      to,
      body: wire,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      statusCallback: `${publicBase(req)}/api/twilio/status`,
    });
    sid = sent.sid;
    status = toMsgStatus(sent.status);
  } catch (e) {
    // Record the attempt anyway. A message that failed to send is exactly the
    // thing the next person needs to see when they pick up the thread.
    status = "failed";
    console.error("twilio send failed", e);
  }

  const db = supabaseAdmin();
  const { error: writeError } = await db.from("messages").insert({
    conversation_id: id,
    direction: "outbound",
    body: wire,
    body_en: translated ? body : null,
    lang: translated ? person.language : null,
    twilio_sid: sid,
    status,
    sent_by: staff.id,
  });
  // Checked, and loudly. This insert failed silently for a day: the text went
  // out, the preview below updated because it is a separate statement, and the
  // thread showed the tenant's half of the conversation and none of ours.
  if (writeError) {
    console.error("reply written to the carrier but not to the thread", writeError);
    return NextResponse.json({
      ok: false, status: "unrecorded",
      error: "It went out, but we couldn't write it to the thread. Tell somebody —"
        + " the tenant has it and the record does not.",
    }, { status: 500 });
  }

  await db.from("conversations")
    .update({ last_message_at: new Date().toISOString(),
              last_message_preview: body.slice(0, 160) })
    .eq("id", id);

  return NextResponse.json({
    ok: status !== "failed", status,
    translatedInto: translated ? person.language : null,
  });
}
