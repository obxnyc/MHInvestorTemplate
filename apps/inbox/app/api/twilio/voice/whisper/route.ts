import { formToObject, verifyTwilioSignature } from "@/lib/twilio";
import { twiml } from "@/lib/voice";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Played to the employee's leg only, before the call bridges. Pressing 1 both
 *  accepts the call and proves a human is on the line. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const staff = url.searchParams.get("staff") ?? "";
  const raw = await req.text();
  const params = formToObject(raw);
  const full = `${process.env.PUBLIC_BASE_URL}/api/twilio/voice/whisper?staff=${staff}`;
  if (!verifyTwilioSignature(req.headers.get("x-twilio-signature"), full, params)) {
    return new NextResponse("invalid signature", { status: 403 });
  }

  return twiml(
    `<Gather numDigits="1" timeout="8">`
    + `<Say voice="Polly.Joanna">Larabee Homes call. Press one to accept.</Say>`
    + `</Gather><Hangup/>`
  );
}
