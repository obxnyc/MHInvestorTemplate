import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The watch-list, and marking a hit as looked at.
 *
 * Everything through the signed-in person's own client: the row policies in
 * 072 let only whoever reads everything -- the owner -- read or change these,
 * so this route needs no rule of its own and cannot drift from that one.
 */
const owner = (me: unknown) => Boolean((me as { reads_all_dms?: boolean } | null)?.reads_all_dms);

export async function GET() {
  const me = await requireStaff();
  if (!owner(me)) return NextResponse.json({ error: "not available" }, { status: 403 });
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("watch_words")
    .select("id, phrase, active, created_at").order("phrase");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ words: data ?? [] });
}

export async function POST(req: Request) {
  const me = await requireStaff();
  if (!owner(me) || !me) return NextResponse.json({ error: "not available" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const supabase = await supabaseServer();

  if (body.action === "add") {
    const phrase = String(body.phrase ?? "").trim().replace(/\s+/g, " ");
    if (phrase.length < 2) {
      return NextResponse.json({ error: "Type at least two letters." }, { status: 400 });
    }
    const { error } = await supabase.from("watch_words").insert({ phrase, created_by: me.id });
    if (error) {
      return NextResponse.json({
        error: /duplicate|unique/i.test(error.message) ? `"${phrase}" is already watched.` : error.message,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "remove") {
    const { data, error } = await supabase.from("watch_words")
      .delete().eq("id", String(body.id)).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: "That word was not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "seen") {
    const ids: unknown[] = Array.isArray(body.ids) ? body.ids : [];
    const { error } = await supabase.from("watch_hits")
      .update({ seen_at: new Date().toISOString() })
      .in("id", ids.map((x) => Number(x)).filter(Number.isFinite)).is("seen_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
