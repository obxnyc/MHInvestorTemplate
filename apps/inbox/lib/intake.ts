import { supabaseAdmin } from "./supabase-admin";
import { placeKey, readHint } from "./alias";
import { twinFragment } from "./sameissue";
import { toE164 } from "./twilio";
import { urgencyFromText, lotDigits, propertyHint } from "./jobs";
import { pushToTeam, pushToStaff, CLAIM_ACTIONS } from "./push";
import { openInquiry, knownPlaces } from "./inquiry";

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
  /** WHEN IT ACTUALLY HAPPENED, if that is known and is not now.
   *
   *  Everything used to be stamped with the moment it was ingested, which is
   *  right for a text arriving and wrong for a backfill: pulling eight months
   *  of Rent Manager issues put every one of them at the top of the inbox,
   *  dated today, reading "just now". "I got a lot of maintenance requests
   *  today but I feel like we actually only got 2 new ones."
   *
   *  Absent means now, which is the common case and the honest default -- a
   *  source that does not say when something happened has not said it
   *  happened long ago. */
  at?: string | null;
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

  /* THE SAME REQUEST, ARRIVING THE OTHER WAY.
   *
   * A tenant submits one issue in Tenant Web Access and it reaches us
   * twice: Rent Manager emails it at once, with their name, their number
   * and the address, and the hourly pull finds the same issue later
   * carrying none of those. Both paths are worth keeping -- the pull
   * catches what the office types straight into Rent Manager, which
   * never emails -- but two threads for one broken fridge, one of them
   * empty, is what the office has been looking at.
   *
   * No id joins them: the email carries none. They are joined on what
   * the tenant actually wrote, which is identical in both and is the one
   * thing neither path invents. Short descriptions are refused by
   * `twinFragment`, because "no heat" is a sentence a dozen households
   * write in a week and joining those would be far worse than two
   * threads for one.
   */
  const twin = item.category === "maintenance" ? twinFragment(item.raw ?? "") : null;
  if (twin) {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data: seen } = await db.from("messages")
      .select("id, conversation_id, external_id")
      .eq("direction", "inbound")
      .gte("created_at", since)
      .ilike("body", `%${twin}%`)
      .limit(1).maybeSingle();
    if (seen?.conversation_id) {
      /* Recorded against the thread that already exists, so the second
         arrival is not lost -- and so that asking again does not keep
         finding it new. The RICHER one is whichever got here first: the
         email arrives within the minute and the pull is hourly, so in
         practice the thread keeps the tenant and their number. */
      await db.from("messages").insert({
        conversation_id: seen.conversation_id,
        direction: "inbound",
        body: item.raw,
        external_id: item.externalId,
        channel: "email",
      });
      return { ok: true, duplicate: true, joined: seen.conversation_id };
    }
  }

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

  /* A date in the FUTURE is a clock disagreeing somewhere, and would pin the
     thread to the top of the inbox forever. Anything ahead of now is treated
     as now. */
  const said = item.at ? Date.parse(item.at) : NaN;
  const when = Number.isFinite(said) && said < Date.now()
    ? new Date(said).toISOString()
    : new Date().toISOString();

  await db.from("messages").insert({
    conversation_id: convo.id,
    direction: "inbound",
    channel: item.source,
    body: item.raw,
    external_id: item.externalId,
    status: "received",
    sent_by: null,
    created_at: when,
  });

  await db.from("conversations")
    .update({
      last_message_at: when, status: "open",
      last_message_preview: item.summary.slice(0, 160),
      /* WHAT THE REQUEST CALLED THE PLACE, kept on the thread.
         Without it the screen cannot offer to match anything: the subject
         line is buried in the first message's body, and asking somebody to
         read it back out of the text and retype it is asking them to do the
         computer's job. The column arrives with migration 045; before that
         this is dropped, which is why it is sent on its own below rather
         than failing the whole update. */
    })
    .eq("id", convo.id);

  if (item.unitHint) {
    const { error: hintError } = await db.from("conversations")
      .update({ place_hint: item.unitHint.slice(0, 200) }).eq("id", convo.id);
    // Before 045 this column does not exist. The request still lands; it
    // simply cannot be matched from the screen until the migration is run.
    if (hintError) console.warn("place_hint not stored:", hintError.message);
  }

  const label = {
    zego: "Maintenance request",
    zillow: "Zillow showing request",
    website: "Website form",
    voicemail: "Voicemail",
  }[item.source];
  /* OLD NEWS DOES NOT BUZZ EVERY PHONE IN THE OFFICE.
     A backfill of sixty historical issues sent sixty notifications, each one
     claiming a maintenance request had just come in. A day is the line: a
     request from this morning is worth a buzz, one from March is a record
     being filed. */
  const FRESH_MS = 24 * 3600 * 1000;
  if (Date.now() - Date.parse(when) < FRESH_MS) {
  await pushToTeam(convo.team_id, {
    title: `${label}${item.name ? ` — ${item.name}` : ""}`,
    body: item.summary.slice(0, 140),
    url: `/c/${convo.id}`,
    tag: convo.id,
    conversationId: convo.id,
    actions: CLAIM_ACTIONS,
  });
  }

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

  // And a leasing enquiry becomes an inquiry record, for the same reason a
  // maintenance request becomes a work order: so it can be counted, matched
  // against an empty lot, and rung back. Up to now it became a thread and
  // nothing else, which is why `inquiries` has been an empty table.
  //
  // The same rule applies as above -- failing here must not cost the thread.
  // The message is already written. An inquiry that could not be opened is a
  // gap on a board; a lead that vanished because an insert threw is a lead.
  let inquiryId: string | null = null;
  if (item.category === "prospect") {
    try {
      const got = await openInquiry(db, {
        contactId: contact.id,
        conversationId: convo.id,
        source: `${item.source} form`,
        text: item.raw,
        places: await knownPlaces(db),
      });
      inquiryId = got?.id ?? null;
    } catch (e) {
      console.error("intake could not open an inquiry", { source: item.source, e });
    }
  }

  return { ok: true, conversationId: convo.id, workOrderId, inquiryId };
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

  /** Whether the address was worked out here rather than already known. */
  let worked = false;
  if (!unitId && item.unitHint) {
    unitId = await unitFromHint(db, item.unitHint);
    worked = Boolean(unitId);
  }

  /* TAG THE THREAD, NOT ONLY THE JOB.
   *
   * The work order has had the address since the day this was written and
   * the conversation never did -- so a request whose subject line we
   * matched perfectly still opened a thread saying "Not filed against a
   * property", with the job underneath it knowing exactly where it was.
   * Two answers to one question, one of them visible.
   *
   * The CONTACT is deliberately left alone. A tenant reports a leak at
   * their neighbour's as readily as their own, and writing an address
   * onto a person from one request is how somebody's record quietly
   * becomes wrong. */
  if (unitId && worked) {
    const { error } = await db.from("conversations")
      .update({ unit_id: unitId }).eq("id", conversationId);
    /* Not fatal: the job still carries the address and the thread simply
       asks somebody to confirm it, which is the old behaviour. Logged so
       it is not silent. */
    if (error) console.warn("could not tag the thread with its unit:", error.message);
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
  /* A REMEMBERED ANSWER BEATS ANY PARSING.
     Somebody looked at this exact place name once and said which property it
     is. That is not a guess and must not be second-guessed by one. */
  const { data: alias } = await db.from("place_aliases")
    .select("unit_id").eq("key", placeKey(hint)).maybeSingle();
  if (alias?.unit_id) return alias.unit_id as string;

  const lot = lotDigits(hint);
  /* No lot number in the subject is a SINGLE HOME, not a failure. "114 Lisas
     Way, 114 Lisas Way" has no lot and never could -- and returning null here
     meant a house could never be matched even when we held it, which is why
     requests kept arriving filed against nothing. */
  if (!lot) return unitOfSingleHome(db, hint);

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

/** The unit of a single home, matched on the property's own name or address.
 *
 *  A subject with no lot number in it is a house, not a failure to parse.
 *  "114 Lisas Way, 114 Lisas Way" is Rent Manager naming the property and the
 *  unit identically, and until now that returned null and the request was
 *  filed against nothing at all.
 *
 *  Matched on the NORMALISED key both ways, so "114 Lisas Way" in our records
 *  and "114 Lisas Way, 114 Lisas Way" in the subject are the same house. An
 *  exact string match is the only kind taken: a near miss here is a work
 *  order on somebody else's home, and the screen can offer a near miss far
 *  more safely than this can act on one.
 */
async function unitOfSingleHome(
  db: ReturnType<typeof supabaseAdmin>, hint: string,
): Promise<string | null> {
  const want = placeKey(hint);
  const said = readHint(hint);
  if (!want) return null;

  const { data: props } = await db.from("properties").select("id, name, address");
  const hit = (props ?? []).filter((p) => {
    const byName = placeKey(String(p.name ?? "")) === want;
    const byAddress = placeKey(String(p.address ?? "")) === want;
    const byPart = said.property
      && placeKey(String(p.name ?? "")) === placeKey(said.property);
    return byName || byAddress || byPart;
  });
  /* Two properties answering to one name is not a match, it is a question.
     Picking either would be a coin toss with a work order on it. */
  if (hit.length !== 1) return null;

  const { data: units } = await db.from("units")
    .select("id").eq("property_id", hit[0]!.id).limit(2);
  // One unit is the house itself. More than one is a building, and which
  // flat it is was never in the subject line.
  return units?.length === 1 ? (units[0]!.id as string) : null;
}
