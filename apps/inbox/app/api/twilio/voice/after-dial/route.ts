import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTwilioSignature, formToObject } from "@/lib/twilio";
import { twiml } from "@/lib/voice";
import { pushToTeam } from "@/lib/push";
import { prettyPhone } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fires when the <Dial> ends. This is where "who answered" gets recorded: the
 * winning leg's URL carried the staff id, and DialCallStatus tells us whether
 * anyone picked up at all.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = formToObject(raw);
  const base = process.env.PUBLIC_BASE_URL;
  if (!verifyTwilioSignature(req.headers.get("x-twilio-signature"), `${base}/api/twilio/voice/after-dial`, params)) {
    return new NextResponse("invalid signature", { status: 403 });
  }

  const db = supabaseAdmin();
  const status = params.DialCallStatus;          // completed | no-answer | busy | failed
  const answered = status === "completed";

  // Twilio does not hand back the winning <Number>'s URL params, so resolve
  // the answerer by the number it bridged to.
  let answeredBy: string | null = null;
  if (answered && params.DialCallSid) {
    const { data } = await db.from("staff")
      .select("id").eq("forward_to", params.To ?? "").maybeSingle();
    answeredBy = data?.id ?? null;
  }

  const { data: call } = await db.from("calls")
    .update({
      answered_by: answeredBy,
      missed: !answered,
      duration_seconds: params.DialCallDuration ? parseInt(params.DialCallDuration, 10) : null,
    })
    .eq("twilio_call_sid", params.CallSid)
    .select("id, contact_id, conversation_id")
    .maybeSingle();

  if (answered) return twiml("<Hangup/>");

  // Nobody picked up. Tell the team now -- before the voicemail even finishes
  // recording -- and send the caller to voicemail.
  if (call) {
    const { data: contact } = await db.from("contacts")
      .select("phone, full_name").eq("id", call.contact_id!).maybeSingle();
    const who = contact?.full_name || prettyPhone(contact?.phone ?? "");
    await pushToTeam(null, {
      title: `Missed call — ${who}`,
      body: "Nobody picked up. Voicemail may follow.",
      url: "/calls",
      tag: `missed:${call.id}`,
      urgent: true,
    });
  }

  return twiml(`<Redirect>${base}/api/twilio/voice/voicemail</Redirect>`);
}
