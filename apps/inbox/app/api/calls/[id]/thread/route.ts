import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { callBySid, threadFor } from "@/lib/calllog";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/** Text back: the caller's thread, opened if there is none, so the reply is
 *  written with everything they have said above the box -- and goes out from
 *  the office line, not anybody's own phone. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;

  const { data } = await supabaseAdmin().from("calls")
    .select("twilio_call_sid, category").eq("id", id).maybeSingle();
  const call = await callBySid(data?.twilio_call_sid);
  if (!call) return NextResponse.json({ error: "no such call" }, { status: 404 });

  const thread = await threadFor(call, `Call: ${data?.category ?? "office line"}`);
  if (!thread) return NextResponse.json({ error: "This caller's number was withheld, so there is nobody to text." }, { status: 400 });
  return NextResponse.json({ ok: true, conversationId: thread });
}
