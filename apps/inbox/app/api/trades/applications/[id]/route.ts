import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/** Approve or decline a trade who applied.
 *
 *  Approving is what turns a claim into a vendor, so it is the moment the
 *  office takes responsibility for it -- and it is recorded with a name and a
 *  time, because "who let this contractor in" is a question that gets asked
 *  exactly once, after something has gone wrong.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (staff?.role !== "admin" && staff?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const { decision, reason } = await req.json();
  if (decision !== "approved" && decision !== "declined") {
    return NextResponse.json({ error: "unknown decision" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: app } = await db
    .from("vendor_applications").select("*").eq("id", id).maybeSingle();
  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (app.status !== "pending") {
    return NextResponse.json({ error: "That one has already been decided." }, { status: 409 });
  }

  if (decision === "declined") {
    await db.from("vendor_applications").update({
      status: "declined", decided_by: staff.id, decided_at: new Date().toISOString(),
      decline_reason: String(reason ?? "").trim() || null,
    }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  // The number may already be someone. A tenant who moonlights as a handyman is
  // a real situation, and turning their contact into a vendor would detach them
  // from their own tenancy. So an existing NON-vendor is refused here and the
  // office is told, rather than quietly overwritten.
  const { data: existing } = await db
    .from("contacts").select("id, party, full_name").eq("phone", app.phone).maybeSingle();
  if (existing && existing.party !== "vendor" && existing.party !== "other") {
    return NextResponse.json({
      error: `That number already belongs to ${existing.full_name ?? "a contact"}`
        + ` (${existing.party.replace("_", " ")}). Sort that out first —`
        + ` approving would detach them from their own history.`,
    }, { status: 409 });
  }

  const { data: contact, error } = await db.from("contacts").upsert({
    phone: app.phone,
    full_name: app.full_name,
    party: "vendor",
    company: app.company,
    email: app.email,
    notes: app.notes,
  }, { onConflict: "phone" }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (app.trades?.length) {
    await db.from("vendor_trades").upsert(
      app.trades.map((t: string) => ({ contact_id: contact.id, trade_id: t })),
      { onConflict: "contact_id,trade_id" });
  }
  if (app.markets?.length) {
    await db.from("vendor_markets").upsert(
      app.markets.map((m: string) => ({ contact_id: contact.id, market_id: m })),
      { onConflict: "contact_id,market_id" });
  }

  await db.from("vendor_applications").update({
    status: "approved", decided_by: staff.id,
    decided_at: new Date().toISOString(), contact_id: contact.id,
  }).eq("id", id);

  return NextResponse.json({ ok: true, contactId: contact.id });
}
