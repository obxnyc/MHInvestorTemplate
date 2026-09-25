import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { toE164, isValidPhone } from "@/lib/twilio";

export const runtime = "nodejs";

/** A contractor putting themselves forward.
 *
 *  Public, so it is treated as public: nothing here reaches an existing row,
 *  the reply is the same whether or not we already know them, and what they
 *  say about their own insurance is stored as a claim rather than a fact. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });

  // A field no person can see and every crude bot fills in.
  if (String(body.website ?? "").trim()) {
    return NextResponse.json({ ok: true });
  }

  const name = String(body.fullName ?? "").trim();
  const phone = toE164(String(body.phone ?? ""));
  if (name.length < 2) {
    return NextResponse.json({ error: "Please give your name." }, { status: 400 });
  }
  if (!isValidPhone(phone)) {
    return NextResponse.json({ error: "Please give a mobile number we can reach you on." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const trades = Array.isArray(body.trades) ? body.trades.slice(0, 20).map(String) : [];
  const markets = Array.isArray(body.markets) ? body.markets.slice(0, 20).map(String) : [];

  const { error } = await db.from("vendor_applications").insert({
    full_name: name,
    company: String(body.company ?? "").trim() || null,
    phone,
    email: email || null,
    trades,
    markets,
    notes: String(body.notes ?? "").trim().slice(0, 2000) || null,
    claims_insured: Boolean(body.insured),
    claims_licensed: Boolean(body.licensed),
    license_ref: String(body.licenseRef ?? "").trim() || null,
  });

  // A duplicate is not an error worth showing. Somebody who filled the form in
  // twice because nothing visibly happened should be told the same thing as
  // somebody who filled it in once.
  if (error && error.code !== "23505") {
    console.error("vendor application failed", error);
    return NextResponse.json({ error: "Something went wrong. Please ring the office." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** The lists the form needs, without a session. Trades and market names are
 *  not sensitive -- they are on the sign outside. */
export async function GET() {
  const db = supabaseAdmin();
  const [{ data: trades }, { data: markets }] = await Promise.all([
    db.from("trades").select("id, label").order("sort"),
    db.from("markets").select("id, name").eq("active", true).order("name"),
  ]);
  return NextResponse.json({ trades: trades ?? [], markets: markets ?? [] });
}
