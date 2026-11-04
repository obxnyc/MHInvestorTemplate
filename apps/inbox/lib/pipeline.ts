import { randomBytes } from "crypto";
import { supabaseAdmin } from "./supabase-admin";
import { twilioClient } from "./twilio";
import { sendSms, sendEmail } from "./notify";
import { pushToTeam } from "./push";
import { ZONE } from "./zone";
import {
  planFor, stillDue, quietUntil, words, firstName, SHOWING_KINDS,
  type Kind, type Stage, type Words,
} from "./followups";
import { openSlots, DEFAULT_RULES, type Hours, type Rules, type Slot } from "./slots";

/**
 * The leasing pipeline, end to end:
 *
 *   enquiry (Zillow, a text, a website form)
 *     -> the prescreening questions, sent at once, with nudges at 1 and 3 days
 *     -> prequalified: a booking link, nudged at 1 and 3 days
 *        needs a look: the office decides, and one press sends the link
 *        does not meet the criteria: told which criterion, by the form
 *     -> booked: confirmation now, reminders the day before and 2 hours
 *        before, a follow-up 3 hours after with the application link
 *     -> shown / no-show / cancelled, each with its own next message
 *     -> 14 days and nowhere: ask how it ended (NURTURE.md)
 *
 * Every follow-up is a row in lead_followups before it is anything else, so
 * the office can see what is planned, and every one is asked again at send
 * time whether it still makes sense (followups.ts).
 */

type Db = ReturnType<typeof supabaseAdmin>;

const token = () => randomBytes(18).toString("base64url");

/** Hosts a link must be built on. PUBLIC_BASE_URL first, as elsewhere. */
export function baseUrl(fallback?: string): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined;
  return (process.env.PUBLIC_BASE_URL || fallback || vercel || "").trim().replace(/\/+$/, "");
}

