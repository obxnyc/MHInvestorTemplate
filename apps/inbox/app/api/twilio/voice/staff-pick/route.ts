import { NextResponse } from "next/server";
import { checkTwilioSignature, formToObject, publicBase } from "@/lib/twilio";
import { twiml, say } from "@/lib/voice";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { moveCaller, agentTwiml } from "@/lib/legs";
import { transferCall, transferKey } from "@/lib/transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The key pressed after *. A name on the list: the caller is transferred and
 * this phone is let go. 0, nothing, or a key that is not on the list: back to
 * the caller -- a fumbled keypress must never strand somebody on hold.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, `/api/twilio/voice/staff-pick${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const base = publicBase(req);
  const callId = url.searchParams.get("c") ?? "";
  const me = url.searchParams.get("p") ?? "";
  const { data: call } = await supabaseAdmin().from("calls")
    .select("twilio_call_sid").eq("id", callId).maybeSingle();
  if (!call?.twilio_call_sid) return twiml("<Hangup/>");

  const back = async (lead: string) => {
    try { await moveCaller(call.twilio_call_sid!, `${base}/api/twilio/voice/connect?c=${callId}`); }
    catch { return twiml(say("The caller has hung up.") + "<Hangup/>"); }
    return twiml((lead ? say(lead) : "") + agentTwiml(base, callId, me));
  };

  const key = await transferKey((params.Digits ?? "").trim());
  if (!key || ("personId" in key.target && key.target.personId === me)) {
    return back(params.Digits && params.Digits !== "0" ? "That key is not on the list. Back to the caller." : "");
  }

  const out = await transferCall(callId, key.target, new URL(req.url).origin);
  if (!out.ok) return back(`That transfer did not go through. ${out.error} Back to the caller.`);
  return twiml(say(`Transferring to ${key.label}. You can hang up now.`) + "<Hangup/>");
}
