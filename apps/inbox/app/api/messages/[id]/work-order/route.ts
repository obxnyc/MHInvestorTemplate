import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { twilioClient, publicBase } from "@/lib/twilio";
import { pushToStaff } from "@/lib/push";
import { jobsLink, openWorkOrder, dueLabel } from "@/lib/dispatch";

export const runtime = "nodejs";

/**
 * Turn a message into a job, after the fact.
 *
 * This is the ordinary path rather than the exception. You text the plumber to
 * ask whether a dead water heater is his problem or the electrician's; two
 * conversations happen and at most one of them becomes work. Forcing the
 * decision at the moment of forwarding would mean guessing before you know,
 * and the guesses would be wrong often enough that people stopped opening jobs
 * at all.
 *
 * So any message can become a job whenever it becomes clear that it is one,
 * including a message in the vendor's own thread.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { toKind = null, toId = null, note, dueAt } = await req.json();
  if (toKind !== null && toKind !== "staff" && toKind !== "contact") {
    return NextResponse.json({ error: "unknown assignee" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { data: msg } = await supabase
    .from("messages")
    .select("id, body, media_paths, conversation_id, conversations(id, unit_id, contacts(unit_id))")
    .eq("id", id).single();
  if (!msg) return NextResponse.json({ error: "not found" }, { status: 404 });

  const convo = msg.conversations as unknown as {
    id: string; unit_id: string | null; contacts: { unit_id: string | null } | null;
  };

  const db = supabaseAdmin();
  const made = await openWorkOrder(db, {
    staffId: staff.id,
    message: { id: msg.id, body: msg.body, media_paths: msg.media_paths as string[] | null },
    conversationId: convo.id,
    unitId: convo.unit_id ?? convo.contacts?.unit_id ?? null,
    toKind, toId, note, dueAt,
  });
  if ("error" in made) {
    return NextResponse.json({ error: made.error }, { status: 500 });
  }

  let assignee = "nobody yet";

  if (toKind === "staff" && toId) {
    const { data: person } = await db
      .from("staff").select("id, full_name").eq("id", toId).single();
    assignee = person?.full_name ?? "a colleague";
    await pushToStaff([toId], {
      title: `New job from ${staff.full_name}`,
      body: String(msg.body).slice(0, 140),
      url: `/c/${convo.id}`,
      tag: `wo-${made.id}`,
      conversationId: convo.id,
    });
  }

  if (toKind === "contact" && toId) {
    const { data: person } = await db
      .from("contacts").select("id, full_name, phone").eq("id", toId).single();
    assignee = person?.full_name || "the vendor";

    // Told, not just recorded. A job assigned to someone who does not know
    // about it is a job that does not happen, and the database cannot tell the
    // difference between the two.
    if (person?.phone) {
      const link = await jobsLink(db, person.id, publicBase(req));
      const text = [
        `Larabee Homes — job for you:`,
        ``,
        String(msg.body).trim(),
        dueAt ? `\n${dueLabel(dueAt)}` : "",
        note?.trim() ? `\n${note.trim()}` : "",
        link ? `\nYour open jobs: ${link}` : "",
      ].join("\n").trim();

      try {
        await twilioClient().messages.create({
          to: person.phone, body: text,
          messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
          statusCallback: `${publicBase(req)}/api/twilio/status`,
        });
      } catch (e) {
        console.error("job notification failed", e);
        return NextResponse.json({
          ok: true, workOrderId: made.id, assignee,
          error: `The job was created, but ${assignee} could not be texted.`,
        });
      }
    }
  }

  await db.from("notes").insert({
    conversation_id: convo.id,
    author_id: staff.id,
    body: `Work order opened — ${assignee}`
      + (dueAt ? `, ${dueLabel(dueAt)}` : "")
      + (note?.trim() ? `\n${note.trim()}` : ""),
  });

  return NextResponse.json({ ok: true, workOrderId: made.id, assignee });
}
