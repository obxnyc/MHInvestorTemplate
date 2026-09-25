import { NextResponse } from "next/server";
import { checkTwilioSignature, formToObject, publicBase } from "@/lib/twilio";
import { loadMenu, menuTwiml, twiml } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A key pressed at a menu.
 *
 * Nothing pressed is not a failure. People call from cars, from noisy yards,
 * and from handsets they cannot see. The menu repeats once, and then the call
 * goes to the fallback group -- ringing somebody beats hanging up on a person
 * who could not work the keypad, and the second reading is where most of them
 * manage it.
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

  const menu = await loadMenu(key);
  if (!menu) return twiml(`<Redirect>${base}/api/twilio/voice/voicemail</Redirect>`);

  const pressed = (params.Digits ?? "").trim();
  const chosen = menu.options.find((o) => o.digit === pressed);

  if (chosen?.nextMenuKey) {
    const next = await loadMenu(chosen.nextMenuKey);
    if (next) return twiml(menuTwiml(next, base, 0));
  }
  if (chosen?.ringGroupId) {
    return twiml(
      `<Redirect>${base}/api/twilio/voice/ring`
      + `?g=${chosen.ringGroupId}&amp;s=1</Redirect>`);
  }

  // Nothing pressed, or a key that is not on this menu. One more go, said the
  // same way -- re-reading the options is what fixes it for most people.
  if (attempt < 2) {
    const nudge = pressed
      ? `<Say voice="Polly.Joanna">Sorry, that isn't one of the options.</Say>`
      : "";
    return twiml(nudge + menuTwiml(menu, base, attempt));
  }

  if (menu.fallbackGroup) {
    return twiml(
      `<Say voice="Polly.Joanna">Putting you through.</Say>`
      + `<Redirect>${base}/api/twilio/voice/ring`
      + `?g=${menu.fallbackGroup}&amp;s=1</Redirect>`);
  }
  return twiml(`<Redirect>${base}/api/twilio/voice/voicemail</Redirect>`);
}
