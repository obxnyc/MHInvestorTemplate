import { NextResponse } from "next/server";
import { formToObject, checkTwilioSignature, publicBase } from "@/lib/twilio";
import { twiml, say, loadRoute, escapeXml } from "@/lib/voice";
import { contactOf } from "@/lib/calllog";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the person answering hears when they pick up, before anything else.
 * The caller hears ringing throughout and none of this.
 *
 * It says what KIND of call it is -- "Maintenance call", "Seller call" -- and
 * who, when the number belongs to somebody we know. The phone already showed
 * the office number, so "this is work" was never the useful part.
 *
 * Pressing 1 both accepts the call and proves a human is on the line: a
 * phone that is off answers instantly with its owner's voicemail, and a
 * mailbox cannot press 1, so it can never take the call.
 *
 *   c  the call      p  the person      n  the round of ringing
 *   r  the route     t  a transfer
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  // The query string is part of what Twilio signed, so it is read back from
  // the request rather than rebuilt, and matches character for character.
  const sig = checkTwilioSignature(req, `/api/twilio/voice/whisper${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const callId = url.searchParams.get("c") ?? "";
  const routeKey = url.searchParams.get("r");
  const route = routeKey ? await loadRoute(routeKey) : null;
  const { data: call } = await supabaseAdmin().from("calls")
    .select("contact_id, language").eq("id", callId).maybeSingle();
  const contact = call ? await contactOf(call.contact_id) : null;

  const words = (url.searchParams.get("t") === "1" ? "Transferred. " : "")
    + (call?.language === "es" ? "Spanish speaker. " : "")
    + (route?.whisper ?? "Office call")
    + (contact?.full_name ? `, from ${contact.full_name}` : "") + ". Press 1.";

  // The action is the whole fix for an old loop: a Gather with no action posts
  // the digit back to the document it came from, and the whisper plays again.
  const q = new URLSearchParams();
  for (const k of ["c", "p", "n"]) q.set(k, url.searchParams.get(k) ?? "");
  const accept = `${publicBase(req)}/api/twilio/voice/whisper/accept?${escapeXml(q.toString())}`;

  return twiml(
    `<Gather numDigits="1" timeout="8" action="${accept}" method="POST">`
    + say(words) + `</Gather>`
    // Reached only when nothing was pressed: this phone declines, and the
    // caller stays with whoever else is ringing.
    + `<Hangup/>`
  );
}
