import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkTwilioSignature, formToObject, toE164, publicBase } from "@/lib/twilio";
import { loadMenu, menuTwiml, twiml } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An inbound call to the shared line.
 *
 * The call is logged and then handed to the menu, which lives in the database
 * rather than here. Everything after this point -- what the caller hears, which
 * keys do what, who rings and in what order -- is editable by the office
 * without a deployment.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const params = formToObject(raw);
  const base = publicBase(req);
  const sig = checkTwilioSignature(req, "/api/twilio/voice", params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const from = toE164(params.From ?? "");
  const db = supabaseAdmin();

  let { data: contact } = await db.from("contacts").select("id").eq("phone", from).maybeSingle();
  if (!contact) {
    const { data } = await db.from("contacts")
      .insert({ phone: from, party: "other" }).select("id").single();
    contact = data!;
  }

  await db.from("calls").insert({
    contact_id: contact.id,
    direction: "inbound",
    twilio_call_sid: params.CallSid,
  });

  const menu = await loadMenu("root");
  // No menu built yet: ring nobody rather than hanging up, and let voicemail
  // take it. Silence on a business line is worse than a machine.
  if (!menu) {
    return twiml(`<Redirect>${base}/api/twilio/voice/voicemail</Redirect>`);
  }

  // Recording consent varies by state; two-party states require notice. One
  // line, before anything else, removes the question entirely.
  return twiml(
    `<Say voice="Polly.Joanna">This call may be recorded.</Say>`
    + menuTwiml(menu, base, 0)
  );
}
