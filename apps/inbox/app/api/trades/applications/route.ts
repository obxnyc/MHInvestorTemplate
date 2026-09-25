import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trades waiting on a decision. */
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("vendor_applications")
    .select("id, full_name, company, phone, email, trades, markets, notes, claims_insured, claims_licensed, license_ref, created_at")
    .eq("status", "pending")
    .order("created_at");

  return NextResponse.json({
    applications: (data ?? []).map((a) => ({
      id: a.id, name: a.full_name, company: a.company,
      phone: prettyPhone(a.phone), email: a.email,
      trades: a.trades ?? [], markets: a.markets ?? [], notes: a.notes,
      insured: a.claims_insured, licensed: a.claims_licensed,
      licenseRef: a.license_ref, appliedOn: a.created_at,
    })),
  });
}
