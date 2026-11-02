import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { repairIssues } from "@/lib/rm-repair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sixty is the ceiling on the Hobby plan, and a function killed at the
// ceiling returns whatever Vercel serves rather than JSON. The work inside
// stops at thirty-five and says there is more.
export const maxDuration = 60;

/**
 * Put a name, a number and a lot back on requests already filed without.
 *
 * `{"go": true}` is what makes it write. Everything else is a rehearsal
 * that reports what it would change.
 *
 * Safe to press repeatedly: a thread that has been mended no longer counts
 * as unidentified, so each run starts where the last one stopped.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const { go } = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await repairIssues({ dryRun: go !== true }));
  } catch (e) {
    console.error("rent manager repair failed", e);
    return NextResponse.json(
      { ok: false, error: (e as Error).message }, { status: 500 });
  }
}
