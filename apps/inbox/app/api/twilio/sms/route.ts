import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkTwilioSignature, formToObject, toE164 } from "@/lib/twilio";
import { pushToTeam, CLAIM_ACTIONS } from "@/lib/push";
import { classify, needsReview } from "@/lib/classify";
import { prettyPhone } from "@/lib/format";
import { storeInboundMedia } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Read the body as TEXT first. Calling req.formData() consumes the stream and
  // leaves nothing to hash, which is the usual reason signature checks fail.
  const raw = await req.text();
  const params = formToObject(raw);

  const sig = checkTwilioSignature(req, "/api/twilio/sms", params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

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
    .from("contacts").select("id, party, unit_id").eq("phone", from).maybeSingle();
  if (!contact) {
    const { data } = await db
      .from("contacts").insert({ phone: from, party: "other" })
      .select("id, party, unit_id").single();
    contact = data!;
  }

  // At most one open conversation per contact, enforced by a partial unique
  // index, so inbound messages have an unambiguous home.
  let { data: convo } = await db
    .from("conversations").select("id, team_id, category")
    .eq("contact_id", contact.id).neq("status", "closed").maybeSingle();

  if (!convo) {
    // Who is texting matters more than what they said. A sitting tenant asking
    // "is it still available" is not a new prospect.
    const { count: priorConversations } = await db
      .from("conversations").select("id", { count: "exact", head: true })
      .eq("contact_id", contact.id);

    const result = await classify(body, "sms", {
      party: contact.party,
      hasUnit: !!contact.unit_id,
      priorConversations: priorConversations ?? 0,
    });

    // Below the confidence threshold the thread is left unrouted and
    // unassigned, so it surfaces in Needs review rather than being filed
    // confidently into the wrong team's queue.
    const uncertain = needsReview(result);
    const { data: team } = uncertain
      ? { data: null }
      : await db.from("teams").select("id").eq("category", result.category).maybeSingle();

    const { data } = await db.from("conversations").insert({
      contact_id: contact.id,
      category: result.category,
      category_confidence: result.confidence,
      team_id: team?.id ?? null,
      subject: (result.urgent ? "URGENT " : "") + (result.summary ?? body.slice(0, 70)),
    }).select("id, team_id, category").single();
    convo = data!;
  }

  const incoming: string[] = [];
  const n = parseInt(params.NumMedia ?? "0", 10);
  for (let i = 0; i < n; i++) if (params[`MediaUrl${i}`]) incoming.push(params[`MediaUrl${i}`]);

  // Copied into our own storage before the message is written, so the row never
  // points at a Twilio URL that a browser cannot open and Twilio may later drop.
  const { paths, failed } = incoming.length
    ? await storeInboundMedia(db, convo.id, sid, incoming)
    : { paths: [] as string[], failed: 0 };

  // Say so in the thread rather than silently showing fewer photos than were
  // sent. Someone has to know to ask the tenant again.
  const noteLostMedia = failed
    ? `\n\n[${failed} attachment${failed > 1 ? "s" : ""} could not be saved — ask them to resend]`
    : "";

  const { error } = await db.from("messages").insert({
    conversation_id: convo.id,
    direction: "inbound",
    body: body + noteLostMedia,
    media_paths: paths,
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
    conversationId: convo.id,
    actions: CLAIM_ACTIONS,
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
