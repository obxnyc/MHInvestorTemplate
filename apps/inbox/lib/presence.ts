/**
 * Who is here, worked out from one timestamp and one word.
 *
 * Deliberately not a live socket. A connection that drops when a phone changes
 * cell reports everybody as offline the moment they walk out of the office,
 * which is precisely when knowing where they are matters. A heartbeat and a
 * clock degrade the right way instead: a lost signal reads as "a minute ago",
 * then "idle", then "offline", which is also what actually happened.
 *
 * The thresholds are generous on purpose. Being wrongly shown as away is a
 * small embarrassment that people work around by wiggling the mouse; being
 * wrongly shown as here is somebody waiting on an answer that is not coming.
 */

export type Status = "online" | "idle" | "offline";

/** How often the browser says it is still there. */
export const BEAT_MS = 45_000;
/** No keyboard or mouse for this long and the tab calls itself idle. */
export const IDLE_AFTER_MS = 5 * 60_000;
/** A heartbeat older than this and we have stopped hearing from them at all.
 *  Three missed beats rather than one -- a background tab is throttled by the
 *  browser and a phone on a train misses a couple. */
const HEARD_MS = 2.5 * 60_000;
/** Gone quiet, but recently enough that they are probably still about. */
const LINGER_MS = 12 * 60_000;

export type Beat = {
  lastSeen: string | null;
  /** What the browser last said about itself. */
  presence: string | null;
};

export function statusOf(b: Beat, now = Date.now()): Status {
  if (!b.lastSeen) return "offline";
  const since = now - new Date(b.lastSeen).getTime();
  if (since > LINGER_MS) return "offline";
  // Still beating. Idle is then the tab's own word for itself -- it knows
  // about the keyboard and the server does not.
  if (since <= HEARD_MS) return b.presence === "idle" ? "idle" : "online";
  // The beats stopped but not long ago: a closed laptop, a locked phone.
  return "idle";
}

export const STATUS_LABEL: Record<Status, string> = {
  online: "Online",
  idle: "Away",
  offline: "Offline",
};

/** "just now", "4 minutes ago", "yesterday". Short, because it sits in a list
 *  and the exact second has never once been the question. */
export function since(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const ms = now - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-US",
    { month: "short", day: "numeric", year: "numeric" });
}
