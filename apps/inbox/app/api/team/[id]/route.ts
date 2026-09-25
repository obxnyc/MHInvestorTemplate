import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { pushToStaff } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One thread. Read through the signed-in user's client, so the policy decides
 *  whether they are in it -- this route never has to ask the question twice. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { data: messages, error } = await supabase
    .from("dm_messages")
    .select("id, body, created_at, staff:author_id(full_name)")
    .eq("thread_id", id).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

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
    messages: (messages ?? []).map((m) => ({
      id: m.id, body: m.body, at: m.created_at,
      who: (m.staff as unknown as { full_name: string } | null)?.full_name ?? "Someone",
    })),
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { body } = await req.json();
  if (!String(body ?? "").trim()) {
    return NextResponse.json({ error: "nothing to send" }, { status: 400 });
  }

  // Membership is checked by reading the thread as this person: if the policy
  // will not show it to them, they may not post to it either.
  const supabase = await supabaseServer();
  const { data: thread } = await supabase
    .from("dm_threads").select("id").eq("id", id).maybeSingle();
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });

  const db = supabaseAdmin();
  const { error } = await db.from("dm_messages")
    .insert({ thread_id: id, author_id: me.id, body: String(body).trim() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("dm_threads")
    .update({ last_at: new Date().toISOString() }).eq("id", id);

  const { data: members } = await db
    .from("dm_members").select("staff_id").eq("thread_id", id);
  await pushToStaff(
    (members ?? []).map((m) => m.staff_id).filter((s) => s !== me.id),
    {
      title: me.full_name,
      body: String(body).slice(0, 140),
      url: `/team?t=${id}`,
      tag: `dm:${id}`,
    },
  );

  return NextResponse.json({ ok: true });
}
