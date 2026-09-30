import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { undoLastImport } from "@/lib/rm-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Take the import back out. Admin only, and a rehearsal unless told
 *  otherwise — the same rule as putting it in. */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const { go } = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await undoLastImport({ dryRun: go !== true }));
  } catch (e) {
    console.error("rent manager undo failed", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
