import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { pushToStaff } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily housekeeping.
 *
 * Threads that can lapse do. Threads that cannot — maintenance, and tenant
 * conversations with nothing written on them — get pushed back in front of
 * somebody instead, on a repeating cadence, until a person answers. Silence
 * stops being a way for work to disappear.
 */
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const days = Number(process.env.AUTOCLOSE_DAYS ?? 30);
  const quiet = Number(process.env.RECYCLE_QUIET_DAYS ?? 7);
  const repeat = Number(process.env.RECYCLE_REPEAT_DAYS ?? 7);

  const [{ data: closed, error: e1 }, { data: recycled, error: e2 }] = await Promise.all([
    db.rpc("autoclose_idle_conversations", { p_days: days }),
    db.rpc("recycle_open_conversations", { p_quiet_days: quiet, p_repeat_days: repeat }),
  ]);
  if (e1 || e2) {
    return NextResponse.json({ error: (e1 ?? e2)!.message }, { status: 500 });
  }

  const { data: queue } = await db
    .from("needs_closure_check").select("*").limit(50);

  // Route each prompt to the people who can actually answer it.
  //
  // Whoever holds the thread if someone does; otherwise the team that owns the
  // category — an unclaimed furnace goes to the maintenance crew, not to
  // everyone. Pushing the whole office for every stale thread is how people
  // learn to swipe these away.
  if (queue?.length) {
    const teamIds = [...new Set(queue.map((r) => r.team_id).filter(Boolean))] as string[];
    const { data: members } = teamIds.length
      ? await db.from("team_members").select("team_id, staff_id").in("team_id", teamIds)
      : { data: [] as { team_id: string; staff_id: string }[] };

    const byTeam = new Map<string, string[]>();
    for (const m of members ?? []) {
      byTeam.set(m.team_id, [...(byTeam.get(m.team_id) ?? []), m.staff_id]);
    }

    const { data: fallback } = await db.from("staff")
      .select("id").eq("active", true).in("role", ["admin", "office"]);

    // Each person hears about their own items and nobody else's.
    const perPerson = new Map<string, typeof queue>();
    for (const row of queue) {
      const recipients = row.assigned_to
        ? [row.assigned_to as string]
        : byTeam.get(row.team_id as string) ?? (fallback ?? []).map((s) => s.id);
      for (const id of recipients) {
        perPerson.set(id, [...(perPerson.get(id) ?? []), row]);
      }
    }

    await Promise.all([...perPerson].map(([staffId, rows]) => {
      const repeats = rows.filter((r) => r.closure_prompts >= 3).length;
      const oldest = rows[0];
      return pushToStaff([staffId], {
        title: `${rows.length} to close out`,
        body: repeats
          ? `${repeats} asked ${oldest.closure_prompts}+ times — "${oldest.subject}"`
          : `Quiet ${oldest.days_quiet} days — "${oldest.subject}"`,
        url: "/?show=closing",
        tag: "closure-check",
      });
    }));
  }

  return NextResponse.json({
    ok: true,
    closed: closed ?? 0,
    recycled: recycled ?? 0,
    awaitingAnswer: queue?.length ?? 0,
  });
}
