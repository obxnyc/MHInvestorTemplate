import { NextResponse } from "next/server";
import { checkTwilioSignature, formToObject, publicBase } from "@/lib/twilio";
import { twiml } from "@/lib/voice";
import { callerTwiml } from "@/lib/legs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller, into the conversation with whoever pressed 1 -- or back into
 *  it from hold, when the person who stepped out pressed 0. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, `/api/twilio/voice/connect${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });
  return twiml(callerTwiml(publicBase(req), url.searchParams.get("c") ?? ""));
}
