import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { pullServiceIssues } from "@/lib/rm-issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Fetch the maintenance requests tenants submitted in Tenant Web Access.
 *
 * A rehearsal unless told otherwise: `{"go": true}` is what makes it write.
 * Re-running is safe -- `ingest` refuses an external id it has already seen,
 * so an issue pulled twice is one conversation.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const { go } = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await pullServiceIssues({ dryRun: go !== true }));
  } catch (e) {
    // Reported rather than thrown: a half-finished pull wants to say how far
    // it got, and a stack trace in a browser console is not that.
    console.error("rent manager issues pull failed", e);
    return NextResponse.json(
      { ok: false, error: (e as Error).message }, { status: 500 });
  }
}
