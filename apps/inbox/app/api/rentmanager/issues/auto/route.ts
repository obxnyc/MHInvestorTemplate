import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { pullServiceIssues } from "@/lib/rm-issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sixty is the ceiling on Vercel's Hobby plan, and a function killed at the
// ceiling returns whatever Vercel serves rather than JSON.
export const maxDuration = 60;

/** How stale the last pull must be before anybody bothers again. */
const STALE_MINUTES = 5;
/** When a pull that never reported back is presumed dead. Longer than the
 *  function can possibly run, so a live one is never trampled; short enough
 *  that one killed at the ceiling does not hold the door shut. */
const DEAD_MINUTES = 3;

/**
 * Pull the maintenance requests because somebody opened the inbox.
 *
 * "We got a maintenance request on Tenant Web Access today and I am not
 * seeing it on our platform. That can't happen."
 *
 * It could, and this is why: the only automatic path was a cron, and on this
 * plan a cron fires ONCE A DAY whatever the expression says. A request filed
 * at ten in the morning waited until a quarter past seven the next day.
 *
 * The office opens the inbox twenty times a day, so that is the schedule this
 * plan actually has. Whoever opens it asks whether anything has been pulled
 * lately, and pulls if not. The cron stays as the backstop for the hours when
 * nobody is looking.
 *
 * NOT ADMIN-ONLY, unlike the button on the Rent Manager page. That one is a
 * person deciding to import; this is the application keeping itself current,
 * and a feature that works only when the admin happens to be the one looking
 * is a feature that does not work.
 *
 * Whether to pull at all is decided by the DATABASE, in one statement -- see
 * migration 042. Asking "when did it last run" and then deciding here is a
 * race the width of a round trip, and the whole point is that several people
 * open the inbox at once.
 */
export async function POST() {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const db = await supabaseServer();
  const { data: mine, error: claimError } = await db.rpc("claim_issue_pull", {
    p_stale: STALE_MINUTES, p_dead: DEAD_MINUTES,
  });

  if (claimError) {
    /* Named, because the alternative is a feature that silently never runs.
       The function arrives with migration 042; before that this says so
       rather than looking like "nothing new". */
    return NextResponse.json({
      ok: false, skipped: true,
      needs: "Run migration 042 so the inbox can fetch new requests.",
    });
  }
  // Somebody else is on it, or one ran a minute ago. Both are fine.
  if (mine !== true) return NextResponse.json({ ok: true, skipped: true, filed: 0 });

  let filed = 0;
  let ok = false;
  let error: string | null = null;
  try {
    const out = await pullServiceIssues({ dryRun: false });
    filed = out.filed ?? 0;
    ok = out.ok === true;
    if (!ok) error = (out as { error?: string }).error ?? "the pull did not finish";
  } catch (e) {
    error = (e as Error).message;
  }

  /* Recorded whatever happened. A failure that is not written leaves the row
     claimed, and the next caller is refused until the dead window passes --
     so a Rent Manager that is simply down would stop the inbox pulling at
     all rather than retrying in five minutes. */
  await db.rpc("finish_issue_pull", {
    p_ok: ok, p_filed: filed, p_error: error,
  });

  return NextResponse.json({ ok, filed, error });
}
