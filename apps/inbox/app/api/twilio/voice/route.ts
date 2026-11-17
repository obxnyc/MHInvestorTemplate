import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkTwilioSignature, formToObject, toE164, publicBase } from "@/lib/twilio";
import { loadMenu, menuTwiml, twiml, say, callSettings } from "@/lib/voice";
import { isOpen } from "@/lib/hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An inbound call to the office line.
 *
 * The call is logged, office hours are asked once, and the caller hears the
 * greeting for this time of day and then the menu -- which lives in the
 * database, along with everything after it.
 *
 * The greeting is said INSIDE the menu's Gather, so a regular caller who knows
 * that 2 then 1 is maintenance can press through it instead of sitting out the
 * whole speech every time.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = formToObject(raw);
  const base = publicBase(req);
  const sig = checkTwilioSignature(req, "/api/twilio/voice", params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const from = toE164(params.From ?? "");
  const db = supabaseAdmin();
  const s = await callSettings();
  const open = isOpen(s);

  let { data: contact } = await db.from("contacts").select("id").eq("phone", from).maybeSingle();
  if (!contact && from) {
    const { data } = await db.from("contacts")
      .insert({ phone: from, party: "other" }).select("id").single();
    contact = data;
  }

  // Twilio retries a webhook it did not hear back from, and a second row for
  // one phone call would make every count on the Calls page wrong.
  const { data: seen } = await db.from("calls").select("id")
    .eq("twilio_call_sid", params.CallSid).maybeSingle();
  if (!seen) {
    await db.from("calls").insert({
      contact_id: contact?.id ?? null,
      direction: "inbound",
      twilio_call_sid: params.CallSid,
      after_hours: !open,
      // The office number that was rung. Every phone the office answers on
      // is called FROM it, so they see it is work before they say a word.
      line: toE164(params.To ?? "") || null,
    });
  }

  const greeting = open ? s.day_greeting : s.night_greeting;
  const menu = await loadMenu("root");
  // No menu built yet: voicemail rather than silence. Silence on a business
  // line is worse than a machine.
  if (!menu) {
    return twiml(say(greeting) + `<Redirect method="POST">${base}/api/twilio/voice/voicemail</Redirect>`);
  }
  return twiml(menuTwiml(menu, base, 0, greeting));
}
