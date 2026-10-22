import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { supabaseServer } from "@/lib/supabase-server";
import { FIELD } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Setting up with a PIN you chose yourself, from the link that was texted.
 *
 *  "I would prefer not to give people their own PINs. They should make their
 *  own." A PIN the office types is not a secret -- it is written on a pad by
 *  the person who typed it, read out across a yard, and it belongs to them
 *  rather than to the man whose hours it signs. The whole point of the thing
 *  is that only one person knows it.
 *
 *  NO EMAIL AND NO PASSWORD. "A lot of these guys pay for basic phone
 *  plans" -- asking a man standing in a driveway to go and find an email is
 *  where setup is abandoned. The invite already carries the phone number the
 *  link was texted to, so that is the identity, and the address below exists
 *  only because Supabase wants one. Nothing is ever sent to it.
 *
 *  The consequence is said out loud rather than discovered: somebody set up
 *  this way CANNOT recover by email. Their ways back in are the PIN and a
 *  fresh invite from the office, which is why the spent-link screen offers
 *  both. An account whose only key is a four-digit number the holder chose is
 *  the right trade for a phone in a work glove, and it is a trade.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "That link isn't valid." }, { status: 404 });
  }

  const { pin, fullName } = await req.json() as { pin?: unknown; fullName?: unknown };
  const chosen = String(pin ?? "").trim();
  const name = String(fullName ?? "").trim();

  /* SHAPE ONLY. Whether this PIN is too easy is the database's to say --
     set_staff_pin refuses 1234 and 0000 and knows which roles may have one at
     all -- and duplicating that judgement here is how the two drift apart. */
  if (!/^[0-9]{4,8}$/.test(chosen)) {
    return NextResponse.json(
      { error: "A PIN is 4 to 8 numbers." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: invite } = await db.from("staff_invites")
    .select("*").eq("token", token).maybeSingle();
  if (!invite || invite.used_at || new Date(invite.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "That link has been used or has expired." }, { status: 404 });
  }

  /* A PIN is for people in the field. The database refuses an admin one, and
     catching that here means the message is about what to do rather than a
     500 from a raised exception. */
  if (!FIELD.includes(invite.role)) {
    return NextResponse.json({
      error: "This invite is for an office account, which signs in with an email.",
    }, { status: 400 });
  }

  const digits = String(invite.phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) {
    return NextResponse.json({
      error: "There is no phone number on this invite. Ask the office to send a new one.",
    }, { status: 400 });
  }
  /* Built from the phone so it is stable and cannot collide with a real
     mailbox somebody later wants to use. Never sent to. */
  const stand_in = `crew.${digits}@larabeehomesllc.com`;

  // Claimed before anything is created, and only while still unclaimed: two
  // taps on a slow phone must not make two accounts.
  const { data: claimed } = await db.from("staff_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token).is("used_at", null)
    .select("id").maybeSingle();
  if (!claimed) {
    return NextResponse.json({ error: "That link has already been used." }, { status: 409 });
  }
  /* Every failure from here on hands the link back, because a man holding a
     dead link and no account is the state this whole round exists to stop. */
  const giveBack = async () => {
    await db.from("staff_invites").update({ used_at: null }).eq("token", token);
  };

  const auth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: created, error: authError } = await auth.auth.admin.createUser({
    email: stand_in, email_confirm: true,
  });
  if (authError || !created?.user) {
    await giveBack();
    return NextResponse.json({
      error: /already/i.test(authError?.message ?? "")
        ? "There is already an account on that phone number. Try your PIN, or ask the office."
        : "Could not set up the account.",
    }, { status: 400 });
  }

  const { error: rowError } = await db.from("staff").insert({
    id: created.user.id,
    full_name: name || invite.full_name || "New starter",
    role: invite.role,
    forward_to: invite.phone,
  });
  if (rowError) {
    await auth.auth.admin.deleteUser(created.user.id);
    await giveBack();
    return NextResponse.json({ error: rowError.message }, { status: 500 });
  }

  /* The PIN, hashed by the database. It never touches a log here and the
     office never sees it. */
  const { error: pinError } = await db.rpc("set_staff_pin", {
    p_staff: created.user.id, p_pin: chosen,
  });
  if (pinError) {
    await auth.auth.admin.deleteUser(created.user.id);
    await db.from("staff").delete().eq("id", created.user.id);
    await giveBack();
    /* set_staff_pin says "too easy" for 1234 and the like. Passing its own
       words through is the difference between a man trying 1111 next and a
       man ringing the office. */
    return NextResponse.json({
      error: /too easy/i.test(pinError.message)
        ? "That PIN is too easy to guess. Try one that isn't all the same number or in order."
        : "Could not save that PIN.",
    }, { status: 400 });
  }

  await db.from("staff_invites")
    .update({ staff_id: created.user.id }).eq("token", token);

  // Signed in on the spot, so the first thing they see is the clock.
  const { data: link } = await auth.auth.admin.generateLink({
    type: "magiclink", email: stand_in,
  });
  return NextResponse.json({
    ok: true, signIn: link?.properties?.hashed_token ?? null,
  });
}
