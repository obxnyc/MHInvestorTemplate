import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { pullTenants } from "@/lib/rm-tenants";
import { cronKeyOk } from "@/lib/cron-key";

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
 * Rent Manager's own tenant id, added in migration 050.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { go } = body;
  const explain = Array.isArray(body?.explain)
    ? (body.explain as unknown[]).map(Number).filter(Number.isFinite).slice(0, 25) : undefined;

  /* The reports key may READ, never write: a dry run, with the "why is
     this tenant not on a unit" answer, asked from the database without
     anybody signing in. Writing stays an admin's press. */
  const me = await requireStaff();
  const admin = me?.role === "admin";
  if (!admin) {
    if (go === true || !(await cronKeyOk(req, "report_key_ok"))) {
      return NextResponse.json({ error: "not allowed" }, { status: 403 });
    }
  }
  try {
    return NextResponse.json(await pullTenants({ dryRun: !(admin && go === true), explain }));
  } catch (e) {
    console.error("rent manager tenant pull failed", e);
    return NextResponse.json(
      { ok: false, error: (e as Error).message }, { status: 500 });
  }
}
