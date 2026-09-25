import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { signMedia } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A conversation, as data.
 *
 *  Exists so that opening a thread does not mean loading a page. Everything
 *  here is read through the signed-in user's client, so row-level security
 *  decides what comes back exactly as it does when the same thread is rendered
 *  on the server -- one set of rules, not two that drift. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await supabaseServer();

  const { data: convo } = await supabase
    .from("conversations")
    .select("id, category, source, status, subject, category_confidence, closure_prompts, assigned_to, unit_id, units(label, properties(name, color)), contacts(id, phone, full_name, party, unit_id, language, units(label, properties(name, color))), staff:assigned_to(full_name)")
    .eq("id", id).single();
  if (!convo) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Asked separately, and allowed to fail.
  //
  // This column arrives with migration 015, and putting it in the select above
  // meant that until 015 was run EVERY conversation failed to open -- one
  // unknown column takes the whole row with it. A feature waiting on a
  // migration must degrade to being absent, never to breaking the screen it
  // sits on.
  let asked: string[] = [];
  const probe = await supabase
    .from("conversations").select("asked").eq("id", id).maybeSingle();
  if (!probe.error && probe.data) asked = (probe.data as { asked?: string[] }).asked ?? [];

  // What this person already has outstanding. Whoever picks up the thread
  // should see "three open jobs, one of them late" before they type a word --
  // the alternative is answering a tenant as though nothing else is going on,
  // which is how the same repair gets reported three times.
  const unitId = (convo as { unit_id?: string | null }).unit_id
    ?? (convo.contacts as unknown as { unit_id?: string | null } | null)?.unit_id
    ?? null;

  const jobsQuery = supabase
    .from("work_orders")
    .select("id, summary, status, due_at, assigned_vendor, assigned_tech")
    .neq("status", "done")
    .order("due_at", { ascending: true, nullsFirst: false });

  const [{ data: messages }, { data: notes }, { data: reads }, { data: jobs }] = await Promise.all([
    supabase.from("messages")
      .select("id, direction, body, body_en, lang, status, channel, created_at, media_paths, staff:sent_by(full_name)")
      .eq("conversation_id", id).order("created_at"),
    supabase.from("notes")
      .select("id, body, created_at, staff:author_id(full_name)")
      .eq("conversation_id", id).order("created_at"),
    // Who has seen this thread, and how far down. A message is "read by" every
    // person whose last read is at or after it -- one timestamp each, rather
    // than a row per person per message for a distinction nobody uses.
    supabase.from("conversation_reads")
      .select("staff_id, last_read_at, staff:staff_id(full_name)")
      .eq("conversation_id", id),
    // By unit where we know it, so a tenant's open work follows them across
    // every thread they ever open. By conversation otherwise, which is the
    // best that can be done for a number not yet tied to an address.
    unitId ? jobsQuery.eq("unit_id", unitId) : jobsQuery.eq("conversation_id", id),
  ]);

  // One signing call for the whole thread rather than one per picture: each is
  // a round trip, and a thread with a dozen photos would otherwise spend a
  // second doing nothing else.
  const signed = await signMedia(
    supabase, (messages ?? []).flatMap((m) => (m.media_paths ?? []) as string[]),
  );

  return NextResponse.json({
    convo: { ...convo, asked },
    messages: messages ?? [],
    notes: notes ?? [],
    media: Object.fromEntries(signed),
    reads: (reads ?? []).map((r) => ({
      staffId: r.staff_id,
      at: r.last_read_at,
      name: (r.staff as unknown as { full_name: string } | null)?.full_name ?? "Someone",
    })),
    jobs: (jobs ?? []).map((j) => ({
      id: j.id, summary: j.summary, status: j.status, dueAt: j.due_at,
    })),
    me: staff.id,
    meName: staff.full_name,
  });
}
