import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { countersign, slotsIn } from "@/lib/countersign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Two inches of signature is tens of kilobytes; a megabyte is a photograph. */
const MOST = 400_000;

type Row = {
  id: string; title: string; pack: string; to_name: string;
  expires_at: string; signed_at: string | null; signed_pack: string | null;
  signed_name: string | null; voided_at: string | null; opened_at: string | null;
};

const PICK = "id, title, pack, to_name, expires_at, signed_at, signed_pack,"
  + " signed_name, voided_at, opened_at";

/**
 * Why this link cannot be used, in the words the page will show.
 *
 * Four different reasons, kept apart on purpose. "This link does not
 * work" sends somebody to the phone; "you signed this on the 3rd" does
 * not, and neither does "it ran out on Tuesday, ask for another".
 */
function why(row: Row | null): string | null {
  if (!row) return "This link is not one of ours, or it has been replaced.";
  if (row.voided_at) return "These documents were withdrawn and are no longer for signing.";
  /* A SIGNED PACK NEVER EXPIRES. The fortnight is the window to sign in,
     not a lease on the right to read what you signed -- and this closed
     over the signed copy too, so a fortnight after signing the investor
     opened their own executed contract and was told the link had run
     out. There is no other copy on their side: this IS the vault. */
  if (!row.signed_at && Date.parse(row.expires_at) < Date.now()) {
    return "This link has expired. Ask for a new one and it will be sent straight over.";
  }
  return null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("signing_requests").select(PICK).eq("token", token).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const row = data as Row | null;
  const stop = why(row);
  if (stop || !row) return NextResponse.json({ error: stop }, { status: 404 });

  /* Opened, recorded once. Not a read receipt for its own sake: "sent a
     week ago and never opened" and "opened twice and not signed" are
     different problems with different answers. */
  if (!row.opened_at) {
    await db.from("signing_requests")
      .update({ opened_at: new Date().toISOString() }).eq("id", row.id);
  }

  return NextResponse.json({
    title: row.title,
    toName: row.to_name,
    /* Once signed, the signed copy IS the document. Handing back the
       unsigned one afterwards would show somebody a blank line where
       their own signature is. */
    pack: row.signed_pack ?? row.pack,
    signedAt: row.signed_at,
    signedName: row.signed_name,
    places: slotsIn(row.pack),
    expiresAt: row.expires_at,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const body = await req.json().catch(() => null) as
    { png?: unknown; name?: unknown; agreed?: unknown; on?: unknown } | null;

  const png = typeof body?.png === "string" ? body.png : "";
  const name = String(body?.name ?? "").trim();

  /* THE DATE THE SIGNER PUTS ON IT, which is not always the day the
     server happens to be having. A deal agreed on the 12th and signed on
     the 1st is dated by the people in it, not by a clock in Virginia.
     Absent means today, so an older client keeps working.

     Two things it may not be. Not nonsense -- `new Date("")` is Invalid
     Date and would print "NaN/NaN/NaN" into a contract. And not the
     future: a signature dated tomorrow says the thing was signed before
     it was signed, which is the one direction that cannot be honest. */
  const today = new Date().toISOString().slice(0, 10);
  const asked = typeof body?.on === "string" && body.on ? body.on : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asked)
      || Number.isNaN(Date.parse(`${asked}T00:00:00Z`))
      || asked.slice(0, 10) !== new Date(`${asked}T00:00:00Z`)
           .toISOString().slice(0, 10)) {
    return NextResponse.json(
      { error: "That is not a date. Use the date box." }, { status: 400 });
  }
  if (asked > today) {
    return NextResponse.json(
      { error: "A signature cannot be dated in the future." }, { status: 400 });
  }

  /* INTENT IS ITS OWN FACT, asked for and recorded separately. A mark
     without it is a picture of a signature. */
  if (body?.agreed !== true) {
    return NextResponse.json(
      { error: "Tick the box to say you mean this as your signature." },
      { status: 400 });
  }
  if (name.length < 2) {
    return NextResponse.json({ error: "Type your full name." }, { status: 400 });
  }
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(png)) {
    return NextResponse.json({ error: "That is not a signature." }, { status: 400 });
  }
  if (png.length > MOST) {
    return NextResponse.json(
      { error: "That signature is too large. Draw it again." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("signing_requests").select(PICK).eq("token", token).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const row = data as Row | null;
  const stop = why(row);
  if (stop || !row) return NextResponse.json({ error: stop }, { status: 404 });
  /* SIGNED ONCE. A second signature over the first would replace a
     document somebody is already holding a copy of. */
  if (row.signed_at) {
    return NextResponse.json(
      { error: "These were already signed." }, { status: 409 });
  }

  const on = asked;
  const signed = countersign(row.pack, { png, on });

  /* The claim the whole thing rests on, checked rather than assumed: if
     the substitution filled nothing then nothing was signed, whatever
     the row ends up saying. */
  if (slotsIn(signed) !== 0 || signed === row.pack) {
    return NextResponse.json(
      { error: "These documents could not be signed. Nobody has been charged"
        + " or committed to anything; please tell the sender." },
      { status: 500 });
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const { error: wrote } = await db.from("signing_requests").update({
    agreed: true,
    signed_at: new Date().toISOString(),
    signed_name: name,
    signed_png: png,
    signed_pack: signed,
    signed_ip: ip,
    signed_agent: (req.headers.get("user-agent") ?? "").slice(0, 400) || null,
  }).eq("id", row.id).is("signed_at", null);

  if (wrote) return NextResponse.json({ error: wrote.message }, { status: 400 });
  return NextResponse.json({ ok: true, pack: signed, signedOn: on });
}