export function whenSaid(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: ZONE, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

type Lead = {
  id: string;
  stage: Stage;
  outcome: string;
  prescreenToken: string | null;
  contactId: string;
  conversationId: string | null;
  unitId: string | null;
  name: string | null;
  phone: string | null;   // null when the contact is keyed on an email
  email: string | null;
  home: string;
  address: string | null;
};

async function loadLead(db: Db, inquiryId: string): Promise<Lead | null> {
  const { data: q } = await db.from("inquiries")
    .select("id, stage, outcome, prescreen_token, contact_id, conversation_id, unit_id, contacts(full_name, phone, email)")
    .eq("id", inquiryId).maybeSingle();
  if (!q) return null;
  const c = q.contacts as unknown as { full_name: string | null; phone: string | null;
                                       email: string | null } | null;
  const where = q.unit_id ? await homeName(db, q.unit_id as string) : null;
  // An inquiry with no open conversation still has a person; find their
  // thread so what we send them is written where the office reads.
  let conversationId = q.conversation_id as string | null;
  if (!conversationId) {
    const { data: convo } = await db.from("conversations").select("id")
      .eq("contact_id", q.contact_id).neq("status", "closed").maybeSingle();
    conversationId = convo?.id ?? null;
  }
  return {
    id: q.id as string,
    stage: (q.stage ?? "new") as Stage,
    outcome: q.outcome as string,
    prescreenToken: (q.prescreen_token as string | null) ?? null,
    contactId: q.contact_id as string,
    conversationId,
    unitId: (q.unit_id as string | null) ?? null,
    name: c?.full_name ?? null,
    phone: c?.phone && !c.phone.startsWith("email:") ? c.phone : null,
    email: c?.email ?? null,
    home: where?.home ?? "the home you asked about",
    address: where?.address ?? null,
  };
}

/** "Northside Lot 14" and the street address Zillow shows, if listed. */
export async function homeName(db: Db, unitId: string):
  Promise<{ home: string; address: string | null }> {
  const { data: u } = await db.from("units")
    .select("label, properties(name, address)").eq("id", unitId).maybeSingle();
  const p = u?.properties as unknown as { name: string; address: string | null } | undefined;
  const { data: l } = await db.from("listings")
    .select("street, city, state, zip").eq("unit_id", unitId).maybeSingle();
  const address = l?.street
    ? [l.street, l.city, [l.state, l.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : p?.address ?? null;
  return {
    home: `${p?.name ?? "the home"}${u?.label ? ` ${u.label}` : ""}`,
    address,
  };
}

async function optedOut(db: Db, contactId: string, channel: "sms" | "email"): Promise<boolean> {
  const { data } = await db.from("consent_current").select("granted")
    .eq("contact_id", contactId).eq("channel", channel).eq("granted", false).limit(1);
  return !!data?.length;
}

/**
 * Send one message to a lead, by whichever road reaches them.
 *
 * Text when there is a real number and they have not said stop; email
 * otherwise -- which, for a Zillow lead, is the relay address Zillow hands
 * back to the renter. Written into their conversation either way, so the
 * thread shows what the pipeline said on the office's behalf. A message the
 * office cannot see is one somebody repeats, or contradicts.
 */
async function deliver(
  db: Db, lead: Lead, msg: { subject: string; text: string }, tag: string,
): Promise<{ channel: "sms" | "email"; id: string | null } | { channel: null; why: string }> {
  let channel: "sms" | "email" | null = null;
  let id: string | null = null;
  if (lead.phone && process.env.TWILIO_MESSAGING_SERVICE_SID
      && !(await optedOut(db, lead.contactId, "sms"))) {
    id = await sendSms(lead.phone, msg.text);
    if (id) channel = "sms";
  }
  if (!channel && lead.email && process.env.POSTMARK_SERVER_TOKEN
      && !(await optedOut(db, lead.contactId, "email"))) {
    await sendEmail(lead.email, msg.subject, msg.text);
    channel = "email";
  }
  if (!channel) {
    return {
      channel: null,
      why: !lead.phone && !lead.email ? "no number or email on file"
        : "no way to send: Twilio and Postmark are not both set up, or they opted out",
    };
  }
  if (lead.conversationId) {
    await db.from("messages").insert({
      conversation_id: lead.conversationId,
      direction: "outbound",
      channel,
      body: msg.text,
      status: "sent",
      twilio_sid: channel === "sms" ? id : null,
      external_id: `pipeline:${tag}`,
    });
    await db.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: msg.text.slice(0, 160),
    }).eq("id", lead.conversationId);
  }
  return { channel, id };
}

async function setStage(db: Db, inquiryId: string, stage: Stage) {
  await db.from("inquiries").update({ stage, stage_at: new Date().toISOString() })
    .eq("id", inquiryId);
}

async function plan(db: Db, inquiryId: string, items: { kind: Kind; due: Date }[],
                    showingId: string | null = null) {
  if (!items.length) return;
  const rows = items.map((i) => ({
    inquiry_id: inquiryId, kind: i.kind, due_at: i.due.toISOString(),
    showing_id: showingId, state: "scheduled",
  }));
  // The unique index is the guard against planning the same touch twice; a
  // second plan for the same thing is a no-op, not an error.
  for (const r of rows) {
    const { error } = await db.from("lead_followups").insert(r);
    if (error && !/duplicate|unique/i.test(error.message)) throw error;
  }
}

async function skip(db: Db, inquiryId: string, kinds: Kind[], reason: string) {
  await db.from("lead_followups")
    .update({ state: "skipped", skipped_reason: reason })
    .eq("inquiry_id", inquiryId).in("kind", kinds).eq("state", "scheduled");
}

async function ensurePrescreenToken(db: Db, lead: Lead): Promise<string> {
  if (lead.prescreenToken) return lead.prescreenToken;
  const t = token();
  await db.from("inquiries").update({ prescreen_token: t }).eq("id", lead.id);
  lead.prescreenToken = t;
  return t;
}

/** The booking link for whoever this is, if they have earned one. */
async function bookingLink(db: Db, contactId: string, base: string): Promise<string | null> {
  const { data } = await db.from("prequal_submissions").select("booking_token")
    .eq("contact_id", contactId).not("booking_token", "is", null)
    .order("decided_at", { ascending: false }).limit(1).maybeSingle();
  return data?.booking_token ? `${base}/book/${data.booking_token}` : null;
}

function wordsFor(lead: Lead, base: string, extra: Partial<Words> = {}): Words {
  return {
    first: firstName(lead.name),
    home: lead.home,
    address: lead.address,
    prescreenUrl: lead.prescreenToken ? `${base}/apply?lead=${lead.prescreenToken}` : `${base}/apply`,
    applyUrl: process.env.RENTAL_APPLICATION_URL || null,
    ...extra,
  };
}

// ------------------------------------------------------------ the events

/**
 * A new enquiry: send the prescreening questions now and plan the nudges.
 *
 * Only from 'new'. A second email from the same Zillow lead is the same
 * person still talking, not a reason to send the questions again.
 */
export async function startPipeline(db: Db, inquiryId: string, base: string) {
  const lead = await loadLead(db, inquiryId);
  if (!lead || lead.stage !== "new" || lead.outcome !== "open") return { started: false };
  await ensurePrescreenToken(db, lead);
  const sent = await deliver(db, lead, words("invite", wordsFor(lead, base)), `${lead.id}:invite`);
  if (!sent.channel) {
    // Nothing went, so nothing is pretended. The office sees "Just arrived"
    // and the reason, rather than "Sent the questions" over a silent fail.
    await db.from("inquiries").update({ stage_at: new Date().toISOString() }).eq("id", lead.id);
    return { started: false, why: sent.why };
  }
  await setStage(db, lead.id, "invited");
  await plan(db, lead.id, planFor("invited", new Date()));
  return { started: true, channel: sent.channel };
}

/** They answered the questions. */
export async function onPrequal(
  db: Db, inquiryId: string, outcome: "auto_approve" | "manual_review" | "declined",
) {
  const stage: Stage = outcome === "auto_approve" ? "prequalified"
    : outcome === "manual_review" ? "review" : "declined";
  await skip(db, inquiryId, ["invite_nudge_1", "invite_nudge_2"], "answered the questions");
  await setStage(db, inquiryId, stage);
  if (stage === "prequalified") await plan(db, inquiryId, planFor("prequalified", new Date()));
}

/**
 * The office looked at a 'needs a look' and said yes: issue the booking link
 * the ruleset did not, and send it. The reviewer and the time are written on
 * the submission, because the manual tier is the one where a decision has to
 * be documented as carefully as the automatic one.
 */
export async function approveReview(db: Db, inquiryId: string, staffId: string,
                                    reason: string, base: string) {
  const lead = await loadLead(db, inquiryId);
  if (!lead) throw new Error("no such inquiry");
  const { data: sub } = await db.from("prequal_submissions")
    .select("id, booking_token").eq("contact_id", lead.contactId)
    .order("decided_at", { ascending: false }).limit(1).maybeSingle();
  if (!sub) throw new Error("they have not answered the questions yet");
  const t = sub.booking_token ?? token();
  await db.from("prequal_submissions").update({
    booking_token: t, reviewed_by: staffId, reviewed_at: new Date().toISOString(),
    review_reason: reason.trim() || "approved to book a showing",
  }).eq("id", sub.id);
  await setStage(db, lead.id, "prequalified");
  await plan(db, lead.id, planFor("prequalified", new Date()));
  const sent = await deliver(db, lead,
    words("book_nudge_1", wordsFor(lead, base, { bookUrl: `${base}/book/${t}` })),
    `${lead.id}:approved:${sub.id}`);
  return { ok: true, sent: sent.channel };
}

/** Twilio sends scheduled texts itself between 15 minutes and 35 days out. */
const TWILIO_MIN = 16 * 60000;
const TWILIO_MAX = 34 * 24 * 3600_000;

async function handToTwilio(to: string, body: string, at: Date): Promise<string | null> {
  const sid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid) return null;
  const ahead = at.getTime() - Date.now();
  if (ahead < TWILIO_MIN || ahead > TWILIO_MAX) return null;
  try {
    const m = await twilioClient().messages.create({
      to, body, messagingServiceSid: sid, scheduleType: "fixed", sendAt: at,
      statusCallback: `${process.env.PUBLIC_BASE_URL}/api/twilio/status`,
    });
    return m.sid;
  } catch (e) {
    console.error("could not schedule with twilio", e);
    return null;
  }
}

