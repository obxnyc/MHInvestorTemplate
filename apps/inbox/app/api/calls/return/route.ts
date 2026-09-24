import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/** Records that this person is returning a specific missed call. Written before
 *  the dialer opens, so the trail exists even if the callback goes unanswered
 *  or the tab is closed. */
export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { callId } = await req.json();
  const db = supabaseAdmin();

  const { data: missed } = await db.from("calls")
    .select("contact_id, conversation_id").eq("id", callId).single();
  if (!missed) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error } = await db.from("calls").insert({
    contact_id: missed.contact_id,
    conversation_id: missed.conversation_id,
    direction: "outbound",
    initiated_by: staff.id,
    returns_call_id: callId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
