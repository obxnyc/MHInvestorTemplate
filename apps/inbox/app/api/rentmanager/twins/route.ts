import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isDesk } from "@/lib/roles";
import { twinFragment, titledAs } from "@/lib/sameissue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The same request, sitting in the list twice.
 *
 * Every Tenant Web Access issue has arrived two ways for months: an
 * email carrying the tenant, their number and the address, and an hourly
 * pull carrying none of them. `ingest` joins them now, but it cannot go
 * back -- the ones already here are already two threads, and the empty
 * one is as likely to be the one somebody opens.
 *
 * This finds them. It does not touch anything until asked, and what it
 * asks to do is CLOSE the empty one, not delete it: a thread somebody
 * might have written on is not a thing to remove because a rule said it
 * was redundant.
 */

type Row = {
  id: string; created_at: string; conversation_id: string; body: string;
  external_id: string | null;
};

const PICK = "id, created_at, conversation_id, body, external_id";

/** The pulled half: it says where it came from, in its own last line. */
const isPulled = (body: string) => /From Rent Manager Service Manager, issue \d+/i.test(body);

async function findTwins(db: ReturnType<typeof supabaseAdmin>, days: number) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const { data, error } = await db.from("messages")
    .select(PICK).eq("direction", "inbound").gte("created_at", since)
    .order("created_at", { ascending: true }).limit(2000);
  if (error) throw new Error(error.message);

  const all = (data ?? []) as unknown as Row[];
  const pulled = all.filter((m) => isPulled(m.body ?? ""));

  const pairs: {
    pulledMessageId: string; pulledConversationId: string;
    keepConversationId: string; title: string | null; when: string;
  }[] = [];

  for (const one of pulled) {
    const fragment = twinFragment(one.body ?? "");
    if (!fragment) continue;
    /* The twin is the OTHER arrival of the same words, in a different
       thread. Matched on the tenant's sentence, which both carry
       verbatim, and never against itself. */
    const other = all.find((m) =>
      m.conversation_id !== one.conversation_id
      && !isPulled(m.body ?? "")
      && (m.body ?? "").includes(fragment));
    if (!other) continue;
    pairs.push({
      pulledMessageId: one.id,
      pulledConversationId: one.conversation_id,
      keepConversationId: other.conversation_id,
      title: titledAs(one.body ?? ""),
      when: one.created_at,
    });
  }
  return pairs;
}

/** What is doubled up, read-only. Nothing here changes anything. */
export async function GET(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const days = Math.min(Number(new URL(req.url).searchParams.get("days") ?? 90) || 90, 365);
  const db = supabaseAdmin();
  try {
    const pairs = await findTwins(db, days);
    /* The thread being KEPT is named by what it knows, so somebody can
       see at a glance that the right one is being kept. */
    const keepIds = [...new Set(pairs.map((p) => p.keepConversationId))];
    const { data: keeps } = keepIds.length
      ? await db.from("conversations")
          .select("id, subject, contacts(full_name, phone)").in("id", keepIds)
      : { data: [] };
    const named = new Map((keeps ?? []).map((c) => {
      const who = (c as { contacts?: { full_name?: string | null;
        phone?: string | null } | null }).contacts;
      return [String((c as { id: string }).id),
        who?.full_name || who?.phone || (c as { subject?: string | null }).subject || null];
    }));
    return NextResponse.json({
      days,
      pairs: pairs.map((p) => ({ ...p, keepIsFor: named.get(p.keepConversationId) ?? null })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

/**
 * Close the empty ones.
 *
 * Closed, not deleted, and only the ones named in the request -- which
 * came from the list above, which somebody has looked at. A thread is
 * skipped outright if anybody has replied on it: that is no longer a
 * duplicate, it is a conversation.
 */
export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!isDesk(staff.role)) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? body.ids.map(String).filter(Boolean).slice(0, 500) : [];
  if (!ids.length) return NextResponse.json({ error: "nothing named" }, { status: 400 });

  const db = supabaseAdmin();
  const closed: string[] = [];
  const kept: string[] = [];

  for (const id of ids) {
    /* ANYBODY HAVING REPLIED MAKES IT A CONVERSATION. The duplicate is
       only a duplicate while it is untouched. */
    const { count } = await db.from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", id).eq("direction", "outbound");
    if ((count ?? 0) > 0) { kept.push(id); continue; }

    const { error } = await db.from("conversations")
      .update({ status: "closed" }).eq("id", id).neq("status", "closed");
    if (error) { kept.push(id); continue; }
    closed.push(id);
  }

  /* BOTH NUMBERS, ALWAYS. Twenty closed out of thirty is not a success
     and is not a failure, and reporting it as either hides the ten. */
  return NextResponse.json({ ok: true, closed: closed.length, kept: kept.length });
}
