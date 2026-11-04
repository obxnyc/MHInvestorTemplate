import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { runDueIfFree, baseUrl } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The once-a-day backstop for leasing follow-ups, for the days nobody opens
 * the app. Scheduled at midday Eastern rather than first thing, because
 * quiet hours (8am to 9pm where the person is) would turn a 6am run into a
 * run that sends nothing.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runDueIfFree(supabaseAdmin(), baseUrl(new URL(req.url).origin), 0));
}
