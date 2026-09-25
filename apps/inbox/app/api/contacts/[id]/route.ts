import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const PARTIES = new Set([
  "current_tenant", "prospect", "vendor", "tech", "owner", "other",
]);

/** Put a name to a number.
 *
 *  Any member of staff, from inside the conversation. Naming the person you are
 *  talking to is not an administrative act -- it is part of answering them, and
 *  routing it through a separate screen and a separate permission is how a line
 *  ends up full of threads labelled (862) 368-6847 eighteen months later. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { fullName, party, unitId, language } = await req.json();

  const patch: Record<string, unknown> = {};
  if (fullName !== undefined) patch.full_name = String(fullName).trim() || null;
  if (party !== undefined) {
    if (!PARTIES.has(party)) return NextResponse.json({ error: "unknown type" }, { status: 400 });
    patch.party = party;
  }
  // An empty selection means "not at one of our addresses", which is a real
  // answer and has to be storable, not just skippable.
  if (unitId !== undefined) patch.unit_id = unitId || null;
  if (language !== undefined) patch.language = language || null;
  if (!Object.keys(patch).length) return NextResponse.json({ ok: true });

  const db = supabaseAdmin();
  const { error } = await db.from("contacts").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
