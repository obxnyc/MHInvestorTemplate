import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/**
 * Close or reopen a conversation.
 *
 * Closing a THREAD is not the same as finishing the WORK. A tenant can stop
 * texting long before the furnace is fixed, so closing a conversation that
 * still has an open work order attached is refused unless the caller confirms —
 * otherwise the repair quietly falls off everyone's screen.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { reopen = false, force = false } = await req.json().catch(() => ({}));
  const supabase = await supabaseServer();

  // RLS decides whether this person may see the thread at all.
  const { data: convo } = await supabase
    .from("conversations").select("id, status").eq("id", id).single();
  if (!convo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const db = supabaseAdmin();

  if (!reopen && !force) {
    const { data: openWork } = await db
      .from("work_orders")
      .select("id, summary, status")
      .eq("conversation_id", id)
      .not("status", "in", "(done,cancelled)");
    if (openWork?.length) {
      return NextResponse.json({
        error: "open_work_order",
        workOrders: openWork.map((w) => ({ id: w.id, summary: w.summary, status: w.status })),
      }, { status: 409 });
    }
  }

  const { error } = await db.from("conversations")
    .update({
      status: reopen ? "open" : "closed",
      closed_reason: reopen ? null : "manual",
      closed_by: reopen ? null : staff.id,
      closed_at: reopen ? null : new Date().toISOString(),
      // Reopening hands it back to the team pool: whoever had it last is not
      // necessarily the one picking it up again.
      ...(reopen ? { assigned_to: null, claimed_at: null } : {}),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status: reopen ? "open" : "closed" });
}
