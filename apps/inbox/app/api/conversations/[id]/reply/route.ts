import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { twilioClient } from "@/lib/twilio";

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
    .from("conversations").select("id, contact_id, contacts(phone)").eq("id", id).single();
  if (!convo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const to = (convo.contacts as unknown as { phone: string }).phone;

  let sid: string | null = null;
  let status = "queued";
  try {
    const sent = await twilioClient().messages.create({
      to,
      body,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      statusCallback: `${process.env.PUBLIC_BASE_URL}/api/twilio/status`,
    });
    sid = sent.sid;
    status = sent.status ?? "queued";
  } catch (e) {
    // Record the attempt anyway. A message that failed to send is exactly the
    // thing the next person needs to see when they pick up the thread.
    status = "failed";
    console.error("twilio send failed", e);
  }

  const db = supabaseAdmin();
  await db.from("messages").insert({
    conversation_id: id,
    direction: "outbound",
    body,
    twilio_sid: sid,
    status,
    sent_by: staff.id,
  });
  await db.from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: status !== "failed", status });
}
