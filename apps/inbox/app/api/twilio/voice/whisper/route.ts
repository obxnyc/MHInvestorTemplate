import { NextResponse } from "next/server";
import { formToObject, checkTwilioSignature, publicBase } from "@/lib/twilio";
import { twiml, say, loadRoute, escapeXml } from "@/lib/voice";
import { callBySid, contactOf } from "@/lib/calllog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Played to the person answering, before the call bridges. The caller hears
 * ringing throughout and none of this.
 *
 * It says what KIND of call it is -- "Maintenance call", "Seller call" -- and
 * who, when the number belongs to somebody we know. The phone already showed
 * the office number, so "this is work" was never the useful part; "this is
 * a resident with a leak" is.
 *
 * Pressing 1 both accepts the call and proves a human is on the line.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  // The query string is part of what Twilio signed, so it is read back from
  // the request rather than rebuilt, and matches character for character.
  const sig = checkTwilioSignature(req, `/api/twilio/voice/whisper${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const routeKey = url.searchParams.get("r");
  const route = routeKey ? await loadRoute(routeKey) : null;
  const call = await callBySid(params.ParentCallSid);
  const contact = call ? await contactOf(call.contact_id) : null;

  const kind = route?.whisper ?? "Office call";
  const words = (url.searchParams.get("t") === "1" ? "Transferred. " : "")
    + (call?.language === "es" ? "Spanish speaker. " : "")
    + kind + (contact?.full_name ? `, from ${contact.full_name}` : "") + ". Press 1.";

  // The action is the whole fix for an old loop: a Gather with no action posts
  // the digit back to the document it came from, and the whisper plays again.
  const accept = `${publicBase(req)}/api/twilio/voice/whisper/accept`
    + `?${escapeXml(new URLSearchParams({ p: url.searchParams.get("p") ?? "" }).toString())}`;

  return twiml(
    `<Gather numDigits="1" timeout="8" action="${accept}" method="POST">`
    + say(words) + `</Gather>`
    // Reached only when nothing was pressed: this phone declines, and the
    // caller stays with whoever else is ringing.
    + `<Hangup/>`
  );
}
