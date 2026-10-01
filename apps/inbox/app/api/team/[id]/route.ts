import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { pushToStaff } from "@/lib/push";
import { signMedia, belongsToThread } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One thread. Read through the signed-in user's client, so the policy decides
 *  whether they are in it -- this route never has to ask the question twice. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  // `media_paths` arrives with migration 027 and is asked for tolerantly: a
  // column that is not there yet must not take the whole thread down with it.
  const read = (cols: string) => supabase
    .from("dm_messages").select(cols).eq("thread_id", id).order("created_at");

  // `media_paths` arrives with migration 027 and is asked for tolerantly: a
  // column that is not there yet must not take the whole thread down with it.
  let got = await read("id, body, created_at, media_paths, staff:author_id(full_name)");
  if (got.error) got = await read("id, body, created_at, staff:author_id(full_name)");
  if (got.error) return NextResponse.json({ error: got.error.message }, { status: 403 });
  const messages = (got.data ?? []) as unknown as {
    id: string; body: string; created_at: string;
    media_paths?: string[] | null; staff: { full_name: string } | null;
  }[];

  // One signing call for the whole thread rather than one per picture: each is
  // a round trip, and a thread with a dozen photos would otherwise spend a
  // second doing nothing else.
  const signed = await signMedia(supabase,
    messages.flatMap((m) => m.media_paths ?? []));

  // Read BEFORE marking myself read below, or my own receipt is always "now"
  // and I appear to have seen a message the instant it arrives.
  const { data: members } = await supabase
    .from("dm_members")
    .select("last_read_at, staff:staff_id(id, full_name)").eq("thread_id", id);

  // Marked read on open, the same rule as the shared inbox.
  await supabaseAdmin().from("dm_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("thread_id", id).eq("staff_id", me.id);

  const mine = (members ?? []).some((m) =>
    (m.staff as unknown as { id: string } | null)?.id === me.id);

  const { data: watchers } = await supabaseAdmin()
    .from("staff").select("full_name").eq("reads_all_dms", true).eq("active", true);

  return NextResponse.json({
    me: me.id,
    // Said on the thread, every time. People write differently when they know,
    // and a tool that watches quietly is one they stop being honest in.
    oversight: (watchers ?? []).map((w) => w.full_name),
    viewingOnly: !mine,
    members: (members ?? []).map((m) => m.staff),
    // When each person last looked. The thread works out per message who had
    // seen it by then, rather than storing a receipt per message per person --
    // which for a group of five and a hundred messages is five hundred rows
    // saying the same thing as five timestamps.
    reads: (members ?? [])
      .filter((m) => m.last_read_at)
      .map((m) => {
        const who = m.staff as unknown as { id: string; full_name: string } | null;
        return who ? { staffId: who.id, name: who.full_name, at: m.last_read_at! } : null;
      })
      .filter((r): r is { staffId: string; name: string; at: string } => r !== null),
    media: Object.fromEntries(signed),
    messages: messages.map((m) => ({
      id: m.id, body: m.body, at: m.created_at,
      media: m.media_paths ?? [],
      who: m.staff?.full_name ?? "Someone",
    })),
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { body, media } = await req.json() as { body?: string; media?: unknown };

  // These paths came back through a browser, which means they are not to be
  // believed. Checked against THIS thread: without it, posting to a thread you
  // are in while naming another thread's folder would copy a colleague's
  // private attachment into a thread they are not in.
  const wanted = Array.isArray(media) ? media.filter((m): m is string => typeof m === "string") : [];
  const paths = wanted.filter((p) => belongsToThread(p, id));
  if (paths.length !== wanted.length) {
    return NextResponse.json({ error: "that attachment isn't this thread's" }, { status: 400 });
  }
  if (paths.length > 10) {
    return NextResponse.json({ error: "ten attachments at most" }, { status: 400 });
  }

  // A screenshot with no words is a whole message.
  const text = String(body ?? "").trim();
  if (!text && !paths.length) {
    return NextResponse.json({ error: "nothing to send" }, { status: 400 });
  }

  // Membership is checked by reading the thread as this person: if the policy
  // will not show it to them, they may not post to it either.
  const supabase = await supabaseServer();
  const { data: thread } = await supabase
    .from("dm_threads").select("id").eq("id", id).maybeSingle();
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });

  const db = supabaseAdmin();
  const row = { thread_id: id, author_id: me.id, body: text };
  // Written with the attachments where the column exists, and without them
  // where 027 has not been run yet. A message that loses its picture is a
  // nuisance; one that refuses to send because of a column nobody has added
  // is somebody's afternoon.
  let lost = false;
  let { error } = await db.from("dm_messages").insert({ ...row, media_paths: paths });
  if (error && missingColumn(error)) {
    lost = paths.length > 0;
    ({ error } = await db.from("dm_messages").insert(row));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("dm_threads")
    .update({ last_at: new Date().toISOString() }).eq("id", id);

  const { data: members } = await db
    .from("dm_members").select("staff_id").eq("thread_id", id);
  await pushToStaff(
    (members ?? []).map((m) => m.staff_id).filter((s) => s !== me.id),
    {
      title: me.full_name,
      body: text.slice(0, 140)
        || `sent ${paths.length} attachment${paths.length === 1 ? "" : "s"}`,
      url: `/team?t=${id}`,
      tag: `dm:${id}`,
    },
  );

  return NextResponse.json({
    ok: true,
    // Said out loud rather than swallowed. Somebody attached a file and only
    // the words were kept; they should hear it from us now, not notice next
    // week.
    warning: lost
      ? "Sent, but without the attachment — migration 027 hasn't been run yet."
      : null,
  });
}

/** The shape Postgres uses to say a column is not there. Matched on the code
 *  as well as the text because the wording has changed between versions. */
function missingColumn(e: { code?: string; message?: string } | null) {
  return !!e && (e.code === "42703" || /column .* does not exist/i.test(e.message ?? ""));
}
