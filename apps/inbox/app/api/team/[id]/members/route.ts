import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { pushToStaff } from "@/lib/push";

export const runtime = "nodejs";

/** Who is in a working group.
 *
 *  Anybody already in it can add or remove, because these are small groups
 *  formed around a job -- route that through an admin and they stop being
 *  formed at all. What is not allowed is the quiet version: joining and leaving
 *  are written into the thread, so nobody finds out three weeks later that
 *  somebody has been reading along.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { add, remove } = await req.json();

  // Membership is proved by actually being a member -- not by being able to
  // read it. Somebody with oversight can see these threads; that does not make
  // the group theirs to reorganise.
  const supabase = await supabaseServer();
  const { data: mine } = await supabase
    .from("dm_members").select("staff_id")
    .eq("thread_id", id).eq("staff_id", me.id).maybeSingle();
  if (!mine) return NextResponse.json({ error: "not your thread" }, { status: 403 });

  const db = supabaseAdmin();

  if (typeof add === "string") {
    const { data: person } = await db
      .from("staff").select("id, full_name, active").eq("id", add).maybeSingle();
    if (!person?.active) {
      return NextResponse.json({ error: "that person is not here" }, { status: 400 });
    }
    await db.from("dm_members")
      .upsert({ thread_id: id, staff_id: add }, { onConflict: "thread_id,staff_id" });
    await db.from("dm_messages").insert({
      thread_id: id, author_id: null,
      body: `${me.full_name} added ${person.full_name}`,
    });
    await pushToStaff([add], {
      title: `${me.full_name} added you to a group`,
      body: "Tap to open", url: `/team?t=${id}`, tag: `dm:${id}`,
    });
  }

  if (typeof remove === "string") {
    const { data: person } = await db
      .from("staff").select("full_name").eq("id", remove).maybeSingle();
    await db.from("dm_members").delete().eq("thread_id", id).eq("staff_id", remove);
    await db.from("dm_messages").insert({
      thread_id: id, author_id: null,
      body: remove === me.id
        ? `${me.full_name} left`
        : `${me.full_name} removed ${person?.full_name ?? "someone"}`,
    });
  }

  await db.from("dm_threads").update({ last_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ ok: true });
}
