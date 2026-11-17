import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { isDesk } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The buyer's pitch and signature, used in every broker email. */
export async function PUT(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!isDesk(me.role)) return NextResponse.json({ error: "office and admin only" }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { pitch?: string | null; pitch_residential?: string | null; signature?: string | null };
  const db = await supabaseServer();
  const { data, error } = await db.from("acquisition_settings").upsert({
    id: true,
    pitch: b.pitch?.trim() ? b.pitch.slice(0, 8000) : null,
    pitch_residential: b.pitch_residential?.trim() ? b.pitch_residential.slice(0, 8000) : null,
    signature: b.signature?.trim() ? b.signature.slice(0, 2000) : null,
    updated_at: new Date().toISOString(), updated_by: me.id,
  }).select("pitch, pitch_residential, signature").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
