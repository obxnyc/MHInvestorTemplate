import { NextResponse } from "next/server";
import { checkTwilioSignature, formToObject } from "@/lib/twilio";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { twiml } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's side of the conversation has ended. When it was the caller
 *  who hung up, the call is over; the answerer's phone hears so from
 *  staff-menu, because the conference ended under it. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, `/api/twilio/voice/caller-left${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });
  if (params.CallStatus === "completed") {
    await supabaseAdmin().from("calls").update({ ended_at: new Date().toISOString() })
      .eq("id", url.searchParams.get("c") ?? "").is("ended_at", null);
  }
  return twiml("<Hangup/>");
}
