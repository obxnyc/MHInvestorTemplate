import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { byParcelNumber, suggestionById, refOf } from "@/lib/parcel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Yes, it is that one." A county parcel, chosen from the suggestions, kept
 * as this property's parcel and its pin -- so its map opens on its own land
 * inside its own line.
 *
 * The property is read through the person's own client first, so nobody can
 * set the parcel of a property they cannot see.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { data: property } = await supabase.from("properties")
    .select("id, plan").eq("id", id).maybeSingle();
  if (!property) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const sid = String(body.id ?? "");
  const m = sid.match(/^nc:([^:]+):(.+)$/);
  if (!m) return NextResponse.json({ error: "Which parcel?" }, { status: 400 });

  const [parcel, point] = await Promise.all([byParcelNumber(m[1], m[2]), suggestionById(sid)]);
  if (!parcel) {
    return NextResponse.json({
      error: "The state's parcel service did not answer for that one. Try again in a minute.",
    }, { status: 502 });
  }
  const { error } = await supabaseAdmin().from("properties").update({
    parcel_geojson: parcel, parcel_ref: refOf(parcel), parcel_at: new Date().toISOString(),
    ...(point ? { lat: point.lat, lng: point.lng } : {}),
  }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ref: refOf(parcel) });
}
