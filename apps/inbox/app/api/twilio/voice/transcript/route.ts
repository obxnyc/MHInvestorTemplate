import { NextResponse } from "next/server";
import { collectTranscript } from "@/lib/transcribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio Voice Intelligence: a transcript is ready.
 *
 * The body is used for one thing, the transcript's sid, and only if it is
 * shaped like one. Everything else -- status, words, which call it belongs to
 * -- is fetched back from Twilio with our own credentials. So there is no
 * signature to check here and nothing to trust: somebody posting a made-up
 * sid gets a 404 from Twilio, and somebody posting a real one makes us re-read
 * a transcript that was already ours.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let sid = "";
  try { sid = String(JSON.parse(raw).transcript_sid ?? ""); }
  catch { sid = new URLSearchParams(raw).get("transcript_sid") ?? ""; }

  if (!/^GT[0-9a-f]{32}$/i.test(sid)) return new NextResponse(null, { status: 204 });
  try {
    await collectTranscript(sid);
  } catch (e) {
    console.error("transcript collect failed", e);
  }
  return new NextResponse(null, { status: 204 });
}
