import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { suggestReplies, draftingConfigured } from "@/lib/suggest";
import { prettyPhone } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Replies worth considering on this thread.
 *
 *  Read through the signed-in user's client, so the same row-level security
 *  that decides who may see this conversation decides whose words get sent to
 *  a model. A route that read with the service role here would quietly widen
 *  who can have a tenant's messages summarised on their behalf. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  // Said before any work is done. Without the key this route can only ever
  // return nothing, and "nothing" has to be distinguishable from "nothing
  // worth saying" or the screen is lying about which.
  if (!draftingConfigured()) {
    return NextResponse.json({ configured: false, replies: [] });
  }

  const { id } = await ctx.params;
  const supabase = await supabaseServer();

  const [{ data: convo }, { data: messages }] = await Promise.all([
    supabase.from("conversations")
      .select("id, category, contacts(full_name, phone)").eq("id", id).maybeSingle(),
    supabase.from("messages")
      .select("direction, body, body_en")
      .eq("conversation_id", id).order("created_at").limit(40),
  ]);
  if (!convo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const who = convo.contacts as unknown as
    { full_name: string | null; phone: string } | null;

  const replies = await suggestReplies(
    (messages ?? []).map((m) => ({
      mine: m.direction === "outbound",
      // The English where we have it. The model reads the conversation to
      // work out what is being asked, and it should read the same words the
      // person looking at the thread is reading.
      body: String(m.body_en ?? m.body ?? ""),
    })).filter((m) => m.body.trim()),
    {
      category: String(convo.category ?? "other"),
      name: who?.full_name || prettyPhone(who?.phone ?? "") || "Them",
    },
  );

  return NextResponse.json({ configured: true, replies });
}
