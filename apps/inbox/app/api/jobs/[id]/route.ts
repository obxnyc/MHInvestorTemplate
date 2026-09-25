import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/** Record what a job cost, or which trade it was.
 *
 *  Saves on its own as soon as a field is left, because this gets filled in
 *  while holding a stack of invoices and a "Save" button at the bottom of a
 *  long list is a button that does not get pressed. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { costCents, invoiceRef, tradeId } = await req.json();

  const patch: Record<string, unknown> = {};
  if (costCents !== undefined) {
    if (costCents !== null && (!Number.isInteger(costCents) || costCents < 0)) {
      return NextResponse.json({ error: "that isn't an amount" }, { status: 400 });
    }
    patch.cost_cents = costCents;
    // Who and when, so a figure someone questions later has an author. Cleared
    // along with the price, rather than left pointing at a number that is gone.
    patch.costed_by = costCents === null ? null : staff.id;
    patch.costed_on = costCents === null ? null : new Date().toISOString().slice(0, 10);
  }
  if (invoiceRef !== undefined) patch.invoice_ref = String(invoiceRef).trim() || null;
  if (tradeId !== undefined) patch.trade_id = tradeId || null;
  if (!Object.keys(patch).length) return NextResponse.json({ ok: true });

  const { error } = await supabaseAdmin().from("work_orders").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
