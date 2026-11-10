import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { geocode } from "@/lib/agol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Put a pin on every job site that has an address and no pin.
 *
 * The fence is a radius around a pin, so a property with no pin is a site
 * the phone can never recognise: every clock-in there reads "could not
 * tell". On the day this was written that was 112 of 114 properties.
 *
 * The pins are the Census geocoder's, and they go in UNCONFIRMED -- an
 * address point is the middle of the parcel at best and the wrong end of the
 * road at worst, and the property screen is where somebody looks and says
 * yes. A pin already there is never moved.
 *
 * Stops with time to spare under the sixty-second ceiling and says `more`;
 * pressing again carries on, because the ones done now have a pin.
 */
export async function POST() {
  const me = await requireStaff();
  if (me?.role !== "admin" && me?.role !== "office") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const started = Date.now();
  const db = supabaseAdmin();
  const { data, error } = await db.from("properties")
    .select("id, name, address").is("lat", null).not("address", "is", null).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const todo = (data ?? []).filter((p) => String(p.address ?? "").trim().length > 5);
  const pinned: string[] = [];
  const missed: string[] = [];
  let i = 0;
  for (; i < todo.length; i++) {
    if (Date.now() - started > 40_000) break;
    const p = todo[i];
    const at = await geocode(String(p.address)).catch(() => null);
    if (!at) { missed.push(String(p.name)); continue; }
    const { error: e } = await db.from("properties")
      .update({ lat: at.lat, lng: at.lng, confirmed_at: null, confirmed_by: null })
      .eq("id", p.id).is("lat", null);
    if (e) missed.push(String(p.name)); else pinned.push(String(p.name));
  }
  return NextResponse.json({
    ok: true, pinned: pinned.length, missed, more: i < todo.length,
  });
}
