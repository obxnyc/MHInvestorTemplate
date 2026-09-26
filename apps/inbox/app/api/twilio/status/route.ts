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

  const db = supabaseAdmin();
  const patch = {
    status: toMsgStatus(params.MessageStatus),
    error_code: params.ErrorCode ?? null,
  };

  // Twilio reports "sent" within about a second of accepting a message, and
  // the sid only exists after the send call returns -- so the receipt can beat
  // its own row into the database. That race is why some messages reported
  // back and others sat on "Sending" forever: a callback arriving a moment too
  // early had nothing to update.
  //
  // So wait for it, briefly, rather than answering and hoping. The insert is
  // milliseconds behind the send, and a second and a half of patience here
  // catches essentially all of it -- well inside the fifteen Twilio allows.
  // The earlier version returned 503 to ask for a retry, which assumed a
  // redelivery policy we do not control and cannot see.
  const WAITS = [0, 250, 500, 750];
  for (const wait of WAITS) {
    if (wait) await new Promise((r) => setTimeout(r, wait));

    const { data, error } = await db.from("messages")
      .update(patch).eq("twilio_sid", params.MessageSid).select("id");

    if (error) {
      console.error("delivery status update failed", error);
      return new NextResponse("could not record status", { status: 500 });
    }
    if (data?.length) return new NextResponse(null, { status: 204 });
  }

  // Still nothing. Not an error -- a status for a message this deployment
  // never sent is a perfectly ordinary thing to receive, and answering 5xx to
  // it would put a red line in somebody's Twilio console for no reason.
  // Anything of ours that this was about gets settled by asking Twilio the
  // other way round, next time the thread is opened.
  console.warn("status for a message we do not have", params.MessageSid, patch.status);
  return new NextResponse(null, { status: 204 });
}
