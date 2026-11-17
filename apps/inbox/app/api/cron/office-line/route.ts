import { NextResponse } from "next/server";
import { cronKeyOk } from "@/lib/cron-key";
import { twilioClient } from "@/lib/twilio";
import { transcriptServiceCheck } from "@/lib/transcribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Where does the office line's ringing actually go?
 *
 * Nothing in the app can be right about calls if Twilio is not sending them
 * here, and that setting lives in Twilio's console, where nobody looks. So
 * this asks Twilio, with the app's own credentials:
 *
 *   GET                every number on the account, and where its calls and
 *                      texts are sent
 *   GET ?fix=1         also point the line's CALLS at /api/twilio/voice --
 *                      the line being the number whose TEXTS already come
 *                      here -- and make sure transcripts can be made
 *
 * Asked with the reports key, which is generated and checked inside the
 * database (051) and read from Vault by pg_net, so the Supabase connector can
 * call it and nobody copies a secret between two dashboards.
 */
const authorized = (req: Request) => cronKeyOk(req, "report_key_ok");

export async function GET(req: Request) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const fix = new URL(req.url).searchParams.get("fix") === "1";
  const base = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "")
    || new URL(req.url).origin;
  const want = `${base}/api/twilio/voice`;

  try {
    const client = twilioClient();
    const numbers = await client.incomingPhoneNumbers.list({ limit: 50 });
    const report = numbers.map((n) => ({
      sid: n.sid, number: n.phoneNumber, name: n.friendlyName,
      calls_go_to: n.voiceUrl || n.voiceApplicationSid || "(nowhere)",
      texts_go_to: n.smsUrl || n.smsApplicationSid || "(messaging service)",
      calls_reach_the_app: /\/api\/twilio\/voice\/?$/.test(n.voiceUrl ?? ""),
    }));

    const changed: string[] = [];
    let transcripts: string | null = null;
    if (fix) {
      // The line is the number whose texts already reach the app; with one
      // number on the account it is that one.
      const line = numbers.filter((n) => /\/api\/twilio\/sms/.test(n.smsUrl ?? ""));
      const targets = line.length ? line : numbers.length === 1 ? numbers : [];
      for (const n of targets) {
        if (n.voiceUrl === want && n.voiceMethod === "POST") continue;
        await client.incomingPhoneNumbers(n.sid).update({
          voiceUrl: want, voiceMethod: "POST", voiceApplicationSid: "",
        });
        changed.push(`${n.phoneNumber}: calls were going to ${n.voiceUrl || "nowhere"}, now ${want}`);
      }
      transcripts = await transcriptServiceCheck();
    }

    return NextResponse.json({ ok: true, numbers: report, changed, transcripts });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
