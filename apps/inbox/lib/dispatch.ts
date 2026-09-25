import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A contractor will not create an account to send you a photo. Ask a plumber
 *  to set a password and the photo never arrives -- and then the evidence rule
 *  the database enforces becomes a rule everybody routes around, which is worse
 *  than not having it.
 *
 *  So: a long random token, texted once, that opens a page listing only their
 *  jobs. It is a bearer credential and is treated as one -- 32 bytes from a
 *  cryptographic source, never shared between people, revocable by setting it
 *  to null. Minted lazily, so a contact who is never dispatched never has one. */
export async function jobsLink(
  db: SupabaseClient, contactId: string, base: string,
): Promise<string | null> {
  const { data } = await db
    .from("contacts").select("jobs_token").eq("id", contactId).single();

  let token = data?.jobs_token as string | null;
  if (!token) {
    token = randomBytes(32).toString("base64url");
    const { error } = await db
      .from("contacts").update({ jobs_token: token }).eq("id", contactId);
    if (error) return null;
  }
  return `${base}/jobs/${token}`;
}

/** Red once it is late, amber on the day, plain before that.
 *
 *  Deliberately not a countdown in hours. The question being answered down a
 *  list of twenty jobs is "which of these is going wrong", and three states
 *  answer it at a glance where a number has to be read and compared. */
export type DueState = "none" | "later" | "soon" | "late";

export function dueState(dueAt: string | null | undefined, now = new Date()): DueState {
  if (!dueAt) return "none";
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return "none";
  const hours = (due - now.getTime()) / 3_600_000;
  if (hours < 0) return "late";
  if (hours <= 24) return "soon";
  return "later";
}

export function dueLabel(dueAt: string | null | undefined, now = new Date()): string {
  if (!dueAt) return "No date promised";
  const due = new Date(dueAt);
  const hours = (due.getTime() - now.getTime()) / 3_600_000;
  const when = due.toLocaleString("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short",
    day: "numeric", hour: "numeric", minute: "2-digit",
  });
  // "Due Tue, Mar 4, 9:00 AM" is the fact; "2 days late" is the thing that
  // makes someone act on it. Both, because the first is what you tell a tenant.
  if (hours < 0) {
    const late = Math.abs(hours);
    const n = late < 24 ? `${Math.round(late)}h` : `${Math.round(late / 24)}d`;
    return `${n} late — was due ${when}`;
  }
  if (hours <= 24) return `Due ${when}`;
  return `Due ${when}`;
}

/** Open a job from a message.
 *
 *  Shared by forwarding and by promoting a message later, because the second is
 *  the common path: you text a plumber to ask whether a dead water heater is
 *  his or the electrician's, and only one of those conversations becomes a job.
 *  Deciding at the moment of forwarding would make you guess before you know. */
export async function openWorkOrder(
  db: SupabaseClient,
  o: {
    staffId: string;
    message: { id: string; body: string; media_paths?: string[] | null };
    conversationId: string;
    unitId: string | null;
    toKind: "staff" | "contact" | null;
    toId: string | null;
    note?: string | null;
    dueAt?: string | null;
  },
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await db.from("work_orders").insert({
    conversation_id: o.conversationId,
    unit_id: o.unitId,
    summary: String(o.message.body).slice(0, 120),
    detail: o.note?.trim() || null,
    source_message: o.message.id,
    // The photographs the tenant already sent are the "before" half of the
    // evidence pair. Copying them onto the job here means nobody has to
    // remember to, and a job closed with a completion photo has something to
    // be compared against.
    reported_photos: (o.message.media_paths ?? []) as string[],
    created_by: o.staffId,
    due_at: o.dueAt || null,
    assigned_tech: o.toKind === "staff" ? o.toId : null,
    assigned_vendor: o.toKind === "contact" ? o.toId : null,
  }).select("id").single();

  if (error) return { error: error.message };
  return { id: data.id };
}
