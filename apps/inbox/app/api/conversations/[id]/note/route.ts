import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";

export const runtime = "nodejs";

/** Internal note. Never sent anywhere -- this is the "here's what I tried"
 *  that lets the next person pick up without re-asking the tenant. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { body } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: "empty note" }, { status: 400 });

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("notes").insert({ conversation_id: id, author_id: staff.id, body });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
