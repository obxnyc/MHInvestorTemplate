import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your threads, and everyone you could start one with. */
export async function GET() {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const supabase = await supabaseServer();
  const [{ data: mine }, { data: colleagues }] = await Promise.all([
    supabase.from("dm_members")
      .select("last_read_at, thread:thread_id(id, title, last_at, dm_members(staff:staff_id(id, full_name)), dm_messages(body, created_at, author_id))")
      .eq("staff_id", me.id),
    supabase.from("staff").select("id, full_name, role").eq("active", true).order("full_name"),
  ]);

  const threads = (mine ?? []).map((row) => {
    const t = row.thread as unknown as {
      id: string; title: string | null; last_at: string;
      dm_members: { staff: { id: string; full_name: string } | null }[];
      dm_messages: { body: string; created_at: string; author_id: string | null }[];
    };
    const others = (t.dm_members ?? [])
      .map((m) => m.staff).filter((s): s is { id: string; full_name: string } =>
        Boolean(s) && s!.id !== me.id);
    const last = (t.dm_messages ?? [])
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return {
      id: t.id,
      title: t.title ?? (others.map((o) => o.full_name).join(", ") || "Just you"),
      lastAt: t.last_at,
      preview: last?.body ?? null,
      // Unread if somebody else has said something since you last looked.
      unread: Boolean(last && last.author_id !== me.id
        && (!row.last_read_at || last.created_at > row.last_read_at)),
    };
  }).sort((a, b) => b.lastAt.localeCompare(a.lastAt));

  return NextResponse.json({
    me: me.id,
    threads,
    colleagues: (colleagues ?? []).filter((c) => c.id !== me.id),
  });
}

/** Start a thread with somebody, or return the one that already exists.
 *
 *  Reusing the existing one matters: two threads with the same person means
 *  half your history is in the one you are not looking at. */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { staffId } = await req.json();
  if (typeof staffId !== "string" || staffId === me.id) {
    return NextResponse.json({ error: "pick somebody" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: other } = await db
    .from("staff").select("id, active").eq("id", staffId).maybeSingle();
  if (!other?.active) {
    return NextResponse.json({ error: "that person is not here any more" }, { status: 400 });
  }

  // An existing one-to-one with exactly these two and no title.
  const { data: mine } = await db
    .from("dm_members").select("thread_id").eq("staff_id", me.id);
  const { data: theirs } = await db
    .from("dm_members").select("thread_id").eq("staff_id", staffId);
  const shared = new Set((theirs ?? []).map((t) => t.thread_id));
  const candidates = (mine ?? []).map((t) => t.thread_id).filter((id) => shared.has(id));

  for (const id of candidates) {
    const { count } = await db.from("dm_members")
      .select("staff_id", { count: "exact", head: true }).eq("thread_id", id);
    const { data: thread } = await db
      .from("dm_threads").select("title").eq("id", id).maybeSingle();
    if (count === 2 && !thread?.title) {
      return NextResponse.json({ ok: true, id });
    }
  }

  const { data: made, error } = await db.from("dm_threads")
    .insert({ created_by: me.id }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("dm_members").insert([
    { thread_id: made.id, staff_id: me.id, last_read_at: new Date().toISOString() },
    { thread_id: made.id, staff_id: staffId },
  ]);

  return NextResponse.json({ ok: true, id: made.id });
}
