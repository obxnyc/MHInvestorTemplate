import { supabaseAdmin } from "./supabase-admin";
import { loadRoute, loadPerson, routeNow, callSettings } from "./voice";
import { isOpen } from "./hours";
import { moveCaller, callerStillThere } from "./legs";
import type { Target } from "./transfer-words";
export type { Target };

/**
 * A straight hand-off. The caller is moved out of the conversation and into
 * ringing for whoever was chosen, who hears "Transferred" and what the call
 * is. The person who transferred is let go: from the keypad they are already
 * out of the call; from the Calls page or a text, the conversation ends under
 * them and staff-menu tells their phone "Transferred" and hangs up.
 *
 * Three ways in -- * on the keypad, the Transfer button, a text -- and one
 * way it happens. Nothing is reported as done until Twilio has taken it.
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
    to = r.key === "general" ? "the office line" : r.category;
  }

  if (!(await callerStillThere(call.twilio_call_sid))) {
    await db.from("calls").update({ ended_at: new Date().toISOString() }).eq("id", call.id);
    return { ok: false, error: "That call has already ended.", status: 409 };
  }

  // Let go of the current answerer FIRST, so that when the conversation ends
  // under their phone it is told "Transferred" rather than "the caller hung up".
  await db.from("calls").update({ agent_leg_sid: null }).eq("id", call.id);

  const base = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "") || origin;
  try {
    await moveCaller(call.twilio_call_sid, `${base}/api/twilio/voice/transfer?${q.toString()}`);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Twilio would not move the call: ${why}`, status: 502 };
  }
  return { ok: true, to };
}

/* ---------------------------------------------------------------- the keypad */

type KeyRow = { digit: string; label: string; person_id: string | null; route_key: string | null };

async function keys(): Promise<KeyRow[]> {
  const { data } = await supabaseAdmin().from("transfer_keys")
    .select("digit, label, person_id, route_key").order("digit");
  return (data ?? []) as KeyRow[];
}

/** What the answerer hears after *. Read from transfer_keys, so it always
 *  says exactly the keys that work. */
export async function transferMenu(): Promise<string> {
  const list = await keys();
  const parts = list.map((k) => `${k.label}, press ${k.digit}.`);
  return (parts.length ? `To transfer to ${parts.join(" ")} ` : "")
    + "To go back to the caller, press 0.";
}

export async function transferKey(digit: string): Promise<{ target: Target; label: string } | null> {
  if (!/^[1-9]$/.test(digit)) return null;
  const k = (await keys()).find((x) => x.digit === digit);
  if (!k) return null;
  return k.person_id
    ? { target: { personId: k.person_id }, label: k.label }
    : { target: { routeKey: k.route_key! }, label: k.label };
}
