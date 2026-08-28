import { supabaseAdmin } from "./supabase-admin";
import { toE164 } from "./twilio";
import { pushToTeam, pushToStaff } from "./push";

export type IntakeSource = "zego" | "zillow" | "website" | "voicemail";

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
  /** Verbatim consent captured on the form, if the submission carried one. */
  consent?: {
    channel: "sms" | "email";
    purpose: "transactional" | "marketing";
    disclosureText: string;
  } | null;
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
      party: item.category === "prospect" ? "prospect"
           : item.category === "maintenance" ? "current_tenant" : "other",
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

  // Record consent before anything else touches this contact. The exact
  // sentence matters far more than a boolean: by the time it is challenged the
  // form will have been redesigned twice.
  if (item.consent) {
    await db.from("consent").insert({
      contact_id: contact.id,
      channel: item.consent.channel,
      purpose: item.consent.purpose,
      granted: true,
      source: `${item.source} form`,
      disclosure_text: item.consent.disclosureText,
    });
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
    .update({ last_message_at: new Date().toISOString(), status: "open",
              last_message_preview: item.summary.slice(0, 160) })
    .eq("id", convo.id);

  const label = {
    zego: "Maintenance request",
    zillow: "Zillow showing request",
    website: "Website form",
    voicemail: "Voicemail",
  }[item.source];
  await pushToTeam(convo.team_id, {
    title: `${label}${item.name ? ` — ${item.name}` : ""}`,
    body: item.summary.slice(0, 140),
    url: `/c/${convo.id}`,
    tag: convo.id,
  });

  return { ok: true, conversationId: convo.id };
}

/**
 * Court eFiling notices are stored on their own, never as a conversation.
 * An eviction filing is not a message to the tenant, and putting it on the
 * shared timeline would mean whoever picks up a maintenance request also sees
 * that the household is being evicted. Admins only.
 */
export async function ingestCourtFiling(f: import("./parse-email").CourtFiling) {
  const db = supabaseAdmin();

  if (f.envelopeNumber) {
    const { data: seen } = await db.from("court_filings")
      .select("id").eq("envelope_number", f.envelopeNumber).maybeSingle();
    if (seen) return { ok: true, duplicate: true };
  }

  // Tyler's stamped-copy links expire, so record the deadline to save the file.
  const expires = f.acceptedAt
    ? new Date(new Date(f.acceptedAt).getTime() + 90 * 864e5).toISOString().slice(0, 10)
    : null;

  const { data: row } = await db.from("court_filings").insert({
    plaintiff: f.plaintiff, defendant: f.defendant,
    case_number: f.caseNumber, case_style: f.caseStyle, court: f.court,
    filing_type: f.filingType, status: f.status,
    envelope_number: f.envelopeNumber, filed_by: f.filedBy,
    submitted_at: f.submittedAt, accepted_at: f.acceptedAt,
    lead_file: f.leadFile, document_url: f.documentUrl,
    document_expires_on: expires,
    raw: f.raw,
  }).select("id").single();

  const { data: admins } = await db.from("staff")
    .select("id").eq("role", "admin").eq("active", true);
  await pushToStaff((admins ?? []).map((a) => a.id), {
    title: `Filing ${f.status ?? "update"} — ${f.caseNumber ?? "case"}`,
    body: `${f.filingType ?? "Filing"} · ${f.defendant ?? f.caseStyle ?? ""}`,
    url: "/legal",
    tag: `filing:${row?.id}`,
  });

  return { ok: true, filingId: row?.id };
}
