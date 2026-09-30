import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { twilioClient, publicBase, toMsgStatus } from "@/lib/twilio";
import { fromEnglish } from "@/lib/translate";
import { signMedia, belongsToConversation, pathIsSendable, nameOf } from "@/lib/media";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Attribution comes from the session, never from the request body. A client
  // that could name its own author would make the audit trail worthless.
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { body, media } = await req.json() as { body?: string; media?: unknown };

  // Paths come back from the attach route, which means they come back through
  // a browser, which means they are not to be believed. Each is checked
  // against THIS conversation: without that, a signed-in person could reply to
  // their own thread while naming another conversation's folder and have our
  // own number text them somebody else's photographs.
  const wanted = Array.isArray(media) ? media.filter((m): m is string => typeof m === "string") : [];
  const paths = wanted.filter((p) => belongsToConversation(p, id));
  if (paths.length !== wanted.length) {
    return NextResponse.json({ error: "that attachment isn't this conversation's" }, { status: 400 });
  }
  if (paths.length > 10) {
    return NextResponse.json({ error: "ten attachments at most" }, { status: 400 });
  }

  // Refused here rather than handed to Twilio, because Twilio accepts a
  // spreadsheet, bills for it, and the carrier drops it somewhere the tenant
  // never sees -- which looks to everyone involved like a message that was
  // sent. The composer already knows this and greys the send button; this is
  // the check that does not depend on the browser being honest.
  const unsendable = paths.filter((p) => !pathIsSendable(p));
  if (unsendable.length) {
    return NextResponse.json({
      error: `A phone can't receive ${unsendable.map(nameOf).join(", ")}.`
        + " Put it on a Note instead, or send it as a PDF.",
    }, { status: 400 });
  }

  // A picture on its own is a whole message. Requiring text alongside it would
  // be this app insisting on something the tenant's phone does not.
  if (!body?.trim() && !paths.length) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  // Reading through the user's client means RLS decides whether they may see
  // this thread at all -- authorization we get for free rather than re-check.
  const { data: convo } = await supabase
    .from("conversations").select("id, contact_id, contacts(phone, language)").eq("id", id).single();
  if (!convo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const person = convo.contacts as unknown as { phone: string; language: string | null };
  const to = person.phone;

  // Sent in the language they read. The English stays as what was typed, and
  // the wire body is what they actually received -- so the thread shows both
  // and neither is a reconstruction.
  //
  // A failed translation falls back to English rather than silently not
  // sending. A worse message that arrives beats a perfect one that does not.
  const text = body?.trim() ? body : "";
  const translated = text && person.language && person.language !== "en"
    ? await fromEnglish(text, person.language)
    : null;
  const wire = translated ?? text;

  // Signed long enough for Twilio to come and fetch them, and no longer.
  // Twilio takes its own copy at send time, so these links have one job and
  // fifteen minutes to do it -- rather than being a URL to our tenants'
  // kitchens that keeps working for an hour in somebody's logs.
  const links: string[] = [];
  if (paths.length) {
    const signed = await signMedia(supabaseAdmin(), paths, 900);
    for (const p of paths) {
      const url = signed.get(p);
      if (url) links.push(url);
      else console.error("could not sign an attachment for sending", { id, path: p });
    }
    if (!links.length) {
      return NextResponse.json({
        error: "We couldn't hand the picture to the carrier. Nothing was sent.",
      }, { status: 500 });
    }
  }

  let sid: string | null = null;
  let status = "queued";
  try {
    const sent = await twilioClient().messages.create({
      to,
      body: wire,
      // Omitted entirely when there is nothing to send: an empty array is a
      // different request to Twilio than no array at all, and the empty one
      // turns a plain text into an MMS that some carriers charge for and
      // some simply drop.
      ...(links.length ? { mediaUrl: links } : {}),
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      statusCallback: `${publicBase(req)}/api/twilio/status`,
    });
    sid = sent.sid;
    status = toMsgStatus(sent.status);
  } catch (e) {
    // Record the attempt anyway. A message that failed to send is exactly the
    // thing the next person needs to see when they pick up the thread.
    status = "failed";
    console.error("twilio send failed", e);
  }

  const db = supabaseAdmin();
  const { error: writeError } = await db.from("messages").insert({
    conversation_id: id,
    direction: "outbound",
    body: wire,
    body_en: translated ? text : null,
    media_paths: paths,
    lang: translated ? person.language : null,
    twilio_sid: sid,
    status,
    sent_by: staff.id,
  });
  // Checked, and loudly. This insert failed silently for a day: the text went
  // out, the preview below updated because it is a separate statement, and the
  // thread showed the tenant's half of the conversation and none of ours.
  if (writeError) {
    console.error("reply written to the carrier but not to the thread", writeError);
    return NextResponse.json({
      ok: false, status: "unrecorded",
      error: "It went out, but we couldn't write it to the thread. Tell somebody —"
        + " the tenant has it and the record does not.",
    }, { status: 500 });
  }

  // A photograph with no caption still has to say something in the list, or
  // the thread reads as though nothing happened.
  const preview = text
    ? text.slice(0, 160)
    : `📷 ${paths.length} attachment${paths.length === 1 ? "" : "s"}`;

  await db.from("conversations")
    .update({ last_message_at: new Date().toISOString(),
              last_message_preview: preview })
    .eq("id", id);

  return NextResponse.json({
    ok: status !== "failed", status,
    translatedInto: translated ? person.language : null,
  });
}
