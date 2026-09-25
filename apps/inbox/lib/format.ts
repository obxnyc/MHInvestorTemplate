export function prettyPhone(e164: string) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString("en-US", { timeZone: ZONE });
}

/** Every time in this application is Elizabeth City time.
 *
 *  Not the browser's, and emphatically not the server's -- which is UTC, and
 *  was showing a text sent at 9:02 in the evening as 1:02 AM. A timestamp that
 *  is four hours out is worse than no timestamp: it gets read to a tenant, or
 *  used to argue about when a repair was reported.
 *
 *  Pinned rather than local because the business is in one place. A manager
 *  looking at the inbox from a hotel in Denver needs to see the hour the tenant
 *  meant, not the hour on their own wrist. */
export const ZONE = "America/New_York";

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: ZONE, hour: "numeric", minute: "2-digit",
  });
}

/** The day separator in a thread, in the same zone for the same reason: a
 *  message sent at 9pm must not sit under tomorrow's heading. */
export function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: ZONE, weekday: "long", month: "short", day: "numeric",
  });
}
