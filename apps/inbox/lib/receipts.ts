import { supabaseAdmin } from "@/lib/supabase-admin";
import { twilioClient, toMsgStatus } from "@/lib/twilio";

/**
 * Ask Twilio what actually happened to a message we never heard back about.
 *
 * The delivery receipt is a webhook, and a webhook is a thing that can be
 * missed. Ours is missed in a specific, reproducible way: Twilio reports
 * "sent" within about a second of accepting a message, and the sid only exists
 * after the send call returns, so the receipt can arrive before the row it is
 * about. That race is why three messages sat on "Sending" while two others,
 * sent the same afternoon, reported back fine -- a callback that had nobody to
 * belong to and nothing to retry against.
 *
 * The webhook is still the fast path and still the one that normally wins.
 * This is the part that makes the answer eventually true regardless, by asking
 * the question the other way round. Twilio knows; we just never asked.
 *
 * Deliberately not a background job. On this plan a cron runs once a day, and
 * "your message will look sent by tomorrow" is not a fix. It runs when
 * somebody opens the thread, which is exactly when the wrong answer is being
 * read.
 */

/** Outbound and still hopeful. A message that already knows it was delivered,
 *  undelivered or failed is finished and is never asked about again. */
const UNSETTLED = ["queued", "sent"];
/** Below this, silence is normal -- the receipt is probably in flight. */
const GRACE_MS = 90_000;
/** A bound on how much a single thread open can cost. The rest keep until the
 *  next look or the nightly sweep. */
const AT_ONCE = 8;

export type Repair = { checked: number; changed: number };

/**
 * Settle whatever is stuck on one conversation. Cheap when nothing is: one
 * indexed read that usually returns nothing and then does no work at all.
 */
export async function settleConversation(conversationId: string): Promise<Repair> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("messages")
    .select("id, twilio_sid, created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .in("status", UNSETTLED)
    .not("twilio_sid", "is", null)
    .lt("created_at", new Date(Date.now() - GRACE_MS).toISOString())
    .limit(AT_ONCE);

  if (error || !data?.length) return { checked: 0, changed: 0 };
  return settle(data as { id: string; twilio_sid: string }[]);
}

/** Everything stuck anywhere, for the nightly sweep: the threads nobody
 *  opened still ought to tell the truth. */
export async function settleEverything(limit = 100): Promise<Repair> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("messages")
    .select("id, twilio_sid")
    .eq("direction", "outbound")
    .in("status", UNSETTLED)
    .not("twilio_sid", "is", null)
    .lt("created_at", new Date(Date.now() - GRACE_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data?.length) return { checked: 0, changed: 0 };
  return settle(data as { id: string; twilio_sid: string }[]);
}

async function settle(rows: { id: string; twilio_sid: string }[]): Promise<Repair> {
  const db = supabaseAdmin();
  let client: ReturnType<typeof twilioClient>;
  try {
    client = twilioClient();
  } catch {
    // No credentials on this deployment. Nothing to ask.
    return { checked: 0, changed: 0 };
  }

  // In parallel: eight sequential round trips to Twilio would be two seconds
  // of somebody waiting to read a thread.
  const settled = await Promise.all(rows.map(async (row) => {
    try {
      const msg = await client.messages(row.twilio_sid).fetch();
      return {
        id: row.id,
        status: toMsgStatus(msg.status),
        // Twilio's own number for why, kept as text: it is what a search of
        // their error reference is done on.
        errorCode: msg.errorCode === null || msg.errorCode === undefined
          ? null : String(msg.errorCode),
      };
    } catch (e) {
      console.error("could not ask Twilio about", row.twilio_sid, e);
      return null;
    }
  }));

  let changed = 0;
  for (const s of settled) {
    // Still queued at Twilio's end is a real answer, and writing it back would
    // only reset the clock. Only a change is worth a write.
    if (!s || s.status === "queued") continue;
    const { error } = await db.from("messages")
      .update({ status: s.status, error_code: s.errorCode })
      .eq("id", s.id);
    if (!error) changed++;
  }

  if (changed) {
    console.warn(`settled ${changed} message(s) Twilio never reported back on`);
  }
  return { checked: rows.length, changed };
}
