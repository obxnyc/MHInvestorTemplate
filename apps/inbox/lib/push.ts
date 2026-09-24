import webpush from "web-push";
import { supabaseAdmin } from "./supabase-admin";

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
export async function pushToStaff(staffIds: string[], payload: Push) {
  if (!staffIds.length) return;
  if (!process.env.VAPID_PRIVATE_KEY) return; // push not configured yet
  configure();

  const db = supabaseAdmin();
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("staff_id", staffIds);
  if (!subs?.length) return;

  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      );
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.id);
      else console.error("push failed", code);
    }
  }));

  if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);
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
      .select("id").eq("active", true).in("role", ["admin", "office"]);
    ids = (data ?? []).map((r) => r.id);
  }

  await pushToStaff(ids.filter((id) => id !== exceptStaffId), payload);
}
