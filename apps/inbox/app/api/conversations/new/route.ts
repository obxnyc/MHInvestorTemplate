import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { toE164 } from "@/lib/twilio";
import { sendSms } from "@/lib/notify";

export const runtime = "nodejs";

/**
 * Start a conversation with a number nobody has texted yet.
 *
 * It opens in the shared list like everything else — there is no private side
 * channel, which is the point of running one number.
 *
 * With no `body`, it opens the thread and sends nothing. That is what picking
 * somebody from the New Message list does: you land in their thread and write
 * there, with their history above the box, rather than composing blind into a
 * dialog. `contactId` picks somebody already on file; `to` is a bare number.
 */
export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { to, body, contactId } = await req.json().catch(() => ({}));
  const text = typeof body === "string" ? body.trim() : "";
  if (!to?.trim() && !contactId) {
    return NextResponse.json({ error: "need somebody to send to" }, { status: 400 });
  }

  const db = supabaseAdmin();
  let contact: { id: string } | null = null;

  if (contactId) {
    const { data } = await db.from("contacts")
      .select("id").eq("id", String(contactId)).maybeSingle();
    if (!data) return NextResponse.json({ error: "no such contact" }, { status: 400 });
    contact = data;
  } else {
    const phone = toE164(String(to));
    if (!/^\+\d{11,15}$/.test(phone)) {
      return NextResponse.json({ error: "that doesn't look like a mobile number" }, { status: 400 });
    }
    const { data: found } = await db.from("contacts")
      .select("id").eq("phone", phone).maybeSingle();
    contact = found ?? (await db.from("contacts")
      .insert({ phone, party: "other" }).select("id").single()).data!;
  }

  // Reuse their open thread if they have one, so this never forks a second
  // conversation with the same person.
  let { data: convo } = await db.from("conversations")
    .select("id").eq("contact_id", contact.id).neq("status", "closed").maybeSingle();
  if (!convo) {
    const { data } = await db.from("conversations").insert({
      contact_id: contact.id, category: "other", source: "sms",
      subject: text.slice(0, 70) || null,
      assigned_to: staff.id, claimed_at: new Date().toISOString(),
    }).select("id").single();
    convo = data!;
  }

  // Opened, not sent. Nothing has gone out, so the thread must not be dressed
  // up as though something had: no message row, no preview, and its place in
  // the list is still whenever it last actually saw traffic.
  if (!text) return NextResponse.json({ ok: true, conversationId: convo.id, sent: false });

  const { data: who } = await db.from("contacts")
    .select("phone").eq("id", contact.id).single();

  const sid = await sendSms(who!.phone, text);
  await db.from("messages").insert({
    conversation_id: convo.id, direction: "outbound", channel: "sms",
    body: text, twilio_sid: sid, status: sid ? "queued" : "failed", sent_by: staff.id,
  });
  await db.from("conversations").update({
    last_message_at: new Date().toISOString(),
    last_message_preview: text.slice(0, 160),
  }).eq("id", convo.id);

  return NextResponse.json({ ok: true, conversationId: convo.id, sent: !!sid });
}
