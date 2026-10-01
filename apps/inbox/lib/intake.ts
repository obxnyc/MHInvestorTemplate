import { supabaseAdmin } from "./supabase-admin";
import { toE164 } from "./twilio";
import { urgencyFromText, lotDigits, propertyHint } from "./jobs";
import { pushToTeam, pushToStaff, CLAIM_ACTIONS } from "./push";

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
    conversationId: convo.id,
    actions: CLAIM_ACTIONS,
  });

  // A maintenance request becomes a job, not just a thread.
  //
  // It used to become only a thread, and somebody had to notice it and press
  // Hand off. That is the right rule for a text message -- "the heat's a bit
  // funny" is a conversation, not a work order -- but a Tenant WebAccess
  // submission is not a conversation. Somebody filled in a form headed Issue
  // Title and Description, in a portal whose entire purpose is reporting a
  // repair. Making a person retype that into a ticket is asking them to do
  // the computer's job, and the ones nobody got round to retyping are exactly
  // the repairs that went missing.
  //
  // Failing here must not cost the thread. The message is already written; a
  // job that could not be opened is a gap on a dashboard, and a request that
  // vanished because the job insert threw is a repair nobody knows about.
  let workOrderId: string | null = null;
  if (item.category === "maintenance") {
    try {
      workOrderId = await openJob(db, item, convo.id);
    } catch (e) {
      console.error("intake could not open a work order", { source: item.source, e });
    }
  }

  return { ok: true, conversationId: convo.id, workOrderId };
}

/**
 * Open the job a maintenance request implies.
 *
 * The unit is the hard part. Rent Manager writes the place in the subject --
 * "1140 Northside #51, 1140 Northside Rd, Lot #51" -- and our own labels are
 * variously "#51", "Lot 51" and "51" depending on who typed them in, so the
 * match is on the digits and the property name rather than on the string.
 *
 * A job with no unit is still a job. It shows as "Address not set" and the row
 * still opens the thread, which carries the subject line and the tenant's own
 * words. That is recoverable in ten seconds; a dropped request is not.
 */
async function openJob(
  db: ReturnType<typeof supabaseAdmin>, item: Intake, conversationId: string,
): Promise<string | null> {
  // Whatever the thread already knows beats anything parsed out of a subject
  // line: it came from a contact record somebody maintains.
  const { data: convo } = await db.from("conversations")
    .select("unit_id, contacts(unit_id)").eq("id", conversationId).maybeSingle();
  let unitId = (convo as { unit_id?: string | null } | null)?.unit_id
    ?? (convo?.contacts as unknown as { unit_id?: string | null } | null)?.unit_id
    ?? null;

  if (!unitId && item.unitHint) {
    unitId = await unitFromHint(db, item.unitHint);
  }

  const { data, error } = await db.from("work_orders").insert({
    conversation_id: conversationId,
    unit_id: unitId,
    summary: item.summary.slice(0, 200),
    detail: item.raw,
    urgency: urgencyFromText(`${item.summary}\n${item.raw}`),
    status: "new",
  }).select("id").single();
  if (error) throw error;
  return data?.id ?? null;
}

/** The unit a Rent Manager subject line is pointing at, or null.
 *
 *  Both halves have to agree -- the lot number AND the property -- because lot
 *  51 exists in more than one park, and filing a leak against the wrong park
 *  is worse than filing it against none. */
async function unitFromHint(
  db: ReturnType<typeof supabaseAdmin>, hint: string,
): Promise<string | null> {
  const lot = lotDigits(hint);
  if (!lot) return null;

  const { data: units } = await db.from("units")
    .select("id, label, properties(name)");
  if (!units?.length) return null;

  const digits = (s: string) => s.replace(/\D+/g, "");
  const candidates = units.filter((u) => digits(u.label) === lot);
  if (candidates.length === 1) return candidates[0].id;
  if (!candidates.length) return null;

  // More than one park has this lot number, so the property has to break the
  // tie. Matched loosely because "1140 Northside" in a subject is "1140
  // Northside Road" in our records about half the time.
  const place = (propertyHint(hint) ?? "").toLowerCase();
  if (!place) return null;
  const words = place.split(/\s+/).filter((w) => w.length > 2);
  const scored = candidates.map((u) => {
    const name = ((u.properties as unknown as { name?: string } | null)?.name ?? "")
      .toLowerCase();
    return { id: u.id, hits: words.filter((w) => name.includes(w)).length };
  }).sort((a, b) => b.hits - a.hits);

  // A single clear winner, or nothing. A tie means we cannot tell, and
  // guessing between two parks is the one outcome worth refusing.
  return scored[0].hits > 0 && scored[0].hits > (scored[1]?.hits ?? 0)
    ? scored[0].id : null;
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
