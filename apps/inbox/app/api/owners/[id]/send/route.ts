import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isDesk } from "@/lib/roles";
import { sendEmail, sendSms } from "@/lib/notify";
import { publicBase } from "@/lib/twilio";
import { slotsIn } from "@/lib/countersign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01"
    || /schema cache|does not exist/i.test(e.message ?? ""));

const NEEDS = "Sending for signing needs migration 048 run on the database first.";

/** Long enough that guessing is not a strategy. */
const token = () => randomBytes(32).toString("base64url");

/** A fortnight. Long enough to get signed, short enough not to sit about. */
const DAYS = 14;

/**
 * Send a pack to the investor to sign.
 *
 * The HTML is frozen here and stored as it is. It is what they will read,
 * what they will sign, and what we will be holding afterwards -- and none
 * of those three may be regenerated later from anything.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!isDesk(staff.role)) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null) as {
    pack?: unknown; title?: unknown; docCount?: unknown;
    toName?: unknown; toEmail?: unknown; toPhone?: unknown;
  } | null;

  const pack = typeof body?.pack === "string" ? body.pack : "";
  const title = String(body?.title ?? "").trim() || "Your documents";
  const toName = String(body?.toName ?? "").trim();
  const toEmail = String(body?.toEmail ?? "").trim() || null;
  const toPhone = String(body?.toPhone ?? "").trim() || null;

  if (!pack) return NextResponse.json({ error: "nothing to send" }, { status: 400 });
  if (toName.length < 2) {
    return NextResponse.json({ error: "Who is signing?" }, { status: 400 });
  }
  if (!toEmail && !toPhone) {
    return NextResponse.json(
      { error: "An email address or a mobile number, so it can be sent." },
      { status: 400 });
  }

  /* NOWHERE TO SIGN IS NOT A DOCUMENT TO SEND. A pack built without the
     counter-signature slots would arrive, be read, and have no line the
     signing page could fill -- and the investor would be told it was
     signed. Refused here rather than discovered there. */
  const slots = slotsIn(pack);
  if (slots === 0) {
    return NextResponse.json(
      { error: "These documents have nowhere for them to sign." },
      { status: 400 });
  }

  const tok = token();
  const expires = new Date(Date.now() + DAYS * 86400e3).toISOString();

  const { error } = await supabaseAdmin().from("signing_requests").insert({
    token: tok, owner_id: id, title, pack,
    doc_count: Number(body?.docCount ?? 0) || 0,
    to_name: toName, to_email: toEmail, to_phone: toPhone,
    sent_by: staff.id, expires_at: expires,
  });
  if (error) {
    return NextResponse.json(
      { error: noTable(error) ? NEEDS : error.message }, { status: 400 });
  }

  const link = `${publicBase(req)}/sign/${tok}`;
  const from = staff.full_name || "Larabee Homes";

  /* SENT IS NOT THE SAME AS STORED, and the screen is told which of the
     two happened. A link that exists and did not go out is recoverable in
     one copy-and-paste; a link reported as sent and never delivered is a
     deal sitting still for a week. */
  const went: string[] = [];
  const failed: string[] = [];
  if (toEmail) {
    try {
      await sendEmail(toEmail, title,
        `${toName},\n\n${from} has sent you ${title} to read and sign.\n\n`
        + `${link}\n\nThe link works for ${DAYS} days. Nothing is signed `
        + `until you sign it.\n`);
      went.push(toEmail);
    } catch (e) {
      failed.push(`${toEmail}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (toPhone) {
    try {
      const sid = await sendSms(toPhone,
        `${from}: ${title} to read and sign. ${link}`);
      if (sid) went.push(toPhone); else failed.push(`${toPhone}: not sent`);
    } catch (e) {
      failed.push(`${toPhone}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: true, link, went, failed, slots });
}
