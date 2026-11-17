import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkTwilioSignature, formToObject, publicBase } from "@/lib/twilio";
import { ringStages, loadPerson, loadRoute, twiml, escapeXml, callSettings, type Stage } from "@/lib/voice";
import { callBySid, contactOf, noAnswer, whoCalled } from "@/lib/calllog";
import { pushToStaff } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ringing, one rung at a time.
 *
 * The same endpoint both starts a rung and is what Twilio calls when that rung
 * ends, because they are the same question asked twice: who is next. The rung
 * lives in the URL, so no state is kept between calls and a retry cannot ring
 * somebody twice or skip them.
 *
 *   g  the ring group          s  the rung to start from
 *   r  the route (what the call is, for the whisper)
 *   p  one person instead of a group -- a transfer to somebody by name
 *
 * Every phone still has to press 1. A phone that is off or out of signal
 * answers INSTANTLY with its owner's personal voicemail, and without the
 * keypress that mailbox would take the call and the rest of the list would
 * never ring. A mailbox cannot press 1, so it can never win -- which is the
 * whole answer to "it does not ring Hannah".
 *
 * The phone that rings shows the OFFICE number, so whoever picks up knows it
 * is work before they say a word; what kind of work is the whisper.
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
  const db = supabaseAdmin();

  // Arriving from a finished <Dial>. Somebody took it and the conversation is
  // over: write down when, and let the call end.
  if (params.DialCallStatus === "completed" || params.DialCallStatus === "answered") {
    await db.from("calls").update({ ended_at: new Date().toISOString() })
      .eq("twilio_call_sid", params.CallSid);
    return twiml("<Hangup/>");
  }

  let stages: Stage[] = [];
  if (personId) {
    const p = await loadPerson(personId);
    if (p) stages = [{ position: 1, seconds: 20, people: [p] }];
  } else if (groupId) {
    stages = await ringStages(groupId);
  }

  // The first rung from here with anybody on it.
  const stage = stages.find((s) => s.position >= from && s.people.length);
  if (!stage) {
    const call = await callBySid(params.CallSid);
    if (call) await noAnswer(call, await callSettings());
    return twiml(`<Redirect method="POST">${base}/api/twilio/voice/voicemail</Redirect>`);
  }

  const call = await callBySid(params.CallSid);
  const route = routeKey ? await loadRoute(routeKey) : null;

  // The people being rung who use the app see who it is while it rings --
  // the caller ID the phone itself cannot give them, because it shows ours.
  const appUsers = stage.people.map((p) => p.staffId).filter((x): x is string => !!x);
  if (appUsers.length && call) {
    const who = whoCalled(await contactOf(call.contact_id));
    await pushToStaff(appUsers, {
      title: `${transferred ? "Transfer: " : ""}${route?.whisper ?? "Office call"} — ${who}`,
      body: "Ringing your phone now. Press 1 when you pick up.",
      url: "/calls",
      tag: `ring:${call.id}`,
    });
  }

  const q = (extra: Record<string, string>) => {
    const u = new URLSearchParams({ ...extra });
    if (routeKey) u.set("r", routeKey);
    if (transferred) u.set("t", "1");
    return escapeXml(u.toString());
  };
  const next = personId
    ? `${base}/api/twilio/voice/ring?${q({ p: personId, s: String(stage.position + 1) })}`
    : `${base}/api/twilio/voice/ring?${q({ g: groupId, s: String(stage.position + 1) })}`;

  const numbers = stage.people.map((p) =>
    `<Number url="${base}/api/twilio/voice/whisper?${q({ p: p.id })}" method="POST">`
    + `${escapeXml(p.phone)}</Number>`
  ).join("");

  const office = params.Called || params.To || "";
  return twiml(
    `<Dial timeout="${stage.seconds}" answerOnBridge="true"`
    + (office ? ` callerId="${escapeXml(office)}"` : "")
    + ` record="record-from-answer-dual"`
    + ` recordingStatusCallback="${base}/api/twilio/voice/recording?k=call"`
    + ` action="${next}" method="POST">${numbers}</Dial>`
  );
}
