import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { cronKeyOk } from "@/lib/cron-key";
import { newYork } from "@/lib/delinquency";
import { draftsToday, readSettings, sendDrafts, syncCollections } from "@/lib/collections-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The hourly collections read, woken by pg_cron (migration 069).
 *
 * Reads every balance from Rent Manager, moves anybody still owing on the
 * 6th to the late step, re-judges every promise against the money -- and,
 * ONLY when somebody has switched automatic reminders on, sends the day's
 * texts at the send hour. Until then the screen drafts them and a person
 * presses Send.
 *
 *   ?dry=1  read and judge, but send nothing and list what would go.
 */
async function handle(req: Request) {
  if (!(await cronKeyOk(req, "report_key_ok"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const db = supabaseAdmin();
  const sync = await syncCollections(db, 40).catch((e) => ({
    ok: false, error: (e as Error).message, tenants: 0, owing: 0, partial: false, moved: 0, judged: 0,
  }));

  const settings = await readSettings(db);
  const hour = newYork(new Date()).hour;
  let texts: unknown = { skipped: settings.autoSend ? `sends at ${settings.sendHour}:00, it is ${hour}:00` : "automatic reminders are off" };
  if (settings.autoSend && hour === settings.sendHour) {
    const { drafts } = await draftsToday(db, settings);
    texts = dry ? { wouldSend: drafts.map((d) => ({ name: d.name, kind: d.kind, body: d.body })) }
      : await sendDrafts(db, drafts, null);
  }
  console.log("cron/collections", { sync, texts });
  return NextResponse.json({ sync, texts }, { status: sync.ok ? 200 : 502 });
}

export const GET = handle;
export const POST = handle;
