import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSms } from "@/lib/notify";

export const runtime = "nodejs";

/**
 * Send one message to every active employee.
 *
 * Fans out as individual messages into each person's own conversation rather
 * than a group thread, so a reply comes back as an ordinary conversation
 * somebody can claim and answer. A group thread would have no owner and no
 * way to moderate it.
 */
export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (staff.role !== "admin" && staff.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { body } = await req.json().catch(() => ({}));
  if (!body?.trim()) return NextResponse.json({ error: "empty message" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: recipients } = await db.from("staff")
    .select("id, full_name, forward_to")
    .eq("active", true)
    .neq("id", staff.id)          // no need to text yourself
    .not("forward_to", "is", null);

  if (!recipients?.length) {
    return NextResponse.json({ error: "no staff have a mobile number on file" }, { status: 400 });
  }

  const { data: broadcast } = await db.from("broadcasts").insert({
    sent_by: staff.id, body, recipients: recipients.length,
  }).select("id").single();

  const { data: team } = await db.from("teams").select("id").eq("key", "staff").maybeSingle();
  let delivered = 0;

  await Promise.all(recipients.map(async (r) => {
    // Each employee is a contact in their own right, so the thread behaves
    // like any other conversation.
    let { data: contact } = await db.from("contacts")
      .select("id").eq("phone", r.forward_to!).maybeSingle();
    if (!contact) {
      const { data } = await db.from("contacts").insert({
        phone: r.forward_to, full_name: r.full_name, party: "tech",
      }).select("id").single();
      contact = data!;
    }

    let { data: convo } = await db.from("conversations")
      .select("id").eq("contact_id", contact.id).neq("status", "closed").maybeSingle();
    if (!convo) {
      const { data } = await db.from("conversations").insert({
        contact_id: contact.id, category: "other", team_id: team?.id ?? null,
        source: "sms", subject: body.slice(0, 70),
      }).select("id").single();
      convo = data!;
    }

    const sid = await sendSms(r.forward_to!, body);
    if (sid) delivered++;

    await db.from("messages").insert({
      conversation_id: convo.id, direction: "outbound", channel: "sms",
      body, twilio_sid: sid, status: sid ? "queued" : "failed", sent_by: staff.id,
    });
    await db.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: body.slice(0, 160),
    }).eq("id", convo.id);
  }));

  await db.from("broadcasts").update({ delivered }).eq("id", broadcast!.id);
  return NextResponse.json({ ok: true, recipients: recipients.length, delivered });
}
