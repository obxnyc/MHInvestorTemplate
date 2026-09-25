import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every address, for putting a person at one. */
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("units")
    .select("id, label, properties(name)")
    .order("label");

  return NextResponse.json({
    units: (data ?? []).map((u) => ({
      id: u.id,
      label: [(u.properties as unknown as { name: string } | null)?.name, u.label]
        .filter(Boolean).join(" · "),
    })),
  });
}
