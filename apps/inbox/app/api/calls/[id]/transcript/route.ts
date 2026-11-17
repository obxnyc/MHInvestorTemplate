import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { collectTranscript, startTranscript, summarizeCall } from "@/lib/transcribe";

export const runtime = "nodejs";

/**
 * "Get transcript" on a call whose transcript has not arrived.
 *
 * Twilio's webhook is the normal way in, and webhooks do not always arrive.
 * This asks Twilio directly for every recording on the call, starts any that
 * were never started, and writes the summary if there is something to
 * summarise. Safe to press twice.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const db = supabaseAdmin();

  const { data: recs } = await db.from("call_recordings")
    .select("id, recording_sid, kind, transcript_sid, transcript_status")
    .eq("call_id", id);

  const said: string[] = [];
  for (const r of recs ?? []) {
    if (r.kind !== "call" || r.transcript_status === "completed") continue;
    try {
      if (!r.transcript_sid) {
        await startTranscript(r.id, r.recording_sid);
        said.push("started");
      } else {
        said.push(await collectTranscript(r.transcript_sid));
      }
    } catch (e) {
      said.push(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const { data: call } = await db.from("calls").select("summary").eq("id", id).maybeSingle();
  if (!call?.summary) await summarizeCall(id);

  const waiting = said.some((x) => x === "started" || x === "waiting" || x.startsWith("queued"));
  return NextResponse.json({
    ok: true, waiting,
    message: waiting ? "Twilio is still transcribing. Try again in a minute."
      : said.find((x) => x.startsWith("error")) ?? "Up to date.",
  });
}
