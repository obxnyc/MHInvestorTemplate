import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { toE164, canSmsFromLine, publicBase } from "@/lib/twilio";
import { jobsLink } from "@/lib/dispatch";
import { sendSms } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A contractor asking for their own jobs link again.
 *
 * They already have one -- it was texted when the first job was dispatched --
 * and the thing that actually happens is that it scrolls out of their messages
 * and they ring the office. This sends the same link to the same number, which
 * is the only place it is allowed to go.
 *
 * No password, deliberately: see jobsLink. Asking a plumber to hold an account
 * is how the completion photo stops arriving.
 *
 * The reply never says whether the number is one of ours. This form is public,
 * so an answer that distinguished "not a vendor" from "sent" would be a way to
 * test numbers against our contact list one at a time.
 */
export async function POST(req: Request) {
  const { phone } = await req.json().catch(() => ({}));
  const e164 = toE164(String(phone ?? ""));

  // The same words whatever happens below.
  const same = NextResponse.json({ ok: true });
  if (!/^\+\d{10,15}$/.test(e164)) return same;

  const db = supabaseAdmin();
  const { data: vendor } = await db.from("contacts")
    .select("id, party").eq("phone", e164).maybeSingle();

  // Only people we actually send work to. A tenant's number is in this table
  // too, and a tenant must never be handed a page of jobs.
  if (!vendor || (vendor.party !== "vendor" && vendor.party !== "tech")) return same;

  // Nothing to send to. Said nowhere, for the reason above -- but there is no
  // point minting a token that cannot be delivered.
  if (!canSmsFromLine(e164)) return same;

  const link = await jobsLink(db, vendor.id, publicBase(req));
  if (!link) return same;

  await sendSms(e164, `Your open jobs with Larabee Homes: ${link}`);
  return same;
}
