import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkTwilioSignature, formToObject, publicBase } from "@/lib/twilio";
import { ringStages, loadPerson, loadRoute, twiml, callSettings, type Stage } from "@/lib/voice";
import { callBySid, contactOf, noAnswer, whoCalled } from "@/lib/calllog";
import { nextRound, ringPeople, stopRinging, callerTwiml } from "@/lib/legs";
import { pushToStaff } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ringing, one rung at a time, on the CALLER's leg.
 *
 *   g  the ring group          s  the rung to start from
 *   r  the route (what the call is, for the whisper)
 *   p  one person instead of a group -- a transfer to somebody by name
 *   t  this is a transfer      n  the round of ringing this belongs to
 *
 * Each rung starts the phones that are new on it, as calls of their own, and
 * plays the caller an ordinary ringing tone for the rung's length; then this
 * route is asked again for the next rung. A phone started on rung one is
 * still ringing on rung three -- its call was placed for all the time left,
 * not for its own twelve seconds -- so Hannah keeps ringing while Samantha
 * and Cade are added beside her.
 *
 * Whoever presses 1 first takes the caller out of this ringing and into the
 * conversation (see whisper/accept). If nobody does, the last rung ends here:
 * every phone still ringing is stopped and the caller goes to voicemail.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = formToObject(raw);
  const sig = checkTwilioSignature(req, `/api/twilio/voice/ring${url.search}`, params);
  if (!sig.ok) return new NextResponse(sig.reason, { status: sig.status });

  const base = publicBase(req);
  const groupId = url.searchParams.get("g") ?? "";
  const personId = url.searchParams.get("p") ?? "";
  const routeKey = url.searchParams.get("r") ?? "";
  const transferred = url.searchParams.get("t") === "1";
  const from = Math.max(1, Number(url.searchParams.get("s") ?? "1"));

  const call = await callBySid(params.CallSid);
  if (!call) return twiml(`<Redirect method="POST">${base}/api/twilio/voice/voicemail</Redirect>`);

  // The first rung starts a round; the rest carry its number.
  const round = url.searchParams.get("n")
    ? Number(url.searchParams.get("n"))
    : await nextRound(call.id);

  // Somebody already took it in this round: the caller belongs in the call.
  const { data: state } = await supabaseAdmin().from("calls")
    .select("claimed_round, line").eq("id", call.id).single();
  if (state?.claimed_round === round) return twiml(callerTwiml(base, call.id));

  let stages: Stage[] = [];
  if (personId) {
    const p = await loadPerson(personId);
    if (p) stages = [{ position: 1, seconds: 20, people: [p] }];
  } else if (groupId) {
    stages = await ringStages(groupId);
  }

  const idx = stages.findIndex((s) => s.position >= from && s.people.length);
  if (idx < 0) {
    await stopRinging(call.id, round);
    await noAnswer(call, await callSettings());
    return twiml(`<Redirect method="POST">${base}/api/twilio/voice/voicemail</Redirect>`);
  }
  const stage = stages[idx];
  const left = stages.slice(idx).reduce((sum, s) => sum + s.seconds, 0);
  const route = routeKey ? await loadRoute(routeKey) : null;

  const started = await ringPeople({
    callId: call.id, round, people: stage.people, seconds: left,
    line: state?.line ?? params.To ?? "", base, routeKey: routeKey || null, transferred,
  });

  // The people being rung who use the app see who it is while it rings.
  const appUsers = stage.people.map((p) => p.staffId).filter((x): x is string => !!x);
  if (started && appUsers.length) {
    const who = whoCalled(await contactOf(call.contact_id));
    await pushToStaff(appUsers, {
      title: `${transferred ? "Transfer: " : ""}${route?.whisper ?? "Office call"} — ${who}`,
      body: "Ringing your phone now. Press 1 when you pick up.",
      url: "/calls",
      tag: `ring:${call.id}`,
    });
  }

  const q = new URLSearchParams({ s: String(stage.position + 1), n: String(round) });
  if (personId) q.set("p", personId); else q.set("g", groupId);
  if (routeKey) q.set("r", routeKey);
  if (transferred) q.set("t", "1");

  // The ring tone is six seconds a cycle.
  return twiml(
    `<Play loop="${Math.max(1, Math.round(stage.seconds / 6))}">${base}/ringback.wav</Play>`
    + `<Redirect method="POST">${base}/api/twilio/voice/ring?${q.toString().replace(/&/g, "&amp;")}</Redirect>`
  );
}
