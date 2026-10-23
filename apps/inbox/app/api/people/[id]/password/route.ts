import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isViewer } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Setting the password on a read-only account, and on nothing else.
 *
 *  The want is ordinary: hand somebody a login so they can look round and say
 *  what they think. The email route to that is blocked -- the database's
 *  built-in mailer is rate-limited to a handful a day -- and the ask was
 *  "can I just create a password".
 *
 *  ONLY FOR A VIEWER, and that restriction is the whole reason this exists at
 *  all. A route that let an admin set anybody's password would let one admin
 *  take another's account, and an office account's password would be a
 *  credential that can close a tenant's thread or reassign a job. A read-only
 *  account can do neither: every write it attempts is refused in the proxy,
 *  by method, before it reaches a route. So a password somebody else typed is
 *  a safe thing to hand over here and is not safe anywhere else.
 *
 *  This is the opposite decision from the crew PIN -- deliberately. A PIN
 *  signs a man's hours and must be his alone. A guest login is a key to a
 *  show home: it opens the door and moves no furniture.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { id } = await ctx.params;
  let body: { password?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  const password = String(body.password ?? "");
  /* Ten, not six. This is a credential that gets written on a sticky note and
     read out over the phone, and the account behind it can read every
     tenant's messages -- it cannot change them, which is not the same as it
     being harmless. */
  if (password.length < 10) {
    return NextResponse.json(
      { error: "Use at least 10 characters." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: who } = await db.from("staff")
    .select("id, full_name, role").eq("id", id).maybeSingle();
  if (!who) {
    return NextResponse.json({ error: "No such person." }, { status: 404 });
  }
  if (!isViewer(who.role)) {
    return NextResponse.json({
      error: "Only a read-only account can be given a password this way."
        + " Everybody else sets their own.",
    }, { status: 400 });
  }

  const auth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await auth.auth.admin.updateUserById(id, { password });
  if (error) {
    // Never the password, in a log or in a reply.
    console.error("setting a guest password failed", error.message);
    return NextResponse.json({ error: "Could not set it." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, name: who.full_name });
}
