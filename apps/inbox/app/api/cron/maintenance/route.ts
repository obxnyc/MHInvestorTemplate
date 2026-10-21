import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { pullServiceIssues } from "@/lib/rm-issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sixty is the ceiling on Vercel's Hobby plan, and a function killed at
// the ceiling does not return JSON -- it returns whatever Vercel serves,
// which the browser then reports as "Unexpected end of JSON input".
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The maintenance requests, fetched on a schedule.
 *
 * Not a webhook, because Rent Manager does not offer one here: the only
 * thing it volunteers is the Tenant Web Access notification email, and that
 * email is the long path — a Gmail filter, Postmark, a webhook — where a
 * request can fall down silently at any step. So this asks instead.
 *
 * Polling is not the same as realtime and the difference is the interval.
 * The schedule in vercel.json asks for once a day, and that is not a
 * preference -- it is the most this plan will accept.
 *
 * WHAT THE PLAN ALLOWS IS NOT WHAT THE SCHEDULE ASKS FOR, and asking for
 * more does not get clamped. It FAILS THE BUILD. This line said hourly for
 * a day and every deployment in that day was refused with "Hobby accounts
 * are limited to daily cron jobs", so twelve commits of work sat on main
 * while the live site served the build from before them. Nothing said so
 * from this end: a merge that shipped and a merge that was refused look
 * identical here.
 *
 * So on Hobby this is a daily backstop and the button on the Rent Manager
 * page is what brings a request in now. On Pro, an hourly expression
 * becomes hourly -- one line in vercel.json, no code change, and
 * `plan-check.mjs` is the thing that has to be told as well.
 * (The frequency is written in words rather than as an expression because
 * a cron expression starting with a star and a slash ends a block comment,
 * which is how this file stopped compiling the first time.)
 *
 * The email alerts carry on arriving as they do now; this is the copy that
 * lands somewhere a person works.
 *
 * Safe to run as often as the schedule allows: `ingest` refuses an
 * external_id it has already seen, so the only thing a run with nothing new
 * in it costs is one request to Rent Manager.
 */
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const out = await pullServiceIssues({ dryRun: false });
    // Said in the logs either way. A sync that quietly stops working is the
    // failure this whole thing exists to end, and "it ran and found none"
    // and "it could not sign in" look identical from the outside.
    console.log("cron/maintenance", {
      ok: out.ok, found: out.found, filed: out.filed,
      alreadyHad: out.alreadyHad, failed: out.failed, error: out.error,
    });
    return NextResponse.json(out);
  } catch (e) {
    console.error("cron/maintenance failed", e);
    return NextResponse.json(
      { ok: false, error: (e as Error).message }, { status: 500 });
  }
}
