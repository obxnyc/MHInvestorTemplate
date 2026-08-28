import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTwilioSignature, formToObject, toE164 } from "@/lib/twilio";
import { pushToTeam } from "@/lib/push";
import { prettyPhone } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Keyword routing runs before any model call. "No heat" at 2am must never
 *  wait on an API round-trip, and these are the cases where being slow is the
 *  same as being wrong. */
const URGENT = /\b(no heat|no water|leak|flood|burst|gas|smoke|fire|sewage|lockout|locked out|no power|furnace)\b/i;
const MAINTENANCE = /\b(broken|repair|fix|leak|heat|ac|air condition|furnace|toilet|sink|drain|clog|appliance|fridge|stove|water heater|roof|window|door|pest|mice|roach)\b/i;
const LEASING = /\b(available|availability|rent|renting|apply|application|tour|showing|see the|move in|3 bed|2 bed|bedroom|how much)\b/i;

function classify(body: string): { category: string; urgent: boolean } {
  const urgent = URGENT.test(body);
  if (urgent || MAINTENANCE.test(body)) return { category: "maintenance", urgent };
  if (LEASING.test(body)) return { category: "prospect", urgent: false };
  return { category: "other", urgent: false };
}

export async function POST(req: Request) {
  // Read the body as TEXT first. Calling req.formData() consumes the stream and
  // leaves nothing to hash, which is the usual reason signature checks fail.
  const raw = await req.text();
  const params = formToObject(raw);

  const url = `${process.env.PUBLIC_BASE_URL}/api/twilio/sms`;
  if (!verifyTwilioSignature(req.headers.get("x-twilio-signature"), url, params)) {
    return new NextResponse("invalid signature", { status: 403 });
  }

  const sid = params.MessageSid;
  const from = toE164(params.From ?? "");
  const body = params.Body ?? "";
  const db = supabaseAdmin();

  // Twilio retries on any non-2xx. A duplicated tenant message is worse than a
  // dropped one, so the unique index on twilio_sid is the real guard and this
  // is just the fast path.
  const { data: seen } = await db
    .from("messages").select("id").eq("twilio_sid", sid).maybeSingle();
  if (seen) return xml();

  // Contacts are keyed on E.164 so an inbound text always finds its person.
  let { data: contact } = await db
    .from("contacts").select("id, party").eq("phone", from).maybeSingle();
  if (!contact) {
    const { data } = await db
      .from("contacts").insert({ phone: from, party: "other" }).select("id, party").single();
    contact = data!;
  }

  // At most one open conversation per contact, enforced by a partial unique
  // index, so inbound messages have an unambiguous home.
  let { data: convo } = await db
    .from("conversations").select("id, team_id, category")
    .eq("contact_id", contact.id).neq("status", "closed").maybeSingle();

  if (!convo) {
    const { category, urgent } = classify(body);
    const { data: team } = await db
      .from("teams").select("id").eq("category", category).maybeSingle();
    const { data } = await db.from("conversations").insert({
      contact_id: contact.id,
      category,
      team_id: team?.id ?? null,
      subject: urgent ? "URGENT " + body.slice(0, 60) : body.slice(0, 70),
    }).select("id, team_id, category").single();
    convo = data!;
  }

  const media: string[] = [];
  const n = parseInt(params.NumMedia ?? "0", 10);
  for (let i = 0; i < n; i++) if (params[`MediaUrl${i}`]) media.push(params[`MediaUrl${i}`]);

  const { error } = await db.from("messages").insert({
    conversation_id: convo.id,
    direction: "inbound",
    body,
    media_urls: media,
    twilio_sid: sid,
    status: "received",
    sent_by: null, // inbound is never attributed to an employee
  });
  // 23505 = the unique index caught a retry that raced past the check above
  if (error && error.code !== "23505") {
    console.error("message insert failed", error);
    return new NextResponse("error", { status: 500 });
  }

  await db.from("conversations")
    .update({ last_message_at: new Date().toISOString(), status: "open",
              last_message_preview: body.slice(0, 160) })
    .eq("id", convo.id);

  const { data: who } = await db.from("contacts")
    .select("full_name, phone").eq("id", contact.id).maybeSingle();
  await pushToTeam(convo.team_id, {
    title: who?.full_name || prettyPhone(who?.phone ?? from),
    body: body.slice(0, 140),
    url: `/c/${convo.id}`,
    tag: convo.id,
  });

  // Empty TwiML: acknowledge without auto-replying. A human answers from the
  // portal, and that reply carries their name.
  return xml();
}

function xml() {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
