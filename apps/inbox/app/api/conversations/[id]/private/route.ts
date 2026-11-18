import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DESK } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who a conversation is private to.
 *
 * The owner, 18 November 2026: anyone may make a conversation private to
 * themselves and the people they name; he always sees everything. The
 * privacy itself is a row policy (072) -- this route only changes the list.
 *
 * Everything is read through the person's own client first, so somebody
 * cannot change the privacy of a conversation they cannot see.
 */
async function visible(id: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("conversations")
    .select("id, private_to, category").eq("id", id).maybeSingle();
  return data as { id: string; private_to: string[] | null; category: string | null } | null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const convo = await visible(id);
  if (!convo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const db = supabaseAdmin();
  const { data: people } = await db.from("staff")
    .select("id, full_name, reads_all_dms").eq("active", true).in("role", DESK)
    .order("full_name");
  return NextResponse.json({
    me: me.id,
    privateTo: convo.private_to ?? [],
    people: (people ?? []).map((p) => ({
      id: p.id, name: p.full_name, always: Boolean(p.reads_all_dms),
    })),
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const convo = await visible(id);
  if (!convo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const given: unknown[] = Array.isArray(body.people) ? body.people : [];
  const db = supabaseAdmin();

  // A repair is everybody's business (owner, 18 November 2026). Migration
  // 073 refuses this in the database too; said here first, in words.
  if (given.length && convo.category === "maintenance") {
    return NextResponse.json({
      error: "Maintenance stays shared so everyone can see the repair. Change the category first if this is not a repair.",
    }, { status: 400 });
  }

  let next: string[] | null = null;
  if (given.length) {
    const ids = [...new Set(given.map((x) => String(x)))];
    const { data: real } = await db.from("staff")
      .select("id").eq("active", true).in("id", ids);
    next = (real ?? []).map((r) => r.id as string);
    // Private to themselves and others -- never a conversation somebody
    // locks themselves out of by mistake. The owner reads everything
    // whatever the list says, so he need not be on it.
    const readsAll = Boolean((me as { reads_all_dms?: boolean }).reads_all_dms);
    if (!readsAll && !next.includes(me.id)) next.push(me.id);
    if (!next.length) next = null;
  }

  const { error } = await db.from("conversations").update({ private_to: next }).eq("id", id);
  if (error) {
    return NextResponse.json({
      error: /stays shared/.test(error.message)
        ? "Maintenance stays shared so everyone can see the repair. Change the category first if this is not a repair."
        : /private_to/.test(error.message)
        ? "Migration 072 hasn't been run, so a conversation cannot be made private yet."
        : error.message,
    }, { status: 500 });
  }
  return NextResponse.json({ ok: true, privateTo: next ?? [] });
}
