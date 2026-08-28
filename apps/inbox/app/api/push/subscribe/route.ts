import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const sub = await req.json();
  if (!sub?.endpoint || !sub?.keys?.p256dh) {
    return NextResponse.json({ error: "bad subscription" }, { status: 400 });
  }

  // Endpoint is unique, so re-subscribing on the same device updates the row
  // rather than piling up duplicates that all fire at once.
  const { error } = await supabaseAdmin().from("push_subscriptions").upsert({
    staff_id: staff.id,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: req.headers.get("user-agent"),
    last_used_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { endpoint } = await req.json();
  await supabaseAdmin().from("push_subscriptions").delete().eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
