import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { publicBase } from "@/lib/twilio";
import { runDueIfFree } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Send whatever leasing follow-ups have come due, because somebody opened a
 * screen. The cron fires once a day on this plan; the office opens the app
 * twenty times. Any signed-in member of staff may set it off -- it decides
 * nothing, it only sends what was already planned -- and the database makes
 * sure only one run happens at once.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  return NextResponse.json(await runDueIfFree(supabaseAdmin(), publicBase(req)));
}
