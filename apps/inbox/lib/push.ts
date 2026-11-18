import webpush from "web-push";
import { supabaseAdmin } from "./supabase-admin";
import { DESK } from "./roles";

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:office@larabeehomesllc.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

export type Push = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  /** Keeps the notification in the shade and buzzes harder. Android only. */
  urgent?: boolean;
  /** Enables acting from the shade. Needed by the claim/close actions. */
  conversationId?: string;
  /** Up to two. Chrome/Android renders them; iOS ignores the array. */
  actions?: { action: "claim" | "close"; title: string }[];
};

/** The two buttons a maintenance push should carry on Android. Harmless
 *  everywhere else — iOS drops them and the notification still opens the
 *  thread when tapped. */
export const CLAIM_ACTIONS: Push["actions"] = [
  { action: "claim", title: "I've got it" },
  { action: "close", title: "Already done" },
];

/**
 * Notify specific people. Endpoints die when someone reinstalls or clears the
 * browser, and the push service answers 404/410 for those -- delete rather than
 * retry, or the dead rows accumulate forever and every send gets slower.
 */
/** Returns how many devices took it, so a caller that keeps a record can say
 *  "delivered" only when something was. Existing callers ignore it. */
export async function pushToStaff(staffIds: string[], payload: Push): Promise<number> {
  if (!staffIds.length) return 0;
  if (!process.env.VAPID_PRIVATE_KEY) return 0; // push not configured yet
  configure();

  const db = supabaseAdmin();

  /* A PRIVATE CONVERSATION'S NEWS GOES ONLY TO ITS PEOPLE.
     The notification carries the first words of the message, so sending it
     to somebody the conversation is hidden from would tell them exactly
     what the privacy is for. Filtered here, in the one function every push
     goes through, rather than in each of the eight places that send one. */
  if (payload.conversationId) {
    staffIds = await mayHear(db, payload.conversationId, staffIds);
    if (!staffIds.length) return 0;
  }
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("staff_id", staffIds);
  if (!subs?.length) return 0;

  const dead: string[] = [];
  let took = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      );
      took++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.id);
      else console.error("push failed", code);
    }
  }));

  if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);
  return took;
}

/** Of these people, the ones a conversation is not hidden from: everyone
 *  when it is not private, otherwise its own people and whoever reads
 *  everything (072). */
export async function mayHear(
  db: ReturnType<typeof supabaseAdmin>, conversationId: string, ids: string[],
): Promise<string[]> {
  const { data: convo } = await db.from("conversations")
    .select("private_to").eq("id", conversationId).maybeSingle();
  const only = (convo as { private_to?: string[] | null } | null)?.private_to ?? null;
  if (!only?.length) return ids;
  const { data: readers } = await db.from("staff")
    .select("id").eq("active", true).eq("reads_all_dms", true);
  const allowed = new Set([...only, ...(readers ?? []).map((r) => r.id as string)]);
  return ids.filter((id) => allowed.has(id));
}

/** Everyone on the team that owns this conversation, minus the person who
 *  caused the event -- nobody needs their own action pushed back at them. */
export async function pushToTeam(
  teamId: string | null, payload: Push, exceptStaffId?: string | null,
) {
  const db = supabaseAdmin();
  let ids: string[] = [];

  if (teamId) {
    const { data } = await db.from("team_members").select("staff_id").eq("team_id", teamId);
    ids = (data ?? []).map((r) => r.staff_id);
  } else {
    // Unrouted thread: fall back to office staff so it cannot sit unseen.
    const { data } = await db.from("staff")
      .select("id").eq("active", true).in("role", DESK);
    ids = (data ?? []).map((r) => r.id);
  }

  await pushToStaff(ids.filter((id) => id !== exceptStaffId), payload);
}
