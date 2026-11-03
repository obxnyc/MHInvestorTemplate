import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isDesk } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01"
    || /schema cache|does not exist/i.test(e.message ?? ""));

const NEEDS = "Sending for signing needs migration 048 run on the database first.";

/** What was sent to this investor, newest first. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;

  /* ONE PACK, TO READ. The investor can open their copy from the link
     they were sent; the office had no way to see it at all -- the list
     said "Signed by ALDERCREST" and that was the whole of it. The
     signed copy is returned where there is one, because once signed
     that IS the document; the unsigned one before that, so "what did we
     actually send them" is answerable too.

     Scoped to this owner in the query, so an id from another investor's
     deal returns nothing rather than somebody else's contract. The
     token is deliberately NOT returned: the office reads the pack, it
     does not need the key to the investor's own door. */
  const wants = new URL(req.url).searchParams.get("pack");
  if (wants) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("signing_requests")
      .select("title, pack, signed_pack, signed_at, signed_name, sent_at, to_name")
      .eq("owner_id", id).eq("id", wants).maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: noTable(error) ? NEEDS : error.message }, { status: 400 });
    }
    if (!data) return NextResponse.json({ error: "no such pack" }, { status: 404 });
    return NextResponse.json({
      title: data.title,
      pack: data.signed_pack ?? data.pack,
      signed: !!data.signed_at,
      signedAt: data.signed_at, signedName: data.signed_name,
      sentAt: data.sent_at, toName: data.to_name,
    });
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("signing_requests")
    .select("id, title, doc_count, to_name, to_email, to_phone, sent_at,"
      + " expires_at, opened_at, signed_at, signed_name, voided_at")
    .eq("owner_id", id).order("sent_at", { ascending: false }).limit(25);

  /* The migration not having run is not the same as nothing having been
     sent, and a screen that cannot tell them apart shows an empty list
     to somebody who sent three links this morning. */
  if (error) {
    if (noTable(error)) return NextResponse.json({ sent: [], listing: false, why: NEEDS });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ sent: data ?? [], listing: true });
}

/**
 * Withdraw one, so the link stops working.
 *
 * Only while it is unsigned. A signed contract is not a thing that can be
 * taken back by pressing a button here -- the other party is holding a
 * copy of it, and pretending otherwise would be worse than not offering
 * the button at all.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!isDesk(staff.role)) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null) as { id?: unknown } | null;
  const which = String(body?.id ?? "");
  if (!which) return NextResponse.json({ error: "which one?" }, { status: 400 });

  const db = supabaseAdmin();
  /* Filtered in the WRITE rather than checked first and written after: a
     signature arriving between the two would be withdrawn out from under
     somebody who had already signed. */
  const { data, error } = await db.from("signing_requests")
    .update({ voided_at: new Date().toISOString(), voided_by: staff.id })
    .eq("id", which).eq("owner_id", id)
    .is("signed_at", null).is("voided_at", null)
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: noTable(error) ? NEEDS : error.message }, { status: 400 });
  }
  if (!data || data.length === 0) {
    /* Nothing changed, and the reason matters. Said in the words the
       screen will show rather than as "not found". */
    const { data: row } = await db.from("signing_requests")
      .select("signed_at, voided_at, signed_name").eq("id", which)
      .eq("owner_id", id).maybeSingle();
    const r = row as { signed_at: string | null; voided_at: string | null;
                       signed_name: string | null } | null;
    if (r?.signed_at) {
      return NextResponse.json(
        { error: `${r.signed_name ?? "They"} already signed these. A signed`
          + " contract cannot be withdrawn here — they are holding a copy." },
        { status: 409 });
    }
    if (r?.voided_at) return NextResponse.json({ ok: true, already: true });
    return NextResponse.json({ error: "That one is not here." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
