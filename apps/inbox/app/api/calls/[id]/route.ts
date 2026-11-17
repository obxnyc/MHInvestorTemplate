import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CALL_CATEGORIES } from "@/lib/callcats";

export const runtime = "nodejs";

/** File a call differently, or write a note on it. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const patch: Record<string, string | null> = {};
  if ("category" in body) {
    if (body.category !== null && !(CALL_CATEGORIES as readonly string[]).includes(body.category)) {
      return NextResponse.json({ error: "not a category this line files calls under" }, { status: 400 });
    }
    patch.category = body.category;
  }
  if ("notes" in body) {
    patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 4000) : null;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to change" }, { status: 400 });

  const { error } = await supabaseAdmin().from("calls").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
