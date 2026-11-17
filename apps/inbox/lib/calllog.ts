import { supabaseAdmin } from "./supabase-admin";
import { sendSms } from "./notify";
import { canSmsFromLine } from "./phone";
import { pushToStaff, pushToTeam } from "./push";
import { prettyPhone } from "./format";
import { inLang, asLang, type CallSettings } from "./voice";

/**
 * The call record, from the first ring to the last word.
 *
 * Every webhook in a call's life knows it by Twilio's CallSid. A transferred
 * call and a whisper leg carry the CALLER's sid as ParentCallSid, so every
 * lookup here is by the caller's sid -- one row per phone call however many
 * phones it rang.
 */

export type CallRow = {
  id: string; contact_id: string | null; conversation_id: string | null;
  category: string | null; route_key: string | null; after_hours: boolean | null;
  answered_at: string | null; ended_at: string | null; missed: boolean | null;
  texted: string | null; language: string | null;
};

const CALL_COLS = "id, contact_id, conversation_id, category, route_key, after_hours, answered_at, ended_at, missed, texted, language";

export async function callBySid(sid: string | undefined | null): Promise<CallRow | null> {
  if (!sid) return null;
  const { data } = await supabaseAdmin().from("calls")
    .select(CALL_COLS).eq("twilio_call_sid", sid).maybeSingle();
  return (data as CallRow | null) ?? null;
}

export async function contactOf(contactId: string | null) {
  if (!contactId) return null;
  const { data } = await supabaseAdmin().from("contacts")
    .select("id, phone, full_name").eq("id", contactId).maybeSingle();
  return data;
}

export const whoCalled = (c: { phone: string | null; full_name: string | null } | null) =>
  c?.full_name || prettyPhone(c?.phone ?? "") || "Unknown caller";

/** The caller's open thread, opened if there is none. The same rule the text
 *  line keeps: at most one open conversation per person, so a call, its
 *  voicemail and the text that follows land in one place. */
export async function threadFor(call: CallRow, subject: string): Promise<string | null> {
  if (call.conversation_id) return call.conversation_id;
  if (!call.contact_id) return null;
  const db = supabaseAdmin();
  const { data: open } = await db.from("conversations")
    .select("id").eq("contact_id", call.contact_id).neq("status", "closed").maybeSingle();
  let id = open?.id ?? null;
  if (!id) {
    const { data } = await db.from("conversations").insert({
      contact_id: call.contact_id, category: "other", source: "call",
      subject: subject.slice(0, 70),
    }).select("id").single();
    id = data?.id ?? null;
  }
  if (id) await db.from("calls").update({ conversation_id: id }).eq("id", call.id);
  return id;
}

/** Text the caller from the office line, and put the text in their thread so
 *  whoever opens it next sees what the line already told them. */
export async function textCaller(
  call: CallRow, body: string, kind: "portal" | "homes" | "missed",
): Promise<boolean> {
  const contact = await contactOf(call.contact_id);
  if (!contact?.phone || !canSmsFromLine(contact.phone)) return false;

  const sid = await sendSms(contact.phone, body);
  const db = supabaseAdmin();
  const thread = await threadFor(call, body);
  if (thread) {
    await db.from("messages").insert({
      conversation_id: thread, direction: "outbound", channel: "sms",
      body, twilio_sid: sid, status: sid ? "queued" : "failed",
    });
    await db.from("conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: body.slice(0, 160),
    }).eq("id", thread);
  }
  await db.from("calls").update({
    texted: kind,
    ...(kind === "missed" ? { missed_texted_at: new Date().toISOString() } : {}),
  }).eq("id", call.id);
  return !!sid;
}

export const fill = (template: string, link: string | null) =>
  template.replace("{link}", link ?? "").replace(/\s+/g, " ").trim();

/**
 * Nobody took it.
 *
 * Called when the last rung has rung out, and when a route sends the caller
 * straight to voicemail. Marks the call missed, tells the team at once --
 * before the voicemail has even started -- and sends the missed-call text.
 *
 * A call somebody already answered is not missed: a transfer that rings out
 * reaches here too, and the caller has been spoken to.
 */
export async function noAnswer(call: CallRow, s: CallSettings): Promise<void> {
  if (call.answered_at) return;
  const db = supabaseAdmin();
  await db.from("calls").update({ missed: true }).eq("id", call.id);

  const contact = await contactOf(call.contact_id);
  const who = whoCalled(contact);
  const what = call.category ? ` · ${call.category}` : "";

  // After hours the office is not woken for every call -- the one person who
  // asked to hear about them is told by tellAfterHours. An emergency nobody
  // answered is the exception: that one goes to everybody.
  if (!call.after_hours || call.route_key === "emergency") {
    await pushToTeam(null, {
      title: `Missed call — ${who}${what}`,
      body: call.after_hours ? "After hours. Voicemail may follow." : "Nobody picked up. Voicemail may follow.",
      url: "/calls",
      tag: `missed:${call.id}`,
      urgent: call.route_key === "emergency",
    });
  }

  if (!s.missed_text_on || call.texted) return;

  // One text a day per number. Somebody who rings three times in a row gets
  // one message, not three.
  if (call.contact_id) {
    const since = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
    const { count } = await db.from("calls").select("id", { count: "exact", head: true })
      .eq("contact_id", call.contact_id).gte("missed_texted_at", since);
    if (count) return;
  }
  await textCaller(call, inLang(s, "missed_text", asLang(call.language)), "missed");
}

/** Every call outside office hours goes to the one person who asked to hear
 *  about them, as it happens, so he can ring back on a Saturday. */
export async function tellAfterHours(call: CallRow, s: CallSettings, category: string) {
  if (!s.after_hours_notify) return;
  const contact = await contactOf(call.contact_id);
  await pushToStaff([s.after_hours_notify], {
    title: `After-hours call — ${whoCalled(contact)}`,
    body: `${category}. Open it to call or text them back.`,
    url: "/calls",
    tag: `after:${call.id}`,
    urgent: category === "Emergency",
  });
}