async function cancelHanded(db: Db, showingId: string, reason: string) {
  const { data: handed } = await db.from("lead_followups")
    .select("id, provider_id").eq("showing_id", showingId).eq("state", "handed");
  for (const h of handed ?? []) {
    try {
      if (h.provider_id) await twilioClient().messages(h.provider_id).update({ status: "canceled" });
    } catch (e) {
      console.error("could not cancel a scheduled text", h.provider_id, e);
    }
  }
  await db.from("lead_followups").update({ state: "skipped", skipped_reason: reason })
    .eq("showing_id", showingId).in("state", ["scheduled", "handed"]);
}

export type BookInput = {
  contactId: string;
  unitId: string | null;
  submissionId: string | null;
  start: string;
  end: string;
};

/**
 * Put somebody on the calendar.
 *
 * A person has at most one showing coming up: booking again is moving it, so
 * the old one is cancelled -- and its reminders with it -- in the same step.
 * Otherwise they get a reminder for a time they already gave up.
 */
export async function bookShowing(db: Db, input: BookInput, base: string) {
  // The inquiry this belongs to, opening one if they came straight to the
  // form with no enquiry on file.
  let { data: q } = await db.from("inquiries").select("id")
    .eq("contact_id", input.contactId).eq("outcome", "open").maybeSingle();
  if (!q) {
    const { data } = await db.from("inquiries").insert({
      contact_id: input.contactId, unit_id: input.unitId, source: "booking page",
      stage: "prequalified",
    }).select("id").single();
    q = data;
  }
  const inquiryId = q!.id as string;

  const { data: before } = await db.from("showings").select("id")
    .eq("contact_id", input.contactId).in("status", ["booked", "confirmed"])
    .gt("scheduled_for", new Date().toISOString());
  for (const b of before ?? []) {
    await db.from("showings").update({
      status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "moved to another time",
    }).eq("id", b.id);
    await cancelHanded(db, b.id, "moved to another time");
  }

  const manage = token();
  // No `prequalified` column: the Cal.com webhook writes one, and the live
  // table has never had it -- which is a reason that webhook has never
  // recorded a showing. Nothing here depends on it.
  const { data: showing, error } = await db.from("showings").insert({
    contact_id: input.contactId, unit_id: input.unitId, submission_id: input.submissionId,
    inquiry_id: inquiryId, scheduled_for: input.start, ends_at: input.end,
    status: "booked", manage_token: manage,
  }).select("id").single();
  if (error) throw error;
  return finishBooking(db, inquiryId, showing!.id as string, input, manage, base);
}

