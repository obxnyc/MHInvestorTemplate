import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tick a suggested question off, or put it back.
 *
 *  Written through the signed-in user's client, so the same policy that decides
 *  who may read this conversation decides who may mark it -- rather than this
 *  route deciding a second time and eventually disagreeing. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { key, on } = await req.json().catch(() => ({}));
  if (typeof key !== "string" || !key) {
    return NextResponse.json({ error: "which question?" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { data: convo } = await supabase
    .from("conversations").select("asked").eq("id", id).maybeSingle();
  if (!convo) return NextResponse.json({ error: "no such conversation" }, { status: 404 });

  const had: string[] = convo.asked ?? [];
  const next = on === false ? had.filter((k) => k !== key) : [...new Set([...had, key])];

  const { error } = await supabase
    .from("conversations").update({ asked: next }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, asked: next });
}
