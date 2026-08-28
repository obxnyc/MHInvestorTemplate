import { supabaseAdmin } from "./supabase-admin";
import { toE164 } from "./twilio";
import { pushToTeam } from "./push";

export type IntakeSource = "zego" | "zillow" | "website";

export type Intake = {
  source: IntakeSource;
  /** Best-effort identity. Phone is preferred because it merges with the SMS
   *  thread; email-only contacts still get a conversation. */
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  /** What the office needs to see first. */
  summary: string;
  /** The full original text. Always stored, even when parsing was imperfect. */
  raw: string;
  category: "maintenance" | "prospect" | "current_tenant" | "vendor" | "other";
  /** Provider-side id, so a redelivered webhook cannot duplicate the message. */
  externalId: string;
  unitHint?: string | null;
};

/**
 * Turn an external event into a conversation.
 *
 * The rule that matters: a thread is ALWAYS created, even when field parsing
 * came back empty. A maintenance request that lands as an unparsed blob is
 * recoverable; one that got dropped because a regex missed is not.
 */
export async function ingest(item: Intake) {
  const db = supabaseAdmin();

  const { data: dupe } = await db
    .from("messages").select("id").eq("external_id", item.externalId).maybeSingle();
  if (dupe) return { ok: true, duplicate: true };

  // Match on phone first so a Zego request from a tenant who also texts you
  // lands in the same thread rather than starting a parallel one.
  let contact: { id: string } | null = null;
  const phone = item.phone ? toE164(item.phone) : null;

  if (phone) {
    const { data } = await db.from("contacts").select("id").eq("phone", phone).maybeSingle();
    contact = data;
  }
  if (!contact && item.email) {
    const { data } = await db.from("contacts").select("id").eq("email", item.email).maybeSingle();
    contact = data;
  }
  if (!contact) {
    const { data } = await db.from("contacts").insert({
      phone: phone ?? `email:${item.email ?? item.externalId}`,
      email: item.email ?? null,
      full_name: item.name ?? null,
      party: item.category === "prospect" ? "prospect" : "current_tenant",
    }).select("id").single();
    contact = data!;
  } else if (item.name || item.email) {
    await db.from("contacts").update({
      full_name: item.name ?? undefined,
      email: item.email ?? undefined,
    }).eq("id", contact.id);
  }

  let { data: convo } = await db.from("conversations")
    .select("id, team_id").eq("contact_id", contact.id).neq("status", "closed").maybeSingle();

  if (!convo) {
    const { data: team } = await db
      .from("teams").select("id").eq("category", item.category).maybeSingle();
    const { data } = await db.from("conversations").insert({
      contact_id: contact.id,
      category: item.category,
      team_id: team?.id ?? null,
      source: item.source,
      subject: item.summary.slice(0, 90),
    }).select("id, team_id").single();
    convo = data!;
  }

  await db.from("messages").insert({
    conversation_id: convo.id,
    direction: "inbound",
    channel: item.source,
    body: item.raw,
    external_id: item.externalId,
    status: "received",
    sent_by: null,
  });

  await db.from("conversations")
    .update({ last_message_at: new Date().toISOString(), status: "open" })
    .eq("id", convo.id);

  const label = { zego: "Maintenance request", zillow: "Zillow showing request", website: "Website form" }[item.source];
  await pushToTeam(convo.team_id, {
    title: `${label}${item.name ? ` — ${item.name}` : ""}`,
    body: item.summary.slice(0, 140),
    url: `/c/${convo.id}`,
    tag: convo.id,
  });

  return { ok: true, conversationId: convo.id };
}
