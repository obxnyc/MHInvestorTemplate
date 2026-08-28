import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * "Yes, this is still open." Snoozes the closure prompt for another cycle.
 *
 * Requires a note. Saying a thread is still live without saying why is how
 * something stays open for six months with nobody able to explain it — and for
 * a tenant conversation, that note is exactly what makes the thread eligible to
 * lapse quietly later instead of nagging forever.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { note, days = 7 } = await req.json().catch(() => ({}));
  if (!note?.trim()) {
    return NextResponse.json(
      { error: "note_required", message: "Say what's still outstanding." },
      { status: 400 },
    );
  }

  const supabase = await supabaseServer();
  const { data: convo } = await supabase
    .from("conversations").select("id").eq("id", id).single();
  if (!convo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const db = supabaseAdmin();
  await db.from("notes").insert({
    conversation_id: id, author_id: staff.id,
    body: `Still open: ${note.trim()}`,
  });

  const until = new Date(Date.now() + Number(days) * 864e5).toISOString();
  const { error } = await db.from("conversations")
    .update({ snooze_until: until })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, snoozedUntil: until });
}
