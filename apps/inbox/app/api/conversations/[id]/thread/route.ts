import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { signMedia } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A conversation, as data.
 *
 *  Exists so that opening a thread does not mean loading a page. Everything
 *  here is read through the signed-in user's client, so row-level security
 *  decides what comes back exactly as it does when the same thread is rendered
 *  on the server -- one set of rules, not two that drift. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();

  const { data: convo } = await supabase
    .from("conversations")
    .select("id, category, source, status, category_confidence, closure_prompts, assigned_to, units(label, properties(name, color)), contacts(phone, full_name, party, units(label, properties(name, color))), staff:assigned_to(full_name)")
    .eq("id", id).single();
  if (!convo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [{ data: messages }, { data: notes }] = await Promise.all([
    supabase.from("messages")
      .select("id, direction, body, status, channel, created_at, media_paths, staff:sent_by(full_name)")
      .eq("conversation_id", id).order("created_at"),
    supabase.from("notes")
      .select("id, body, created_at, staff:author_id(full_name)")
      .eq("conversation_id", id).order("created_at"),
  ]);

  // One signing call for the whole thread rather than one per picture: each is
  // a round trip, and a thread with a dozen photos would otherwise spend a
  // second doing nothing else.
  const signed = await signMedia(
    supabase, (messages ?? []).flatMap((m) => (m.media_paths ?? []) as string[]),
  );

  return NextResponse.json({
    convo,
    messages: messages ?? [],
    notes: notes ?? [],
    media: Object.fromEntries(signed),
    me: staff.id,
  });
}
