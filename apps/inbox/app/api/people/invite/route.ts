import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { twilioClient, publicBase, toE164, isValidPhone, canSmsFromLine } from "@/lib/twilio";
import { prettyPhone } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES = new Set(["admin", "office", "tech", "shower"]);

/** Text somebody a link that sets them up.
 *
 *  Admin only, because this link creates an account. There is no approval step
 *  afterwards and there should not be: the decision was made when an admin
 *  typed their number, and asking them to approve the person they just invited
 *  is a rubber stamp that teaches people to click through warnings. */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "admins only" }, { status: 403 });
  }

  const { fullName, phone, role } = await req.json();
  const e164 = toE164(String(phone ?? ""));
  if (!isValidPhone(e164)) {
    return NextResponse.json({ error: "That doesn't look like a mobile number." }, { status: 400 });
  }
  if (!ROLES.has(role)) {
    return NextResponse.json({ error: "Pick what they'll be doing." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const token = randomBytes(32).toString("base64url");
  const name = String(fullName ?? "").trim() || null;

  const { error } = await db.from("staff_invites").insert({
    token, full_name: name, phone: e164, role, invited_by: me.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const link = `${publicBase(req)}/welcome/${token}`;
  const text = [
    `${me.full_name} has set you up on the Larabee Homes shared line.`,
    ``,
    `Finish here: ${link}`,
    ``,
    `The link works once and expires in a week.`,
  ].join("\n");

  // Somebody outside the US or Canada. The shared line physically cannot text
  // them -- see canSmsFromLine -- so the link is handed back for the admin to
  // send however they already talk to that person. The invite stands; the only
  // thing that changes is who carries it.
  if (!canSmsFromLine(e164)) {
    return NextResponse.json({
      ok: true,
      sent: false,
      link,
      why: `The shared line can only text US and Canadian numbers, so ${prettyPhone(e164)}`
        + ` could not be sent it. Send them this link yourself — WhatsApp, email, however`
        + ` you normally reach them. It works once and expires in a week.`,
    });
  }

  try {
    await twilioClient().messages.create({
      to: e164, body: text,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      statusCallback: `${publicBase(req)}/api/twilio/status`,
    });
  } catch (e) {
    // The invite exists but nobody has it. Deleted rather than left behind as a
    // live account-creating link nobody knows about.
    console.error("invite text failed", e);
    await db.from("staff_invites").delete().eq("token", token);
    return NextResponse.json(
      { error: `Couldn't text ${prettyPhone(e164)}. Nothing was sent.` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, sent: true });
}

/** Who has been invited and not yet finished. Never returns the token. */
export async function GET() {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "admins only" }, { status: 403 });
  }
  const db = supabaseAdmin();
  const { data } = await db
    .from("staff_invites")
    .select("id, full_name, phone, role, expires_at, used_at, created_at")
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  return NextResponse.json({
    invites: (data ?? []).map((i) => ({
      id: i.id, name: i.full_name, phone: prettyPhone(i.phone),
      role: i.role, expires: i.expires_at,
    })),
  });
}
