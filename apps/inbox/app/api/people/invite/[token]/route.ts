import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { prettyPhone } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the welcome page needs before anyone has signed in: the name we already
 *  had for them, and nothing else. Not the role, not who invited them, not the
 *  other people on the line -- a link that has leaked should teach a stranger
 *  as little as possible. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 32) return NextResponse.json({ ok: false }, { status: 404 });

  const db = supabaseAdmin();
  const { data } = await db.from("staff_invites")
    .select("full_name, phone, used_at, expires_at").eq("token", token).maybeSingle();

  if (!data || data.used_at || new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  return NextResponse.json({ ok: true, name: data.full_name, phone: prettyPhone(data.phone) });
}

/** Taking up an invite: the account is created here, and the person is signed
 *  in immediately so they can set a password while they are still holding the
 *  phone. Making them go and find a separate email at this point is where
 *  setup gets abandoned. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "That link isn't valid." }, { status: 404 });
  }

  const { fullName, email } = await req.json();
  const name = String(fullName ?? "").trim();
  const mail = String(email ?? "").trim().toLowerCase();
  if (name.length < 2) {
    return NextResponse.json({ error: "Please give your name." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
    return NextResponse.json({ error: "Please give a work email." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: invite } = await db.from("staff_invites")
    .select("*").eq("token", token).maybeSingle();
  if (!invite || invite.used_at || new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "That link has been used or has expired." }, { status: 404 });
  }

  // Claimed before the account is made, and only if it is still unclaimed.
  // Two taps on a slow phone must not produce two accounts.
  const { data: claimed } = await db.from("staff_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token).is("used_at", null)
    .select("id").maybeSingle();
  if (!claimed) {
    return NextResponse.json({ error: "That link has already been used." }, { status: 409 });
  }

  const auth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: created, error: authError } = await auth.auth.admin.createUser({
    email: mail, email_confirm: true,
  });
  if (authError || !created?.user) {
    // Handed back so it can be tried again with a different address.
    await db.from("staff_invites").update({ used_at: null }).eq("token", token);
    return NextResponse.json({
      error: /already/i.test(authError?.message ?? "")
        ? "There's already an account on that email. Use another, or ask the office."
        : "Could not set up the account.",
    }, { status: 400 });
  }

  const { error: rowError } = await db.from("staff").insert({
    id: created.user.id, full_name: name, role: invite.role, forward_to: invite.phone,
  });
  if (rowError) {
    await auth.auth.admin.deleteUser(created.user.id);
    await db.from("staff_invites").update({ used_at: null }).eq("token", token);
    return NextResponse.json({ error: rowError.message }, { status: 500 });
  }

  await db.from("staff_invites")
    .update({ staff_id: created.user.id }).eq("token", token);

  // Signed in on the spot. The same one-time link the PIN pad uses: minted
  // here, spent immediately by the browser, never stored.
  const { data: link, error: linkError } = await auth.auth.admin.generateLink({
    type: "magiclink", email: mail,
  });
  if (linkError || !link?.properties?.hashed_token) {
    // The account is real; they can still get in the ordinary way.
    return NextResponse.json({ ok: true, signIn: null, email: mail });
  }

  return NextResponse.json({
    ok: true, email: mail, signIn: link.properties.hashed_token,
  });
}
