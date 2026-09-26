import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { importFromRentManager } from "@/lib/rm-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Pull the portfolio across. Admin only, and a rehearsal unless told
 *  otherwise: `{"go": true}` is what makes it write. */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { go } = await req.json().catch(() => ({}));
  try {
    const out = await importFromRentManager({ dryRun: go !== true, staffId: me.id });
    return NextResponse.json(out);
  } catch (e) {
    // Reported rather than thrown: a half-finished import wants to say how
    // far it got, and a stack trace in a browser console is not that.
    console.error("rent manager import failed", e);
    return NextResponse.json(
      { ok: false, error: (e as Error).message }, { status: 500 });
  }
}
