import { NextResponse } from "next/server";
import { checkTwilioSignature, formToObject, publicBase } from "@/lib/twilio";
import { loadMenu, menuTwiml, twiml, say, PHRASE } from "@/lib/voice";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callBySid } from "@/lib/calllog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A key pressed at a menu.
 *
 * Nothing pressed is not a failure. People call from cars, from noisy yards,
 * and from handsets they cannot see. The menu repeats once, and then the call
 * goes to the fallback route -- a person, not a dial tone.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, `/api/twilio/voice/menu${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const base = publicBase(req);
  const key = url.searchParams.get("m") ?? "root";
  const attempt = Number(url.searchParams.get("a") ?? "1");
  const go = (route: string) =>
    twiml(`<Redirect method="POST">${base}/api/twilio/voice/go?r=${encodeURIComponent(route)}</Redirect>`);

  const menu = await loadMenu(key);
  if (!menu) return twiml(`<Redirect method="POST">${base}/api/twilio/voice/voicemail</Redirect>`);

  const pressed = (params.Digits ?? "").trim();
  const chosen = menu.options.find((o) => o.digit === pressed);

  if (chosen?.nextMenuKey) {
    // Choosing Spanish is remembered on the call -- so the voicemail, the
    // portal text and the person who answers all know -- and on the caller,
    // so the app's replies to them go out in Spanish too.
    if (chosen.nextMenuLang && chosen.nextMenuLang !== menu.lang) {
      const call = await callBySid(params.CallSid);
      if (call) {
        const db = supabaseAdmin();
        await db.from("calls").update({ language: chosen.nextMenuLang }).eq("id", call.id);
        if (call.contact_id && chosen.nextMenuLang !== "en") {
          await db.from("contacts").update({ language: chosen.nextMenuLang }).eq("id", call.contact_id);
        }
      }
    }
    const next = await loadMenu(chosen.nextMenuKey);
    if (next) return twiml(menuTwiml(next, base, 0));
  }
  if (chosen?.routeKey) return go(chosen.routeKey);
  if (chosen?.ringGroupId) {
    // A menu built before routes existed. Still rings, just without a category.
    return twiml(`<Redirect method="POST">${base}/api/twilio/voice/ring`
      + `?g=${chosen.ringGroupId}&amp;s=1</Redirect>`);
  }

  // Nothing pressed, or a key that is not on this menu. One more go, said the
  // same way -- re-reading the options is what fixes it for most people.
  if (attempt < 2) {
    const nudge = pressed ? PHRASE.nudge[menu.lang] : "";
    return twiml(menuTwiml(menu, base, attempt, nudge));
  }

  if (menu.fallbackRoute) return go(menu.fallbackRoute);
  if (menu.fallbackGroup) {
    return twiml(say(PHRASE.hold[menu.lang], menu.lang)
      + `<Redirect method="POST">${base}/api/twilio/voice/ring?g=${menu.fallbackGroup}&amp;s=1</Redirect>`);
  }
  return twiml(`<Redirect method="POST">${base}/api/twilio/voice/voicemail</Redirect>`);
}
