import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkTwilioSignature, formToObject, publicBase } from "@/lib/twilio";
import { loadRoute, routeNow, twiml, say, callSettings, inLang, asLang, PHRASE } from "@/lib/voice";
import { isOpen } from "@/lib/hours";
import { callBySid, noAnswer, textCaller, tellAfterHours, fill } from "@/lib/calllog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The end of a menu: the caller has said what the call is about.
 *
 * The call is filed under that category here, before anything rings, so a
 * caller who hangs up during the ringing is still on the Calls page as a
 * maintenance call rather than as a number. Then the route says what happens
 * at this hour: ring a group, text the resident portal, or take a message.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, `/api/twilio/voice/go${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const base = publicBase(req);
  const voicemail = (k = "") =>
    twiml(`<Redirect method="POST">${base}/api/twilio/voice/voicemail${k ? `?k=${k}` : ""}</Redirect>`);

  const route = await loadRoute(url.searchParams.get("r") ?? "general");
  if (!route) return voicemail();

  const s = await callSettings();
  let call = await callBySid(params.CallSid);
  // Hours were decided when the call came in. A caller who rings at 5:59 and
  // is still in the menu at 6:00 gets what 5:59 promised them.
  const open = call?.after_hours != null ? !call.after_hours : isOpen(s);
  const { action, group } = routeNow(route, open);
  const lang = asLang(call?.language);

  if (call) {
    await supabaseAdmin().from("calls")
      .update({ category: route.category, route_key: route.key })
      .eq("id", call.id);
    call = { ...call, category: route.category, route_key: route.key };
    if (!open) await tellAfterHours(call, s, route.category);
  }

  if (action === "ring" && group) {
    return twiml(say(PHRASE.hold[lang], lang)
      + `<Redirect method="POST">${base}/api/twilio/voice/ring`
      + `?g=${group}&amp;s=1&amp;r=${encodeURIComponent(route.key)}</Redirect>`);
  }

  if (action === "portal") {
    // Sent BEFORE it is announced: the caller is told a text is on its way
    // only if one went. A landline, or no link on file, gets a message box.
    const sent = call && s.portal_url
      ? await textCaller(call, fill(inLang(s, "portal_text", lang), s.portal_url), "portal")
      : false;
    if (sent) {
      await supabaseAdmin().from("calls").update({ missed: false }).eq("id", call!.id);
      return twiml(say(inLang(s, "portal_prompt", lang), lang) + "<Hangup/>");
    }
    if (call) await noAnswer(call, s);
    return voicemail();
  }

  if (action === "leasing_voicemail") {
    let texted = false;
    if (call && s.homes_url) {
      texted = await textCaller(call, fill(s.homes_text, s.homes_url), "homes");
      if (texted) call = { ...call, texted: "homes" };
    }
    if (call) await noAnswer(call, s);
    return voicemail(texted ? "leasing-texted" : "leasing");
  }

  // "voicemail", or a ring with nobody to ring.
  if (call) await noAnswer(call, s);
  return voicemail();
}
