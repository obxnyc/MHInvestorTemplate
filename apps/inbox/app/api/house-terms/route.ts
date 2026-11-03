import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isDesk } from "@/lib/roles";
import { houseStandard } from "@/lib/house-terms";
import type { Terms } from "@/lib/papers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01"
    || /schema cache|does not exist/i.test(e.message ?? ""));

const NEEDS = "Keeping the house standard needs migration 049 run on the"
  + " database first.";

/**
 * The terms every new deal starts from.
 *
 * One row for the whole company. What comes back here is laid UNDER the
 * figures read off the homes and UNDER a draft somebody left on the screen,
 * so it decides the things nobody retypes -- the late fee, the grace
 * period, the notice period, which lease -- and decides nothing that
 * belongs to one sale.
 */
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("house_terms").select("terms, updated_at, by_staff").maybeSingle();

  /* The migration not having run is not the same as no standard having
     been set, and a screen that cannot tell them apart will offer a Save
     that writes into a table which is not there and call it saved. */
  if (error) {
    if (noTable(error)) {
      return NextResponse.json({ terms: null, keeping: false, why: NEEDS });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({
    /* Stripped on the way out as well as on the way in. A row written
       before DEAL_ONLY grew, or written by hand in the SQL editor, must
       not be able to put one investor's name on another's papers. */
    terms: data?.terms ? houseStandard(data.terms as Partial<Terms>) : null,
    savedAt: data?.updated_at ?? null,
    keeping: true,
  });
}

export async function PUT(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!isDesk(staff.role)) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as { terms?: unknown } | null;
  const terms = body?.terms;
  if (!terms || typeof terms !== "object" || Array.isArray(terms)) {
    return NextResponse.json({ error: "nothing to keep" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin().from("house_terms").upsert({
    only_row: true,
    terms: houseStandard(terms as Partial<Terms>),
    updated_at: new Date().toISOString(),
    by_staff: staff.id,
  }, { onConflict: "only_row" }).select("updated_at").single();

  if (error) {
    return NextResponse.json(
      { error: noTable(error) ? NEEDS : error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, savedAt: data.updated_at });
}
