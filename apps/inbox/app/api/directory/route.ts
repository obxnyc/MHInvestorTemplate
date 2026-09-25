import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type DirectoryVendor = {
  id: string; name: string; company: string | null; phone: string;
  email: string | null; notes: string | null; preferred: boolean;
  trades: string[]; markets: string[];
};

/** The trade directory: who does what, and where.
 *
 *  One query for the whole thing rather than one per vendor. A directory of
 *  eighty contractors would otherwise open eighty round trips, and the page
 *  that exists to save a phone call would take longer than the phone call. */
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const supabase = await supabaseServer();
  const [{ data: vendors }, { data: trades }, { data: markets }] = await Promise.all([
    supabase.from("contacts")
      .select("id, full_name, company, phone, email, notes, preferred, vendor_trades(trade_id), vendor_markets(market_id)")
      .eq("party", "vendor")
      .order("preferred", { ascending: false })
      .order("full_name"),
    supabase.from("trades").select("id, label, sort").order("sort"),
    supabase.from("markets").select("id, name, state").eq("active", true).order("name"),
  ]);

  return NextResponse.json({
    vendors: (vendors ?? []).map((v) => ({
      id: v.id,
      name: v.full_name || prettyPhone(v.phone),
      company: v.company,
      phone: prettyPhone(v.phone),
      email: v.email,
      notes: v.notes,
      preferred: v.preferred,
      trades: ((v.vendor_trades ?? []) as { trade_id: string }[]).map((t) => t.trade_id),
      markets: ((v.vendor_markets ?? []) as { market_id: string }[]).map((m) => m.market_id),
    })),
    trades: trades ?? [],
    markets: markets ?? [],
  });
}