async function finishBooking(db: Db, inquiryId: string, showingId: string, input: BookInput,
                             manage: string, base: string) {
  if (input.submissionId) {
    await db.from("prequal_submissions").update({ booking_used_at: new Date().toISOString() })
      .eq("id", input.submissionId);
  }
  if (input.unitId) {
    await db.from("inquiries").update({ unit_id: input.unitId }).eq("id", inquiryId).is("unit_id", null);
  }
  await skip(db, inquiryId, ["book_nudge_1", "book_nudge_2", "invite_nudge_1", "invite_nudge_2"],
    "booked a showing");
  await setStage(db, inquiryId, "booked");

  const lead = (await loadLead(db, inquiryId))!;
  if (input.unitId) Object.assign(lead, await homeName(db, input.unitId));
  const w = wordsFor(lead, base, { when: whenSaid(input.start), manageUrl: `${base}/showing/${manage}` });

  await deliver(db, lead, words("booked", w), `${showingId}:booked`);

  // Reminders. The ones that must land at an exact minute go to Twilio to
  // send at that minute; this plan's cron runs once a day and cannot.
  const items = planFor("booked", new Date(input.start));
  await plan(db, inquiryId, items, showingId);
  if (lead.phone && !(await optedOut(db, lead.contactId, "sms"))) {
    for (const it of items.filter((i) => i.kind !== "after_showing")) {
      const sid = await handToTwilio(lead.phone, words(it.kind, w).text, it.due);
      if (sid) {
        await db.from("lead_followups").update({ state: "handed", provider_id: sid, channel: "sms" })
          .eq("inquiry_id", inquiryId).eq("kind", it.kind).eq("showing_id", showingId);
      }
    }
  }

  const { data: team } = await db.from("teams").select("id").eq("category", "prospect").maybeSingle();
  await pushToTeam(team?.id ?? null, {
    title: `Showing booked — ${whenSaid(input.start)}`,
    body: `${lead.name ?? "A prospect"} at ${lead.home}`,
    url: "/leasing",
    tag: `showing:${showingId}`,
  });
  return { ok: true, showingId, manageUrl: `${base}/showing/${manage}` };
}

