import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Send me another one."
 *
 *  Pressed by somebody who is locked out and holding a dead link. It marks
 *  the invite as waiting; the office sees it on the people page, which is the
 *  page where new links are sent from. The fix and the news of it being
 *  needed are in the same place, which is the only arrangement that gets
 *  acted on.
 *
 *  NOT a message to anybody. A notification needs a recipient, and the whole
 *  problem is that this person has no account and no thread -- inventing one
 *  for them would be a second system to maintain for a fact the invite row
 *  already holds.
 *
 *  Unauthenticated by necessity: whoever presses this cannot sign in. What
 *  guards it is the token, which is 32 characters and was already in their
 *  hands, and the fact that the only thing it can do is set one timestamp on
 *  a row that already exists. Pressing it twice is pressing it once.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "That link isn't one of ours." }, { status: 404 });
  }

  const db = supabaseAdmin();
  /* Only a SPENT invite. A live link needs no replacement -- the person
     should use the one they have -- and saying so is more use than silently
     adding them to a list the office then has to work out. */
  const { data: invite } = await db.from("staff_invites")
    .select("id, full_name, used_at, expires_at").eq("token", token).maybeSingle();
  if (!invite) {
    return NextResponse.json({ error: "That link isn't one of ours." }, { status: 404 });
  }
  const spent = Boolean(invite.used_at)
    || new Date(invite.expires_at as string) < new Date();
  if (!spent) {
    return NextResponse.json(
      { error: "That link still works — open it again." }, { status: 409 });
  }

  const { error } = await db.from("staff_invites")
    .update({ reasked_at: new Date().toISOString() }).eq("id", invite.id);
  if (error) {
    /* The column arrives in migration 041, and saying which one is missing is
       the difference between a one-round fix and an afternoon. */
    return NextResponse.json({
      error: "Could not pass that on — the office needs to run migration 041.",
    }, { status: 500 });
  }

  return NextResponse.json({ ok: true, name: invite.full_name });
}
