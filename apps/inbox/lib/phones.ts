import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";

/**
 * Whose phone a clock-in came from (056).
 *
 * "A buddy clocking him in with his PIN while the buddy is at the job." The
 * phone is the thing a buddy cannot lend without being found out: each one
 * carries a long-lived random id in a cookie only this server reads, and
 * every man who clocks in on it is recorded against it. Two men on one phone
 * is the buddy case, and the owner is told who.
 *
 * THE SERVICE ROLE, ON PURPOSE, AND ONLY HERE. The clock route itself writes
 * shifts as the signed-in man so the row policies stay the rule (see
 * clock-screen-check). This register is the opposite case: crew must NOT be
 * able to write it, or a man could forge his own phone history -- so the
 * table grants them nothing, and only this server-side module touches it.
 *
 * A cleared browser or a new handset reads as a new phone. That is a flag
 * for somebody to look at, not a verdict -- which is why it goes to a person
 * and changes nothing about the hours.
 */

export const DEVICE_COOKIE = "lh_dev";
const DEVICE_SHAPE = /^[a-f0-9]{32}$/;

export function deviceOf(req: Request): { id: string; fresh: boolean } {
  const raw = (req.headers.get("cookie") ?? "").split(/;\s*/)
    .find((c) => c.startsWith(`${DEVICE_COOKIE}=`))?.slice(DEVICE_COOKIE.length + 1) ?? "";
  if (DEVICE_SHAPE.test(raw)) return { id: raw, fresh: false };
  return { id: randomBytes(16).toString("hex"), fresh: true };
}

/** Who else has clocked in on this phone lately, whether it is new to this
 *  man -- and then record that he used it. */
export async function phoneFacts(device: string, staffId: string, userAgent: string):
    Promise<{ usedBy: string[]; newPhone: boolean }> {
  try {
    const admin = supabaseAdmin();
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [{ data: onThis }, { data: mine }] = await Promise.all([
      admin.from("staff_devices").select("staff_id").eq("device_id", device).gte("last_seen", since),
      admin.from("staff_devices").select("device_id").eq("staff_id", staffId),
    ]);
    const others = (onThis ?? []).map((r) => String(r.staff_id)).filter((id) => id !== staffId);
    const { data: names } = others.length
      ? await admin.from("staff").select("full_name").in("id", others)
      : { data: [] as { full_name: string | null }[] };
    // A man's first ever clock-in registers his phone; only after that is a
    // different one news.
    const known = (mine ?? []).map((r) => String(r.device_id));
    await admin.from("staff_devices").upsert({
      device_id: device, staff_id: staffId, last_seen: new Date().toISOString(),
      user_agent: userAgent.slice(0, 300),
    }, { onConflict: "device_id,staff_id" });
    return {
      usedBy: (names ?? []).map((n) => String(n.full_name ?? "another crew member")),
      newPhone: known.length > 0 && !known.includes(device),
    };
  } catch (e) {
    // Never undo a clock-in over this: no facts, no flag.
    console.error("phone register failed", e);
    return { usedBy: [], newPhone: false };
  }
}
