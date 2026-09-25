import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const ROLES = new Set(["admin", "office", "tech", "shower"]);

/** Add someone who works here.
 *
 *  Invite-only, and admin-only. A shared line is a list of every tenant's phone
 *  number and every applicant's credit score; an open sign-up page on it would
 *  be a breach with a form in front of it. The account is created here and the
 *  person is then told to sign in -- they never choose whether they belong. */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "admins only" }, { status: 403 });
  }

  const { fullName, role, email, forwardTo } = await req.json();
  if (!String(fullName ?? "").trim()) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }
  if (!ROLES.has(role)) {
    return NextResponse.json({ error: "Pick a role." }, { status: 400 });
  }
  const mail = String(email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
    return NextResponse.json({ error: "A work email is required." }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Confirmed on creation: the invitation IS the confirmation, and a person who
  // has to find a confirmation email before they can find a sign-in email will
  // simply ring the office instead.
  const { data: created, error } = await admin.auth.admin.createUser({
    email: mail, email_confirm: true,
  });
  if (error || !created?.user) {
    const already = /already/i.test(error?.message ?? "");
    return NextResponse.json(
      { error: already ? "Somebody already uses that email." : (error?.message ?? "Could not create the account.") },
      { status: 400 },
    );
  }

  const db = supabaseAdmin();
  const { error: rowError } = await db.from("staff").insert({
    id: created.user.id,
    full_name: String(fullName).trim(),
    role,
    forward_to: String(forwardTo ?? "").trim() || null,
  });
  if (rowError) {
    // Do not leave a sign-in account with no staff record behind it: that is an
    // account that can authenticate and then see nothing, which looks like a
    // broken app rather than a half-finished invitation.
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: rowError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: created.user.id });
}