/**
 * The office (or the prospect) changed what is happening with a showing.
 * Each change has its own next message, and every reminder still pending for
 * it is stood down -- including the ones already handed to Twilio.
 */
export async function changeShowing(
  db: Db, showingId: string, status: "confirmed" | "cancelled" | "shown" | "no_show",
  base: string, opts: { reason?: string; by?: "office" | "prospect" } = {},
) {
  const { data: s } = await db.from("showings")
    .select("id, inquiry_id, contact_id, unit_id, status, scheduled_for").eq("id", showingId).maybeSingle();
  if (!s) throw new Error("no such showing");
  const patch: Record<string, unknown> = { status };
  if (status === "cancelled") {
    patch.cancelled_at = new Date().toISOString();
    patch.cancel_reason = opts.reason ?? (opts.by === "prospect" ? "cancelled by the prospect" : "cancelled");
  }
  if (status === "confirmed") patch.confirmed_prospect_at = new Date().toISOString();
  if (status === "shown") patch.attended = true;
  if (status === "no_show") patch.attended = false;
  await db.from("showings").update(patch).eq("id", showingId);

  if (!s.inquiry_id) return { ok: true };
  const lead = await loadLead(db, s.inquiry_id as string);
  if (!lead) return { ok: true };
  if (s.unit_id) Object.assign(lead, await homeName(db, s.unit_id as string));
  const book = await bookingLink(db, lead.contactId, base);

  if (status === "cancelled" || status === "no_show") {
    await cancelHanded(db, showingId, status === "cancelled" ? "showing cancelled" : "did not come");
    await setStage(db, lead.id, status === "no_show" ? "no_show" : "prequalified");
    if (book) {
      await deliver(db, lead, words(status === "no_show" ? "no_show" : "cancelled",
        wordsFor(lead, base, { bookUrl: book })), `${showingId}:${status}`);
    }
  }
  if (status === "shown") {
    await setStage(db, lead.id, "shown");
    // The day-of reminders have passed by now; the after-showing message is
    // the one still waiting, and it stays.
  }
  return { ok: true };
}

/** "YES" in reply to a reminder confirms the next showing. */
export async function confirmByText(db: Db, contactId: string): Promise<boolean> {
  const { data: s } = await db.from("showings").select("id")
    .eq("contact_id", contactId).eq("status", "booked")
    .gt("scheduled_for", new Date().toISOString())
    .lt("scheduled_for", new Date(Date.now() + 3 * 864e5).toISOString())
    .order("scheduled_for").limit(1).maybeSingle();
  if (!s) return false;
  await db.from("showings").update({
    status: "confirmed", confirmed_prospect_at: new Date().toISOString(),
  }).eq("id", s.id);
  return true;
}

// ------------------------------------------------------------ the runner

/**
 * Send whatever has come due.
 *
 * Called three ways, because this plan's cron fires once a day: by the cron,
 * by anybody opening the leasing screen, and by anybody opening the inbox.
 * claim_followup_run (051) makes sure only one of those is sending at once.
 */
