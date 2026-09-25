import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireStaff } from "@/lib/supabase-server";
import { pushToStaff } from "@/lib/push";
import { toE164 } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES = new Set(["admin", "office", "tech", "shower"]);

/** Somebody asking to be let in.
 *
 *  Public, and it grants nothing. What it produces is an item of work for an
 *  admin -- nobody reaches a tenant's phone number by filling in a form. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (String(body.website ?? "").trim()) return NextResponse.json({ ok: true });

  const name = String(body.fullName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = ROLES.has(body.role) ? body.role : "office";
  if (name.length < 2) {
    return NextResponse.json({ error: "Please give your name." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Please give a work email." }, { status: 400 });
  }

  const phoneRaw = String(body.phone ?? "").trim();
  const phone = phoneRaw ? toE164(phoneRaw) : null;

  const db = supabaseAdmin();
  const { error } = await db.from("access_requests").insert({
    full_name: name,
    email,
    phone,
    requested_role: role,
    reason: String(body.reason ?? "").trim().slice(0, 1000) || null,
  });

  // A second submission is answered like the first. Somebody who could not
  // tell whether it worked should not be scolded for trying again.
  if (error && error.code !== "23505") {
    console.error("access request failed", error);
    return NextResponse.json({ error: "Something went wrong. Ring the office." }, { status: 500 });
  }

  if (!error) {
    // Admins find out now, not when somebody next happens to open the People
    // screen. A request that waits three days for a glance is a person who
    // rings you instead, which is the thing this replaces.
    const { data: admins } = await db
      .from("staff").select("id").eq("role", "admin").eq("active", true);
    await pushToStaff((admins ?? []).map((a) => a.id), {
      title: "Someone is asking for access",
      body: `${name} — asking for ${LABEL[role] ?? role}`,
      url: "/people?tab=requests",
      tag: `access:${email}`,
    });
  }

  return NextResponse.json({ ok: true });
}

const LABEL: Record<string, string> = {
  admin: "admin", office: "office", tech: "maintenance", shower: "showings",
};

/** The queue, for admins. */
export async function GET() {
  const staff = await requireStaff();
  if (staff?.role !== "admin") {
    return NextResponse.json({ error: "admins only" }, { status: 403 });
  }
  const db = supabaseAdmin();
  const { data } = await db
    .from("access_requests")
    .select("id, full_name, email, phone, requested_role, reason, created_at")
    .eq("status", "pending").order("created_at");

  return NextResponse.json({
    requests: (data ?? []).map((r) => ({
      id: r.id, name: r.full_name, email: r.email, phone: r.phone,
      requested: r.requested_role, reason: r.reason, on: r.created_at,
    })),
  });
}
