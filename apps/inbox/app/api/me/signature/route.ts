import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isDesk } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01"
    || /schema cache|does not exist/i.test(e.message ?? ""));

const NEEDS = "Keeping a signature needs migration 047 run on the database first.";

/** Two inches of signature is a few tens of kilobytes. A megabyte is
 *  somebody's photograph, and it would go into every document. */
const MOST = 400_000;

/** Your own signature. Never anybody else's: that is the whole point. */
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("signatures").select("png, signs_as, updated_at")
    .eq("staff_id", staff.id).maybeSingle();

  if (error) {
    /* The migration not having run is not the same as not having signed,
       and a screen that cannot tell them apart offers a tick box that
       silently does nothing. */
    if (noTable(error)) return NextResponse.json({ png: null, keeping: false, why: NEEDS });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({
    png: data?.png ?? null,
    signsAs: data?.signs_as ?? null,
    updatedAt: data?.updated_at ?? null,
    keeping: true,
  });
}

export async function PUT(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!isDesk(staff.role)) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as
    { png?: unknown; signsAs?: unknown } | null;
  const png = typeof body?.png === "string" ? body.png : "";

  /* A data URL and a PNG, checked rather than trusted: this string is
     written into every contract this person sends out, and "whatever the
     browser posted" is not a description of a signature. */
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(png)) {
    return NextResponse.json(
      { error: "That is not a PNG signature." }, { status: 400 });
  }
  if (png.length > MOST) {
    return NextResponse.json(
      { error: "That signature is too large. Draw it again, or crop the image"
        + " to the signature itself." }, { status: 400 });
  }

  const { error } = await supabaseAdmin().from("signatures").upsert({
    staff_id: staff.id,
    png,
    signs_as: typeof body?.signsAs === "string" ? body.signsAs.trim() || null : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "staff_id" });

  if (error) {
    return NextResponse.json(
      { error: noTable(error) ? NEEDS : error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

/** Taking it off again, which somebody will want the day they resign. */
export async function DELETE() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!isDesk(staff.role)) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const { error } = await supabaseAdmin()
    .from("signatures").delete().eq("staff_id", staff.id);
  if (error) {
    return NextResponse.json(
      { error: noTable(error) ? NEEDS : error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
