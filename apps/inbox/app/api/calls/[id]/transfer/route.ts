import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { twilioClient } from "@/lib/twilio";
import { loadRoute, loadPerson, routeNow, callSettings } from "@/lib/voice";
import { isOpen } from "@/lib/hours";

export const runtime = "nodejs";

/**
 * A straight hand-off. The caller's leg is pointed at new instructions, which
 * ends the conversation they are in -- the person transferring is dropped --
 * and rings whoever was chosen, who hears "Transferred" and what the call is.
 *
 *   { personId }  one person, by name
 *   { routeKey }  a team, the way the menu would have rung it
 *
 * Nothing is said to have worked until Twilio says so. A call that already
 * ended, or a leg Twilio no longer knows, is a refusal on screen, not a
 * transfer that silently went nowhere.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const { personId, routeKey } = await req.json().catch(() => ({}));

  const db = supabaseAdmin();
  const { data: call } = await db.from("calls")
    .select("id, twilio_call_sid, route_key, answered_at, ended_at").eq("id", id).maybeSingle();
  if (!call?.twilio_call_sid) return NextResponse.json({ error: "no such call" }, { status: 404 });
  if (call.ended_at) return NextResponse.json({ error: "That call has already ended." }, { status: 409 });

  const q = new URLSearchParams();
  let to = "";
  if (personId) {
    const p = await loadPerson(String(personId));
    if (!p) return NextResponse.json({ error: "That person is not on the phone list." }, { status: 400 });
    q.set("p", p.id);
    to = p.name;
    if (call.route_key) q.set("r", call.route_key);
  } else if (routeKey) {
    const r = await loadRoute(String(routeKey));
    if (!r) return NextResponse.json({ error: "No such team." }, { status: 400 });
    const { group } = routeNow(r, isOpen(await callSettings()));
    const g = group ?? r.dayGroup;
    if (!g) return NextResponse.json({ error: `Nobody rings for ${r.category} right now.` }, { status: 400 });
    q.set("g", g);
    q.set("r", r.key);
    to = r.category;
  } else {
    return NextResponse.json({ error: "Choose who to transfer to." }, { status: 400 });
  }

  const base = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "")
    || new URL(req.url).origin;
  try {
    const leg = await twilioClient().calls(call.twilio_call_sid).fetch();
    if (leg.status !== "in-progress") {
      await db.from("calls").update({ ended_at: new Date().toISOString() }).eq("id", call.id);
      return NextResponse.json({ error: "That call has already ended." }, { status: 409 });
    }
    await twilioClient().calls(call.twilio_call_sid).update({
      url: `${base}/api/twilio/voice/transfer?${q.toString()}`,
      method: "POST",
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Twilio would not move the call: ${why}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, to });
}
