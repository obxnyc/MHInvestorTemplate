import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const ROLES = new Set(["admin", "office", "tech", "shower"]);

/** Let somebody in, or not.
 *
 *  The role that is granted is passed here rather than taken from the request,
 *  because what somebody asks for and what they should have are different
 *  questions and only one of them is the office's to answer. Both are kept, so
 *  "who gave them admin" has an answer later.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "admins only" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const { decision, role, reason } = await req.json();
  const db = supabaseAdmin();

  const { data: request } = await db
    .from("access_requests").select("*").eq("id", id).maybeSingle();
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (request.status !== "pending") {
    return NextResponse.json({ error: "That one has already been decided." }, { status: 409 });
  }

  if (decision === "declined") {
    await db.from("access_requests").update({
      status: "declined", decided_by: me.id, decided_at: new Date().toISOString(),
      decline_reason: String(reason ?? "").trim() || null,
    }).eq("id", id);
    return NextResponse.json({ ok: true });
  }
  if (decision !== "approved") {
    return NextResponse.json({ error: "unknown decision" }, { status: 400 });
  }

  const granted = ROLES.has(role) ? role : request.requested_role;

  const auth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: created, error: authError } = await auth.auth.admin.createUser({
    email: request.email, email_confirm: true,
  });
  if (authError || !created?.user) {
    return NextResponse.json({
      error: /already/i.test(authError?.message ?? "")
        ? "That email already has an account. Check the roster before approving."
        : (authError?.message ?? "Could not create the account."),
    }, { status: 400 });
  }

  const { error: rowError } = await db.from("staff").insert({
    id: created.user.id,
    full_name: request.full_name,
    role: granted,
    forward_to: request.phone,
  });
  if (rowError) {
    // Never leave an account that can sign in with no staff row behind it:
    // that is an account which authenticates and then sees nothing, which
    // looks like a broken app rather than a half-finished approval.
    await auth.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: rowError.message }, { status: 500 });
  }

  await db.from("access_requests").update({
    status: "approved", granted_role: granted, decided_by: me.id,
    decided_at: new Date().toISOString(), staff_id: created.user.id,
  }).eq("id", id);

  return NextResponse.json({ ok: true, role: granted });
}
