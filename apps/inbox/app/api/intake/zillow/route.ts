import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ingest } from "@/lib/intake";
import { parseZillowLead } from "@/lib/zillow-lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Zillow's Lead API delivers here: one form-encoded POST per rental lead,
 * the moment the renter presses send. See lib/zillow-lead.ts for the fields.
 *
 * The reply code is the contract. Zillow REDELIVERS a lead whenever we answer
 * with a failure, and never again once we answer 200 -- so 200 is said only
 * after the lead is written, and anything that went wrong on our side is a
 * 5xx with the reason in the body, which Zillow's team reads when they review
 * delivery errors. A 200 sent before the write would be a lead lost with
 * nobody told.
 */
export async function POST(req: Request) {
  const key = (req.headers.get("x-zillow-key") ?? "").trim();
  if (!key) {
    return NextResponse.json({ errorMessage: "missing X-Zillow-Key header" }, { status: 401 });
  }
  const { data: ok, error: keyErr } = await supabaseAdmin()
    .rpc("zillow_lead_key_ok", { k: key });
  if (keyErr) {
    // Our fault, not theirs: ask Zillow to try again rather than drop it.
    console.error("zillow lead: key check failed", keyErr.message);
    return NextResponse.json({ errorMessage: "could not check the key; retry" }, { status: 503 });
  }
  if (ok !== true) {
    return NextResponse.json({ errorMessage: "X-Zillow-Key not recognised" }, { status: 401 });
  }

  const body = await req.text();
  const form = new URLSearchParams(body);
  if (!form.get("name") && !form.get("email") && !form.get("phone")) {
    return NextResponse.json(
      { errorMessage: "lead has no name, email or phone; nothing to file it under" },
      { status: 400 });
  }

  const digest = createHash("sha256").update(body).digest("hex").slice(0, 32);
  const lead = parseZillowLead(form, digest);

  try {
    const got = await ingest(lead.intake);
    return NextResponse.json(got, { status: 200 });
  } catch (e) {
    console.error("zillow lead: could not file", e);
    return NextResponse.json(
      { errorMessage: `could not store the lead; retry (${String((e as Error)?.message ?? e).slice(0, 160)})` },
      { status: 500 });
  }
}
