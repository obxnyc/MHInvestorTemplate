import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";

export const runtime = "nodejs";

/** "I've got this." Delegates to claim_conversation(), whose conditional
 *  UPDATE means only one of two simultaneous taps can win. The loser is told
 *  who actually holds it instead of silently taking it from them. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("claim_conversation", { p_conversation: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    return NextResponse.json(
      { ok: false, heldBy: row?.holder_name ?? "someone else" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}

/** Hand it back to the team pool. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("release_conversation", { p_conversation: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
