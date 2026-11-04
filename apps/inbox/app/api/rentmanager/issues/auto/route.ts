import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { pullServiceIssues } from "@/lib/rm-issues";
import { repairIssues } from "@/lib/rm-repair";
import { pullTenants } from "@/lib/rm-tenants";
import { supabaseAdmin } from "@/lib/supabase-admin";

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
  /* How many requests already here had a tenant, a number or an address
     put back on them this time round. */
  let mended = 0;
  let stillBlank = 0;

  // Sixty is the hard ceiling and a function killed at it returns no JSON
  // at all. The pull gets most of what is left; the repair gets the rest,
  // and both stop themselves rather than being stopped.
  const started = Date.now();
  const left = () => 50 - Math.round((Date.now() - started) / 1000);

  try {
    const out = await pullServiceIssues({ dryRun: false, seconds: 30 });
    filed = out.filed ?? 0;
    ok = out.ok === true;
    if (!ok) error = (out as { error?: string }).error ?? "the pull did not finish";
  } catch (e) {
    error = (e as Error).message;
  }

  /* AND THEN MEND THE ONES THAT ARE ALREADY IN.
   *
   * Not a separate button on a page nobody opens. Every request pulled
   * before the tenant lookup worked is filed naming nobody, and the pull
   * cannot touch them -- `ingest` refuses an id it has seen and returns,
   * which is exactly what makes it safe to run this often.
   *
   * So the same minute that fetches what is new also goes back for a few
   * of the ones that arrived blank. Three hundred of them do not mend in
   * one go and are not meant to: a dozen each time somebody opens the
   * inbox clears the backlog over a morning, with nobody pressing
   * anything and nothing to wait for.
   */
  if (ok && left() > 8) {
    try {
      const fixed = await repairIssues({ dryRun: false, seconds: left() - 3 });
      mended = fixed.mended ?? 0;
      stillBlank = Math.max(0, (fixed.unidentified ?? 0) - mended);
    } catch {
      // Never fails the pull. What came in is what the office is waiting
      // for; tidying what is already here is not worth losing it over.
    }
  }

  /* Recorded whatever happened. A failure that is not written leaves the row
     claimed, and the next caller is refused until the dead window passes --
     so a Rent Manager that is simply down would stop the inbox pulling at
     all rather than retrying in five minutes. */
  await db.rpc("finish_issue_pull", {
    p_ok: ok, p_filed: filed, p_error: error,
  });

  /* AND THE TENANT ROSTER, WHICH NOBODY IS GOING TO PRESS A BUTTON FOR.
   *
   * It shipped as a button on the Rent Manager page and the button was
   * never pressed, so the roster stayed empty and nothing downstream
   * changed -- the office still typed every tenant's name from memory,
   * and it read as the whole feature not working. It was not broken. It
   * was waiting for somebody, which for a thing that has to happen once
   * is the same as broken.
   *
   * Second time in this file: the repair pass learned the same lesson.
   * A step that only ever needs doing once is exactly the step nobody
   * remembers to do.
   *
   * Not on every inbox open, though -- a roster of several hundred
   * people does not change between lunch and the afternoon. Only when
   * there is nothing yet, or when what is here is a day old, and only
   * with whatever time the pull and the repair have left.
   */
  let roster = 0;
  if (ok && left() > 12) {
    try {
      const db = supabaseAdmin();
      const { count } = await db.from("contacts")
        .select("id", { count: "exact", head: true })
        .not("rm_tenant_id", "is", null);
      const { data: fresh } = await db.from("contacts")
        .select("updated_at").not("rm_tenant_id", "is", null)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const staleBy = fresh?.updated_at
        ? Date.now() - new Date(String(fresh.updated_at)).getTime()
        : Infinity;
      if (!count || staleBy > 20 * 3600_000) {
        const got = await pullTenants({ dryRun: false, seconds: left() - 4 });
        roster = (got.added ?? 0) + (got.updated ?? 0) + (got.merged ?? 0);
      }
    } catch {
      // Never fails the pull. New requests are what the office is
      // waiting for; the roster can wait for the next open.
    }
  }

  return NextResponse.json({ ok, filed, mended, stillBlank, roster, error });
}
