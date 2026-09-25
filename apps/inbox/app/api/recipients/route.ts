import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who a message can be handed to: the people who work here, and the trades.
 *
 *  Read through the signed-in user's client so row-level security decides what
 *  comes back, rather than this route deciding a second time and eventually
 *  disagreeing with it. */
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const supabase = await supabaseServer();
  const [{ data: people }, { data: vendors }] = await Promise.all([
    supabase.from("staff").select("id, full_name, role").eq("active", true)
      .order("full_name"),
    supabase.from("contacts").select("id, full_name, phone").eq("party", "vendor")
      .order("full_name"),
  ]);

  return NextResponse.json({
    staff: (people ?? [])
      // Forwarding something to yourself is not a thing anyone means to do.
      .filter((p) => p.id !== staff.id)
      .map((p) => ({ id: p.id, name: p.full_name, sub: p.role })),
    vendors: (vendors ?? []).map((v) => ({
      id: v.id,
      name: v.full_name || prettyPhone(v.phone),
      sub: v.full_name ? prettyPhone(v.phone) : "vendor",
    })),
  });
}
