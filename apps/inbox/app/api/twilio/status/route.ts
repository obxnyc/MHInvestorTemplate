import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkTwilioSignature, formToObject, toMsgStatus } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delivery receipts. Without these the portal shows "sent" for a message the
 *  carrier silently dropped, which is how a filtered A2P campaign hides. */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, "/api/twilio/status", params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const { data, error } = await supabaseAdmin().from("messages")
    .update({ status: toMsgStatus(params.MessageStatus), error_code: params.ErrorCode ?? null })
    .eq("twilio_sid", params.MessageSid)
    .select("id");

  if (error) {
    console.error("delivery status update failed", error);
    return new NextResponse("could not record status", { status: 500 });
  }

  // Nothing matched. Twilio reports "sent" within about a second of accepting a
  // message, which can beat our own row into the database -- the sid only
  // exists after the send returns, and the insert happens after that. Answering
  // 2xx here would mean the receipt is thrown away and the message reads
  // "Sending" forever, which is exactly the lie this endpoint exists to
  // prevent. A 503 asks Twilio to try again, and it does, with backoff.
  if (!data?.length) {
    console.warn("status for an unknown message, asking Twilio to retry", params.MessageSid);
    return new NextResponse("no such message yet", { status: 503 });
  }

  return new NextResponse(null, { status: 204 });
}
