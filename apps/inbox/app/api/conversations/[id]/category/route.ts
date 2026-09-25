import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CATEGORIES, CAT_LABEL, type Category } from "@/lib/category";

export const runtime = "nodejs";

/** Move a thread to where it belongs.
 *
 *  Any member of staff can do this. A miscategorised thread is a mistake
 *  anyone should be able to correct the moment they see it -- making it a
 *  privilege means the person who notices has to find the person who is
 *  allowed, and it stays wrong until they do.
 *
 *  Setting it by hand also pins it: confidence goes to 1, so the "we weren't
 *  sure" banner disappears and nothing later moves it automatically. A human
 *  has looked, and the classifier does not get to argue. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { category } = await req.json();
  if (!CATEGORIES.includes(category as Category)) {
    return NextResponse.json({ error: "unknown category" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: before } = await db
    .from("conversations").select("category").eq("id", id).maybeSingle();
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (before.category === category) return NextResponse.json({ ok: true });

  const { data: team } = await db
    .from("teams").select("id").eq("category", category).maybeSingle();

  const { error } = await db.from("conversations").update({
    category,
    category_confidence: 1,
    team_id: team?.id ?? null,
  }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("notes").insert({
    conversation_id: id,
    author_id: staff.id,
    body: `Moved from ${CAT_LABEL[before.category as Category] ?? before.category}`
      + ` to ${CAT_LABEL[category as Category]}`,
  });

  return NextResponse.json({ ok: true });
}
