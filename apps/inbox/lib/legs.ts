import { supabaseAdmin } from "./supabase-admin";
import { twilioClient } from "./twilio";
import type { Person } from "./ringorder";

/**
 * The office's phones, rung as calls of their own.
 *
 * A phone bridged straight to the caller (<Dial><Number>) is deaf to the app
 * once the call is up, so nothing pressed on it can ever transfer anything.
 * So each phone is called separately, and when somebody presses 1 the caller
 * and that phone meet in a conference named for the call -- and the phone's
 * side is a <Dial hangupOnStar>, which is what lets * step out and ask.
 *
 * Every phone rung for a call is a row in call_legs, so the ones still ringing
 * can be stopped the moment somebody takes it.
 */

export const conferenceName = (callId: string) => `call-${callId}`;

/** Start a new round of ringing -- the first ring, or a transfer -- and
 *  return its number. Optimistic: two webhooks starting a round at once get
 *  different numbers, never the same one. */
export async function nextRound(callId: string): Promise<number> {
  const db = supabaseAdmin();
  for (let i = 0; i < 5; i++) {
    const { data } = await db.from("calls").select("round").eq("id", callId).single();
    const was = data?.round ?? 0;
    const { data: moved } = await db.from("calls").update({ round: was + 1 })
      .eq("id", callId).eq("round", was).select("round").maybeSingle();
    if (moved) return moved.round;
  }
  throw new Error("could not start a round of ringing");
}

/** Ring these people for this many seconds, from the office number. */
export async function ringPeople(opts: {
  callId: string; round: number; people: Person[]; seconds: number; line: string;
  base: string; routeKey: string | null; transferred: boolean;
}): Promise<number> {
  const { callId, round, people, seconds, line, base, routeKey, transferred } = opts;
  if (!people.length || !line) return 0;
  const db = supabaseAdmin();
  const client = twilioClient();

  const { data: already } = await db.from("call_legs")
    .select("person_id").eq("call_id", callId).eq("round", round);
  const rung = new Set((already ?? []).map((l) => l.person_id));

  let started = 0;
  for (const p of people) {
    if (rung.has(p.id)) continue;
    const q = new URLSearchParams({ c: callId, p: p.id, n: String(round) });
    if (routeKey) q.set("r", routeKey);
    if (transferred) q.set("t", "1");
    try {
      const leg = await client.calls.create({
        to: p.phone, from: line,
        url: `${base}/api/twilio/voice/whisper?${q.toString()}`, method: "POST",
        timeout: Math.max(5, Math.min(600, Math.round(seconds))),
      });
      await db.from("call_legs").insert({ call_id: callId, round, person_id: p.id, leg_sid: leg.sid });
      started++;
    } catch (e) {
      // One phone that cannot be rung -- a bad number, a carrier refusing --
      // must not stop the others ringing.
      console.error(`could not ring ${p.name}`, e instanceof Error ? e.message : e);
    }
  }
  return started;
}

/** Stop every phone still ringing in this round, except the one that won. */
export async function stopRinging(callId: string, round: number, except?: string) {
  const { data: legs } = await supabaseAdmin().from("call_legs")
    .select("leg_sid").eq("call_id", callId).eq("round", round);
  const client = twilioClient();
  await Promise.all((legs ?? []).filter((l) => l.leg_sid !== except).map(async (l) => {
    // "canceled" stops one still ringing; one already picked up and sitting
    // in its whisper needs "completed". Neither matters for one already over.
    try { await client.calls(l.leg_sid).update({ status: "canceled" }); }
    catch { try { await client.calls(l.leg_sid).update({ status: "completed" }); } catch { /* over */ } }
  }));
}

/** Press 1. Exactly one press can win a round. */
export async function claim(callId: string, round: number): Promise<boolean> {
  const { data } = await supabaseAdmin().from("calls")
    .update({ claimed_round: round })
    .eq("id", callId).eq("round", round)
    .or(`claimed_round.is.null,claimed_round.neq.${round}`)
    .select("id").maybeSingle();
  return !!data;
}

/** The answerer's side: in the conference, with * to step out. */
export function agentTwiml(base: string, callId: string, personId: string): string {
  const q = new URLSearchParams({ c: callId, p: personId }).toString().replace(/&/g, "&amp;");
  return `<Dial hangupOnStar="true" action="${base}/api/twilio/voice/staff-menu?${q}" method="POST">`
    + `<Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false">`
    + `${conferenceName(callId)}</Conference></Dial>`;
}

/** The caller's side. When the caller hangs up, the conference ends and the
 *  answerer's phone is told so, rather than sitting in an empty room. */
export function callerTwiml(base: string, callId: string): string {
  return `<Dial action="${base}/api/twilio/voice/caller-left?c=${callId}" method="POST">`
    + `<Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="true" waitUrl="">`
    + `${conferenceName(callId)}</Conference></Dial>`;
}

/** Point the caller's leg somewhere else: into the conference, on hold, or
 *  into a transfer. Throws if Twilio refuses -- callers decide what to say. */
export async function moveCaller(callerSid: string, url: string) {
  await twilioClient().calls(callerSid).update({ url, method: "POST" });
}

export async function callerStillThere(callerSid: string): Promise<boolean> {
  try {
    const c = await twilioClient().calls(callerSid).fetch();
    return c.status === "in-progress";
  } catch { return false; }
}
