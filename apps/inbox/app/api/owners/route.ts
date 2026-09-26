import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The LLCs that hold the property.
 *
 *  Tolerant of migration 017 not having run: returns an empty list rather than
 *  failing, so the properties screen still works and simply does not offer an
 *  owner to file things under. */
export async function GET() {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("owners").select("id, name, legal_name").eq("active", true).order("name");

  return NextResponse.json({ owners: error ? [] : (data ?? []), configured: !error });
}

export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { name, legalName } = await req.json().catch(() => ({}));
  const label = String(name ?? "").trim();
  if (label.length < 2) {
    return NextResponse.json({ error: "Give it a name." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin().from("owners").insert({
    name: label,
    legal_name: String(legalName ?? "").trim() || null,
  }).select("id, name").single();

  if (error) {
    // 42P01 is "no such table", which here means one thing only: migration 017
    // has not been run. Saying that is the difference between a five-minute
    // fix and an afternoon staring at a dropdown that will not fill.
    const why = error.code === "23505"
      ? "There is already an owner by that name."
      : error.code === "42P01" || /schema cache|does not exist/i.test(error.message)
        ? "Owners need migration 017 run on the database first."
        : error.message;
    return NextResponse.json({ error: why }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...data });
}
