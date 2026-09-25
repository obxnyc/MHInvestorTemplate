import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { prettyPhone } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every job, with what it cost.
 *
 *  Open and closed together, because the price history lives in the closed ones
 *  and the whole reason to look at this screen is to compare the two. */
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const supabase = await supabaseServer();
  const [{ data: jobs }, { data: trades }] = await Promise.all([
    supabase.from("work_orders")
      .select("id, summary, detail, status, due_at, completed_at, cost_cents, invoice_ref, trade_id, conversation_id, units(label, properties(name, market_id)), vendor:assigned_vendor(full_name, company), tech:assigned_tech(full_name)")
      .order("completed_at", { ascending: false, nullsFirst: true })
      .limit(500),
    supabase.from("trades").select("id, label, sort").order("sort"),
  ]);

  return NextResponse.json({
    jobs: (jobs ?? []).map((j) => {
      const unit = j.units as unknown as
        { label: string | null; properties: { name: string; market_id: string | null } | null } | null;
      const vendor = j.vendor as unknown as { full_name: string | null; company: string | null } | null;
      const tech = j.tech as unknown as { full_name: string } | null;
      return {
        id: j.id,
        summary: j.summary,
        status: j.status,
        dueAt: j.due_at,
        completedAt: j.completed_at,
        costCents: j.cost_cents,
        invoiceRef: j.invoice_ref,
        tradeId: j.trade_id,
        conversationId: j.conversation_id,
        where: unit ? [unit.properties?.name, unit.label].filter(Boolean).join(" · ") : null,
        marketId: unit?.properties?.market_id ?? null,
        who: vendor?.company || vendor?.full_name || tech?.full_name || null,
      };
    }),
    trades: trades ?? [],
  });
}
