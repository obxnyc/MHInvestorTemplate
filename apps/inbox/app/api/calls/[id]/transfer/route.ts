import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { transferCall } from "@/lib/transfer";

export const runtime = "nodejs";

/**
 * The Transfer button on the Calls page.
 *
 *   { personId }  one person, by name
 *   { routeKey }  a team, the way the menu would have rung it
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const { personId, routeKey } = await req.json().catch(() => ({}));
  if (!personId && !routeKey) return NextResponse.json({ error: "Choose who to transfer to." }, { status: 400 });

  const out = await transferCall(id,
    personId ? { personId: String(personId) } : { routeKey: String(routeKey) },
    new URL(req.url).origin);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true, to: out.to });
}
