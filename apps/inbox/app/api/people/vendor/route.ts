import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { toE164 } from "@/lib/twilio";

export const runtime = "nodejs";

/** Add a trade.
 *
 *  A vendor is a contact with a phone number, not an account. They never sign
 *  in -- they get a link to their own jobs when one is dispatched to them. Ask
 *  a plumber to register and the completion photo never arrives. */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { fullName, phone } = await req.json();
  const name = String(fullName ?? "").trim();
  const e164 = toE164(String(phone ?? ""));
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
  if (!/^\+1\d{10}$/.test(e164)) {
    return NextResponse.json({ error: "That doesn't look like a US phone number." }, { status: 400 });
  }

  const db = supabaseAdmin();
  // Contacts are keyed on the number, so a trade who has already texted the
  // line becomes a vendor rather than a duplicate.
  const { error } = await db.from("contacts")
    .upsert({ phone: e164, full_name: name, party: "vendor" }, { onConflict: "phone" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
