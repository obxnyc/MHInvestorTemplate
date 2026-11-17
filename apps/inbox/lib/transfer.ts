import { supabaseAdmin } from "./supabase-admin";
import { twilioClient } from "./twilio";
import { loadRoute, loadPerson, routeNow, callSettings } from "./voice";
import type { Target } from "./transfer-words";
export type { Target };
import { isOpen } from "./hours";

/**
 * A straight hand-off: the caller's leg is pointed at new instructions, which
 * ends the conversation they are in -- the person transferring is dropped --
 * and rings whoever was chosen, who hears "Transferred" and what the call is.
 *
 * Used by the Transfer button on the Calls page and by a text to the office
 * line from the phone that is on the call. Nothing is reported as done until
 * Twilio has taken it.
 */

export type Outcome = { ok: true; to: string } | { ok: false; error: string; status: number };

export async function transferCall(callId: string, target: Target, origin: string): Promise<Outcome> {
  const db = supabaseAdmin();
  const { data: call } = await db.from("calls")
    .select("id, twilio_call_sid, route_key, ended_at").eq("id", callId).maybeSingle();
  if (!call?.twilio_call_sid) return { ok: false, error: "No such call.", status: 404 };
  if (call.ended_at) return { ok: false, error: "That call has already ended.", status: 409 };

  const q = new URLSearchParams();
  let to = "";
  if ("personId" in target) {
    const p = await loadPerson(target.personId);
    if (!p) return { ok: false, error: "That person is not on the phone list.", status: 400 };
    q.set("p", p.id);
    to = p.name;
    if (call.route_key) q.set("r", call.route_key);
  } else {
    const r = await loadRoute(target.routeKey);
    if (!r) return { ok: false, error: "No such team.", status: 400 };
    const { group } = routeNow(r, isOpen(await callSettings()));
    const g = group ?? r.dayGroup;
    if (!g) return { ok: false, error: `Nobody rings for ${r.category} right now.`, status: 400 };
    q.set("g", g);
    q.set("r", r.key);
    to = r.category;
  }

  const base = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "") || origin;
  try {
    const client = twilioClient();
    const leg = await client.calls(call.twilio_call_sid).fetch();
    if (leg.status !== "in-progress") {
      await db.from("calls").update({ ended_at: new Date().toISOString() }).eq("id", call.id);
      return { ok: false, error: "That call has already ended.", status: 409 };
    }
    await client.calls(call.twilio_call_sid).update({
      url: `${base}/api/twilio/voice/transfer?${q.toString()}`,
      method: "POST",
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Twilio would not move the call: ${why}`, status: 502 };
  }
  return { ok: true, to };
}
