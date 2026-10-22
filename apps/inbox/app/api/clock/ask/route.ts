import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { officeThread, withWhere, OFFICE_THREAD } from "@/lib/office";
import { sayInThread } from "@/lib/dm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Somebody on the clock needs something.
 *
 *  A part, a key, a dumpster, a question about which unit. It goes to the
 *  office's staff thread -- NOT the shared line, which is the number tenants
 *  text: a crew message arriving there lands in the same queue as a tenant's
 *  and gets answered as if it were one.
 *
 *  The shift is read HERE rather than taken from the request. A line saying
 *  which job somebody is on is worth nothing if the person sending it chose
 *  what it says, and the office reads that line to decide whether to drive
 *  out.
 */
/** Has the office said anything back.
 *
 *  Without this the crew screen is a suggestion box: you send something, the
 *  screen says "Sent", and the answer arrives somewhere you were never told
 *  to look. Which is the same shape as every other silence in this
 *  application -- a thing that worked and a thing that went nowhere look
 *  identical from the chair.
 *
 *  It reports only what is NEWER than the last time this person opened the
 *  thread. "You have 14 messages" on a conversation somebody has read is
 *  noise, and a badge that is always lit is a badge nobody looks at.
 */
export async function GET() {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const supabase = await supabaseServer();
  const { data: mem } = await supabase.from("dm_members")
    .select("last_read_at, thread:thread_id(id, title)").eq("staff_id", me.id);

  const row = (mem ?? []).find((m) => {
    const t = m.thread as unknown as { title: string | null } | null;
    return t?.title === OFFICE_THREAD;
  });
  // Never asked for anything: there is nothing to report, and no thread yet.
  if (!row) return NextResponse.json({ threadId: null, unread: 0, last: null });

  const thread = row.thread as unknown as { id: string };
  const { data: msgs } = await supabase.from("dm_messages")
    .select("body, created_at, author_id").eq("thread_id", thread.id)
    .order("created_at", { ascending: false }).limit(20);

  const seen = row.last_read_at as string | null;
  /* Theirs, not mine, and since I last looked. My own message coming back as
     "the office replied" is the mistake the inbox list made for months. */
  const fresh = (msgs ?? []).filter((m) => m.author_id !== me.id
    && (!seen || (m.created_at as string) > seen));

  return NextResponse.json({
    threadId: thread.id,
    unread: fresh.length,
    last: fresh[0]
      ? { body: String(fresh[0].body ?? "").slice(0, 160), at: fresh[0].created_at }
      : null,
  });
}

export async function POST(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { body } = await req.json() as { body?: unknown };
  const text = String(body ?? "").trim();
  if (!text) return NextResponse.json({ error: "nothing to send" }, { status: 400 });
  if (text.length > 2000) {
    return NextResponse.json({ error: "that is too long to send" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { data: open } = await supabase.from("shifts")
    .select("id, started_at, property_id, properties(name)")
    .eq("staff_id", me.id).is("ended_at", null).maybeSingle();

  const prop = open?.properties as unknown as { name: string } | null;
  const where = open
    ? { property: prop?.name ?? null, startedAt: (open.started_at as string) ?? null }
    : null;

  const db = supabaseAdmin();
  const thread = await officeThread(db, me.id);
  if (!thread) {
    return NextResponse.json(
      { error: "could not open a thread with the office" }, { status: 500 });
  }

  await sayInThread(db, thread.id, me.id, withWhere(text, where));

  /* `desks` is reported so the screen can say WHO this reached. "Sent" with
     nobody at the other end is the same shape as every other silence in this
     application: it looks exactly like success. If no desk role is filled,
     the message is still kept -- it is in a thread, and somebody will see it
     when an account is set up -- but the screen says so rather than implying
     a person is reading. */
  return NextResponse.json({
    ok: true, threadId: thread.id, desks: thread.desks,
    onTheClock: Boolean(open),
  });
}
