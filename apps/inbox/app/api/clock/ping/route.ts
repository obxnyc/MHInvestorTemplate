import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { readFix, defaultRadius, type Fence, type Fix } from "@/lib/fence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where somebody is, while they are on the clock.
 *
 * "More visibility on their movements through the workday when they are on
 * the clock" was the ask, and this is the narrowest thing that answers it.
 *
 * The narrowness is the design. A ping is only ever written against a shift
 * that is open and this person's own -- enforced by the row policy in 038,
 * not only by this route, so that it stays true however anybody else writes
 * to the table later. Clock out and the trail stops. The alternative, pinging
 * while somebody is merely logged in, is following people home.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.lat !== "number" || typeof body.lng !== "number") {
    return NextResponse.json({ error: "no position" }, { status: 400 });
  }
  const fix: Fix = {
    lat: body.lat, lng: body.lng,
    accuracy: typeof body.accuracy === "number" ? body.accuracy : null,
  };

  const db = await supabaseServer();
  const { data: open } = await db.from("shifts")
    .select("id, property_id").eq("staff_id", me.id).is("ended_at", null).maybeSingle();
  // Not an error on the screen. A ping that arrives a second after somebody
  // clocked out is a race, not a fault, and a red banner for it would teach
  // people to ignore red banners.
  if (!open) return NextResponse.json({ ok: true, clockedOut: true });

  let fence: Fence | null = null;
  if (open.property_id) {
    const { data: p } = await db.from("properties")
      .select("id, name, kind, lat, lng, fence_m").eq("id", open.property_id).maybeSingle();
    if (p?.lat !== null && p?.lat !== undefined && p?.lng !== null) {
      fence = {
        propertyId: String(p.id), name: String(p.name),
        lat: Number(p.lat), lng: Number(p.lng),
        radius: p.fence_m ? Number(p.fence_m) : defaultRadius(p.kind as string | null),
      };
    }
  }

  // Worked out now and stored, because the pin or the radius may be moved
  // afterwards and the reading that was taken is the one that happened.
  const reading = fence ? readFix(fix, fence) : null;

  const { error } = await db.from("shift_pings").insert({
    shift_id: open.id,
    lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy,
    fence: reading?.verdict ?? null,
    metres: reading && Number.isFinite(reading.metres) ? reading.metres : null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    fence: reading?.verdict ?? null,
    metres: reading && Number.isFinite(reading.metres)
      ? Math.round(reading.metres) : null,
  });
}
