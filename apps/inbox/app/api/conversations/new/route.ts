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
 */
export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { to, body } = await req.json().catch(() => ({}));
  if (!to?.trim() || !body?.trim()) {
    return NextResponse.json({ error: "need a number and a message" }, { status: 400 });
  }

  const phone = toE164(String(to));
  if (!/^\+\d{11,15}$/.test(phone)) {
    return NextResponse.json({ error: "that doesn't look like a mobile number" }, { status: 400 });
  }

  const db = supabaseAdmin();
  let { data: contact } = await db.from("contacts")
    .select("id").eq("phone", phone).maybeSingle();
  if (!contact) {
    const { data } = await db.from("contacts")
      .insert({ phone, party: "other" }).select("id").single();
    contact = data!;
  }

  // Reuse their open thread if they have one, so this never forks a second
  // conversation with the same person.
  let { data: convo } = await db.from("conversations")
    .select("id").eq("contact_id", contact.id).neq("status", "closed").maybeSingle();
  if (!convo) {
    const { data } = await db.from("conversations").insert({
      contact_id: contact.id, category: "other", source: "sms",
      subject: body.slice(0, 70), assigned_to: staff.id, claimed_at: new Date().toISOString(),
    }).select("id").single();
    convo = data!;
  }

  const sid = await sendSms(phone, body);
  await db.from("messages").insert({
    conversation_id: convo.id, direction: "outbound", channel: "sms",
    body, twilio_sid: sid, status: sid ? "queued" : "failed", sent_by: staff.id,
  });
  await db.from("conversations").update({
    last_message_at: new Date().toISOString(),
    last_message_preview: body.slice(0, 160),
  }).eq("id", convo.id);

  return NextResponse.json({ ok: true, conversationId: convo.id, sent: !!sid });
}
