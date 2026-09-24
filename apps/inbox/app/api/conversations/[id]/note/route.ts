import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { pushToStaff } from "@/lib/push";

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

  // @mentions turn notes from a filing cabinet into coordination: name someone
  // and their phone buzzes.
  const handles = [...body.matchAll(/@([a-z0-9._-]+)/gi)].map((m) => m[1].toLowerCase());
  let mentioned: string[] = [];
  if (handles.length) {
    const { data: all } = await supabase.from("staff").select("id, full_name").eq("active", true);
    mentioned = (all ?? []).filter((s) => {
      const first = s.full_name.split(" ")[0].toLowerCase();
      return handles.includes(first) || handles.includes(s.full_name.toLowerCase().replace(/\s+/g, "."));
    }).map((s) => s.id);
  }

  const { error } = await supabase.from("notes")
    .insert({ conversation_id: id, author_id: staff.id, body, mentions: mentioned });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (mentioned.length) {
    await pushToStaff(mentioned.filter((m) => m !== staff.id), {
      title: `${staff.full_name} mentioned you`,
      body: body.slice(0, 140),
      url: `/c/${id}`,
      tag: `note:${id}`,
    });
  }
  return NextResponse.json({ ok: true });
}
