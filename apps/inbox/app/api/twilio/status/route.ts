import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkTwilioSignature, formToObject } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delivery receipts. Without these the portal shows "sent" for a message the
 *  carrier silently dropped, which is how a filtered A2P campaign hides. */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, "/api/twilio/status", params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  await supabaseAdmin().from("messages")
    .update({ status: params.MessageStatus, error_code: params.ErrorCode ?? null })
    .eq("twilio_sid", params.MessageSid);

  return new NextResponse(null, { status: 204 });
}
