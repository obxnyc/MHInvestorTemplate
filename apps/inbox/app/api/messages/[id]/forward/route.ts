import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { twilioClient, publicBase } from "@/lib/twilio";
import { pushToStaff } from "@/lib/push";
import { prettyPhone } from "@/lib/format";
import { jobsLink, openWorkOrder } from "@/lib/dispatch";

export const runtime = "nodejs";

/**
 * Pass a message on to someone who can act on it.
 *
 * The thing being modelled is what already happens on a phone: a tenant texts
 * that a sink is leaking, and somebody screenshots it to the plumber. That
 * screenshot is the part the business loses -- it lives in one person's
 * messages, nobody else knows the plumber was called, and there is no record
 * when the tenant asks a week later.
 *
 * So forwarding sends the same text, and leaves the trail: the recipient's own
 * thread holds what they were sent, the original thread gets a line saying who
 * it went to, and optionally a work order exists to be closed.
 *
 * The work order is optional on purpose. Forwarding a leak to a contractor is
 * dispatching a job; forwarding a prospect's question to the office is just
 * telling someone something. Deciding for the person would make one of those
 * two wrong every time.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { toKind, toId, note, workOrder, dueAt } = await req.json();
  if (toKind !== "staff" && toKind !== "contact") {
    return NextResponse.json({ error: "unknown recipient" }, { status: 400 });
  }
  if (typeof toId !== "string" || !toId) {
    return NextResponse.json({ error: "no recipient" }, { status: 400 });
  }

  // Read through the signed-in user's client: if row-level security will not
  // show them this message, they may not forward it either. Authorization we
  // get for free rather than re-check.
  const supabase = await supabaseServer();
  const { data: msg } = await supabase
    .from("messages")
    .select("id, body, conversation_id, media_paths, conversations(id, category, unit_id, contact_id, contacts(full_name, phone, unit_id))")
    .eq("id", id).single();
  if (!msg) return NextResponse.json({ error: "not found" }, { status: 404 });

  const convo = msg.conversations as unknown as {
    id: string; category: string; unit_id: string | null; contact_id: string;
    contacts: { full_name: string | null; phone: string; unit_id: string | null } | null;
  };
  const from = convo.contacts?.full_name || prettyPhone(convo.contacts?.phone ?? "");

  const db = supabaseAdmin();
  let recipientName = "";
  let sentTo: string | null = null;

  // The job is created before the text goes out, because the text has to carry
  // the link to it. A job with nobody told is recoverable; a text promising a
  // link that does not exist is not.
  let workOrderId: string | null = null;
  let workOrderFailed = false;
  if (workOrder) {
    const made = await openWorkOrder(db, {
      staffId: staff.id,
      message: { id: msg.id, body: msg.body, media_paths: msg.media_paths as string[] | null },
      conversationId: convo.id,
      unitId: convo.unit_id ?? convo.contacts?.unit_id ?? null,
      toKind, toId, note, dueAt,
    });
    if ("error" in made) {
      console.error("work order creation failed", made.error);
      workOrderFailed = true;
    } else {
      workOrderId = made.id;
    }
  }

  if (toKind === "staff") {
    const { data: person } = await db
      .from("staff").select("id, full_name, active").eq("id", toId).single();
    if (!person?.active) {
      return NextResponse.json({ error: "that person is not active" }, { status: 400 });
    }
    recipientName = person.full_name;

    await pushToStaff([person.id], {
      title: `${staff.full_name} forwarded you a message`,
      body: String(msg.body).slice(0, 140),
      url: `/c/${convo.id}`,
      tag: `fwd-${msg.id}`,
      conversationId: convo.id,
    });
  } else {
    const { data: person } = await db
      .from("contacts").select("id, full_name, phone").eq("id", toId).single();
    if (!person?.phone) {
      return NextResponse.json({ error: "that contact has no number" }, { status: 400 });
    }
    recipientName = person.full_name || prettyPhone(person.phone);

    // Quoted, attributed and signed. A contractor who receives a bare
    // "the sink is leaking" has no idea who from, which house, or who asked.
    const link = workOrderId ? await jobsLink(db, person.id, publicBase(req)) : null;
    const text = [
      `Larabee Homes — forwarded by ${staff.full_name}:`,
      ``,
      `"${String(msg.body).trim()}"`,
      ``,
      `— from ${from}`,
      note?.trim() ? `\n${note.trim()}` : "",
      // Only when there is a job. A question sent to a contractor does not need
      // a portal link, and one attached to every text trains people to ignore it.
      link ? `\nYour open jobs: ${link}` : "",
    ].join("\n").trim();

    // Into the vendor's own thread, so their reply comes back into the inbox
    // like any other message rather than to whoever's cell was used.
    let { data: theirThread } = await db
      .from("conversations").select("id")
      .eq("contact_id", person.id).neq("status", "closed").maybeSingle();
    if (!theirThread) {
      const { data } = await db.from("conversations").insert({
        contact_id: person.id,
        category: "vendor",
        category_confidence: 1,
        subject: `Forwarded: ${String(msg.body).slice(0, 60)}`,
      }).select("id").single();
      theirThread = data!;
    }

    let sid: string | null = null;
    let status = "queued";
    try {
      const sent = await twilioClient().messages.create({
        to: person.phone,
        body: text,
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        statusCallback: `${publicBase(req)}/api/twilio/status`,
      });
      sid = sent.sid;
      status = sent.status ?? "queued";
    } catch (e) {
      // Recorded as failed rather than swallowed. Someone has to find out that
      // the plumber was never actually told.
      status = "failed";
      console.error("forward send failed", e);
    }

    await db.from("messages").insert({
      conversation_id: theirThread.id,
      direction: "outbound",
      body: text,
      twilio_sid: sid,
      status,
      sent_by: staff.id,
    });
    await db.from("conversations").update({
      last_message_at: new Date().toISOString(),
      status: "open",
      last_message_preview: text.slice(0, 160),
    }).eq("id", theirThread.id);

    sentTo = theirThread.id;
    if (status === "failed") {
      return NextResponse.json(
        { error: `Could not text ${recipientName}. Nothing was forwarded.` },
        { status: 502 },
      );
    }
  }

  // The line that makes this different from a screenshot: the original thread
  // now says where it went, so the next person to open it knows without asking.
  await db.from("notes").insert({
    conversation_id: convo.id,
    author_id: staff.id,
    body: `Forwarded to ${recipientName}${workOrderId ? " — work order opened" : ""}`
      + (note?.trim() ? `\n${note.trim()}` : ""),
  });

  return NextResponse.json({
    ok: true, recipientName, workOrderId, sentTo,
    ...(workOrderFailed
      ? { error: `${recipientName} was sent the message, but the work order could not be created.` }
      : {}),
  });
}
