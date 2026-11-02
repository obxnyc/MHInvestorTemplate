import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { pullTenants } from "@/lib/rm-tenants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sixty is the ceiling on this plan, and a function killed at it returns
// whatever Vercel serves rather than JSON. The work inside stops at
// thirty-five and says there is more.
export const maxDuration = 60;

/**
 * Bring the tenant roster across and attach each person to their unit.
 *
 * `{"go": true}` is what makes it write. Re-running updates the people
 * it already has rather than making a second copy of each — the join is
 * Rent Manager's own tenant id, added in migration 049.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const { go } = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await pullTenants({ dryRun: go !== true }));
  } catch (e) {
    console.error("rent manager tenant pull failed", e);
    return NextResponse.json(
      { ok: false, error: (e as Error).message }, { status: 500 });
  }
}