export async function runDue(db: Db, base: string, opts: { budgetMs?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budget = opts.budgetMs ?? 40_000;

  const quiet = quietUntil(now, ZONE);
  if (quiet) return { sent: 0, skipped: 0, deferred: true, until: quiet.toISOString() };

  const { data: due, error } = await db.from("lead_followups")
    .select("id, inquiry_id, showing_id, kind, due_at")
    .eq("state", "scheduled").lte("due_at", now.toISOString())
    .order("due_at").limit(100);
  if (error) return { sent: 0, skipped: 0, error: error.message };

  let sent = 0, skipped = 0;
  for (const f of due ?? []) {
    if (Date.now() - started > budget) break;
    const kind = f.kind as Kind;
    const lead = await loadLead(db, f.inquiry_id as string);
    if (!lead) continue;

    let showingStatus: string | null = null;
    let startAt: string | null = null;
    let manage: string | null = null;
    if (f.showing_id) {
      const { data: s } = await db.from("showings")
        .select("status, scheduled_for, manage_token, unit_id").eq("id", f.showing_id).maybeSingle();
      showingStatus = s?.status ?? null;
      startAt = s?.scheduled_for ?? null;
      manage = s?.manage_token ?? null;
      if (s?.unit_id) Object.assign(lead, await homeName(db, s.unit_id as string));
    }
    const { count: upcoming } = await db.from("showings").select("id", { count: "exact", head: true })
      .eq("contact_id", lead.contactId).in("status", ["booked", "confirmed"])
      .gt("scheduled_for", now.toISOString());

    // A reminder that is due but whose showing has already started is late,
    // and late is wrong: "see you at 2" at 3 o'clock.
    if (SHOWING_KINDS.has(kind) && kind !== "after_showing" && startAt
        && Date.parse(startAt) <= now.getTime()) {
      await db.from("lead_followups").update({ state: "skipped", skipped_reason: "its moment passed" })
        .eq("id", f.id);
      skipped++; continue;
    }

    const verdict = stillDue(kind, {
      stage: lead.stage, outcome: lead.outcome,
      optedOut: false, // asked per channel inside deliver
      showingStatus, hasUpcomingShowing: (upcoming ?? 0) > 0,
    });
    if (!verdict.send) {
      await db.from("lead_followups").update({ state: "skipped", skipped_reason: verdict.reason })
        .eq("id", f.id);
      skipped++; continue;
    }

    await ensurePrescreenToken(db, lead);
    const w = wordsFor(lead, base, {
      bookUrl: await bookingLink(db, lead.contactId, base),
      when: startAt ? whenSaid(startAt) : null,
      manageUrl: manage ? `${base}/showing/${manage}` : null,
    });
    const out = await deliver(db, lead, words(kind, w), `${f.id}`);
    if (out.channel) {
      await db.from("lead_followups").update({
        state: "sent", channel: out.channel, sent_at: new Date().toISOString(),
        provider_id: out.id,
      }).eq("id", f.id);
      sent++;
    } else {
      await db.from("lead_followups").update({ state: "failed", skipped_reason: out.why })
        .eq("id", f.id);
      skipped++;
    }
  }
  return { sent, skipped, more: (due?.length ?? 0) === 100 };
}

/** The claimed version: only runs if nobody else is, and records the result. */
export async function runDueIfFree(db: Db, base: string, staleMinutes = 5) {
  const { data: mine, error } = await db.rpc("claim_followup_run", { p_stale: staleMinutes, p_dead: 3 });
  if (error) return { ran: false, needs: "Run migration 051 so follow-ups can go out." };
  if (mine !== true) return { ran: false };
  try {
    const r = await runDue(db, base);
    await db.from("followup_runs").update({
      finished_at: new Date().toISOString(), sent: r.sent ?? 0, error: r.error ?? null,
    }).eq("id", true);
    return { ran: true, ...r };
  } catch (e) {
    await db.from("followup_runs").update({
      finished_at: new Date().toISOString(), error: (e as Error).message,
    }).eq("id", true);
    return { ran: true, error: (e as Error).message };
  }
}

// ------------------------------------------------------------ showing times


export async function loadHours(db: Db): Promise<{ hours: Hours[]; rules: Rules; ready: boolean }> {
  const [{ data: h, error }, { data: r }] = await Promise.all([
    db.from("showing_hours").select("weekday, starts, ends").order("weekday"),
    db.from("showing_rules").select("slot_minutes, notice_minutes, horizon_days, at_once").maybeSingle(),
  ]);
  return {
    ready: !error,
    hours: (h ?? []).map((x) => ({ weekday: x.weekday as number,
      starts: String(x.starts).slice(0, 5), ends: String(x.ends).slice(0, 5) })),
    rules: r ? { slotMinutes: r.slot_minutes, noticeMinutes: r.notice_minutes,
                 horizonDays: r.horizon_days, atOnce: r.at_once } : DEFAULT_RULES,
  };
}

/** Every open start time, against what is already on the calendar. */
export async function loadSlots(db: Db, now = new Date()): Promise<{ slots: Slot[]; rules: Rules; ready: boolean }> {
  const { hours, rules, ready } = await loadHours(db);
  const { data: busy } = await db.from("showings").select("scheduled_for, ends_at")
    .in("status", ["booked", "confirmed"])
    .gte("scheduled_for", new Date(now.getTime() - 4 * 3600_000).toISOString());
  const slots = openSlots(hours, rules,
    (busy ?? []).map((b) => ({ start: b.scheduled_for as string, end: (b.ends_at as string | null) ?? null })),
    now, ZONE);
  return { slots, rules, ready };
}
