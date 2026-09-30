import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Something true about a PLACE.
 *
 *  "The crawl space hatch is behind the skirting on the left" was true before
 *  the text that mentioned it and stays true after that thread is closed.
 *  Filed under the lot, not under whichever conversation happened to surface
 *  it, which is how it gets lost. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { body, pinned } = await req.json().catch(() => ({}));
  const text = String(body ?? "").trim();
  if (!text) return NextResponse.json({ error: "nothing to say" }, { status: 400 });

  const { error } = await supabaseAdmin().from("unit_notes").insert({
    unit_id: id, author_id: me.id, body: text, pinned: pinned === true,
  });
  if (error) {
    return NextResponse.json({
      error: /unit_notes/.test(error.message)
        ? "Run migration 024 — there is nowhere to keep a note about a lot yet."
        : error.message,
    }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
