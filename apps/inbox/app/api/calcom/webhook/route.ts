import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSms, sendEmail } from "@/lib/notify";
import { pushToTeam } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cal.com signs the raw body with the webhook secret. Compare in constant
 *  time and against the EXACT bytes received — re-serializing the parsed JSON
 *  changes key order and the signature will never match. */
function verify(raw: string, signature: string | null): boolean {
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  if (!secret) return true;              // unset: accept, for local setup
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(signature), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verify(raw, req.headers.get("x-cal-signature-256"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const evt = JSON.parse(raw);
  if (evt.triggerEvent !== "BOOKING_CREATED") return NextResponse.json({ ok: true });

  const p = evt.payload ?? {};
  const db = supabaseAdmin();
  const submissionId: string | undefined = p.metadata?.submissionId;
  const attendee = (p.attendees ?? [])[0] ?? {};

  // Prefer the id we carried through the booking link; fall back to matching
  // the attendee's email, since a prospect may edit it on Cal.com's form.
  let sub = null as { id: string; contact_id: string; unit_id: string | null } | null;
  if (submissionId) {
    const { data } = await db.from("prequal_submissions")
      .select("id, contact_id, unit_id").eq("id", submissionId).maybeSingle();
    sub = data;
  }
  if (!sub && attendee.email) {
    const { data } = await db.from("prequal_submissions")
      .select("id, contact_id, unit_id, contacts!inner(email)")
      .eq("contacts.email", attendee.email)
      .order("decided_at", { ascending: false }).limit(1).maybeSingle();
    sub = data as never;
  }
  if (!sub) {
    console.warn("calcom: booking with no matching submission", { uid: p.uid });
    return NextResponse.json({ ok: true, unmatched: true });
  }

  const startTime = p.startTime ?? p.start;
  const { data: showing } = await db.from("showings").upsert({
    contact_id: sub.contact_id,
    unit_id: sub.unit_id,
    scheduled_for: startTime,
    external_event_id: p.uid,
    submission_id: sub.id,
    prequalified: true,
  }, { onConflict: "external_event_id" }).select("id").maybeSingle();

  await db.from("prequal_submissions")
    .update({ booking_used_at: new Date().toISOString(), booking_link: p.uid })
    .eq("id", sub.id);

  const { data: unit } = await db.from("units")
    .select("label, properties(name, address)").eq("id", sub.unit_id ?? "").maybeSingle();
  const prop = unit?.properties as unknown as { name: string; address: string | null } | undefined;
  const address = `${prop?.name ?? "the home"}${unit?.label ? ` — ${unit.label}` : ""}`;

  const when = new Date(startTime).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  // Confirm to the prospect...
  const { data: contact } = await db.from("contacts")
    .select("phone, email, full_name").eq("id", sub.contact_id).maybeSingle();
  const forProspect = `Larabee Homes: your showing at ${address} is confirmed for ${when}. `
    + `Reply here if you need to change it.`;
  if (contact?.phone && !contact.phone.startsWith("email:")) await sendSms(contact.phone, forProspect);
  if (contact?.email) await sendEmail(contact.email, `Showing confirmed — ${address}`, forProspect);

  // ...and tell whoever is showing it.
  const { data: team } = await db.from("teams").select("id").eq("category", "prospect").maybeSingle();
  await pushToTeam(team?.id ?? null, {
    title: `Showing booked — ${when}`,
    body: `${contact?.full_name ?? "A prospect"} at ${address}`,
    url: "/showings",
    tag: `showing:${showing?.id ?? p.uid}`,
  });

  return NextResponse.json({ ok: true });
}
