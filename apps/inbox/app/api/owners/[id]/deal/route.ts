import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isDesk } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Postgres saying the table is not there, which here means one thing. */
const noTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01"
    || /schema cache|does not exist/i.test(e.message ?? ""));

const NEEDS = "Saving a deal needs migration 046 run on the database first.";

/**
 * The deal somebody is working on for this investor.
 *
 * A draft and nothing more: the sale is still recorded on the lot card and
 * the document is still the file that was printed. This is so that eight
 * homes' worth of figures, switches and descriptions are still there after
 * a reload -- which until now they were not, silently.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("deal_drafts").select("deal, updated_at, by_staff")
    .eq("owner_id", id).maybeSingle();

  /* The migration not having run is not the same as there being no draft,
     and a screen that cannot tell them apart will offer to save into a
     table that is not there and call it saved. */
  if (error) {
    if (noTable(error)) {
      return NextResponse.json({ deal: null, saving: false, why: NEEDS });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({
    deal: data?.deal ?? null,
    savedAt: data?.updated_at ?? null,
    saving: true,
  });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!isDesk(staff.role)) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null) as { deal?: unknown } | null;
  const deal = body?.deal;
  if (!deal || typeof deal !== "object") {
    return NextResponse.json({ error: "nothing to save" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin().from("deal_drafts").upsert({
    owner_id: id,
    deal,
    updated_at: new Date().toISOString(),
    by_staff: staff.id,
  }, { onConflict: "owner_id" }).select("updated_at").single();

  if (error) {
    return NextResponse.json(
      { error: noTable(error) ? NEEDS : error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, savedAt: data.updated_at });
}
