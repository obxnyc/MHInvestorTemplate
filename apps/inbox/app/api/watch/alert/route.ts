import { NextResponse } from "next/server";
import { cronKeyOk } from "@/lib/cron-key";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { pushToStaff } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A watched word was just written. Tell the owner, now.
 *
 * Called by the database (072's `watch_hit_alert`), with the reports key read
 * from Vault and checked here by `report_key_ok` -- the same arrangement as
 * every scheduled job, so no secret is copied anywhere.
 *
 * Claimed before it is sent: `alerted_at` is set only where it was empty, so
 * a retried call cannot alert twice. An alert that reaches no device is still
 * a hit on the Record page, highlighted -- the notification is the fast way
 * to hear about it, never the only one.
 */
export async function POST(req: Request) {
  if (!(await cronKeyOk(req, "report_key_ok"))) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const hitId = Number(body.hit);
  if (!Number.isFinite(hitId)) return NextResponse.json({ error: "which hit" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: claimed } = await db.from("watch_hits")
    .update({ alerted_at: new Date().toISOString() })
    .eq("id", hitId).is("alerted_at", null)
    .select("id, phrase, record_id").maybeSingle();
  if (!claimed) return NextResponse.json({ ok: true, already: true });

  const { data: rec } = await db.from("message_record")
    .select("source, body, direction, author_id, conversation_id, thread_id")
    .eq("id", claimed.record_id).maybeSingle();

  let who = "";
  if (rec?.author_id) {
    const { data: s } = await db.from("staff").select("full_name").eq("id", rec.author_id).maybeSingle();
    who = s?.full_name ?? "";
  }
  const where = rec?.source === "team" ? "team chat"
    : rec?.source === "note" ? "an internal note"
    : rec?.direction === "inbound" ? "a text to the company line" : "a text from the company line";

  const { data: owners } = await db.from("staff")
    .select("id").eq("active", true).eq("reads_all_dms", true);
  const took = await pushToStaff((owners ?? []).map((o) => o.id as string), {
    title: `Watch: "${claimed.phrase}"`,
    body: `${who ? `${who} in ` : "In "}${where}: ${(rec?.body ?? "").slice(0, 140)}`,
    url: `/record?hit=${claimed.id}`,
    tag: `watch:${claimed.id}`,
    urgent: true,
  }).catch(() => 0);

  return NextResponse.json({ ok: true, took });
}
