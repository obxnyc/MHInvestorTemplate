import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { toE164 } from "@/lib/twilio";

export const runtime = "nodejs";

/** Add or update a trade.
 *
 *  Keyed on the phone number, so a contractor who has already texted the line
 *  becomes a vendor rather than a second record for the same person. That is
 *  the whole reason the directory is built on contacts: the plumber you text
 *  and the plumber in the rolodex have to be the same row, or the notes end up
 *  on the one nobody opens. */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { fullName, company, phone, email, notes, preferred, trades, markets } =
    await req.json();
  const name = String(fullName ?? "").trim();
  const e164 = toE164(String(phone ?? ""));
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
  if (!/^\+1\d{10}$/.test(e164)) {
    return NextResponse.json({ error: "That doesn't look like a US phone number." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: contact, error } = await db.from("contacts")
    .upsert({
      phone: e164,
      full_name: name,
      party: "vendor",
      company: String(company ?? "").trim() || null,
      email: String(email ?? "").trim().toLowerCase() || null,
      notes: String(notes ?? "").trim() || null,
      preferred: Boolean(preferred),
    }, { onConflict: "phone" })
    .select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Replaced wholesale rather than merged: the form shows every trade and
  // market with the current ones ticked, so what comes back IS the answer.
  // Merging would make unticking impossible.
  const tradeIds: string[] = Array.isArray(trades) ? trades : [];
  const marketIds: string[] = Array.isArray(markets) ? markets : [];

  await db.from("vendor_trades").delete().eq("contact_id", contact.id);
  if (tradeIds.length) {
    await db.from("vendor_trades")
      .insert(tradeIds.map((t) => ({ contact_id: contact.id, trade_id: t })));
  }
  await db.from("vendor_markets").delete().eq("contact_id", contact.id);
  if (marketIds.length) {
    await db.from("vendor_markets")
      .insert(marketIds.map((m) => ({ contact_id: contact.id, market_id: m })));
  }

  return NextResponse.json({ ok: true, id: contact.id });
}
