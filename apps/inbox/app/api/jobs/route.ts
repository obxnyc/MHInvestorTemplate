import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { pushToStaff } from "@/lib/push";
import { prettyPhone } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every job, with what it cost.
 *
 *  Open and closed together, because the price history lives in the closed ones
 *  and the whole reason to look at this screen is to compare the two. */
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const supabase = await supabaseServer();
  /* The photo columns arrive later than the rest, and a column that is not
     there takes the WHOLE select with it -- which on this screen is every
     job in the business. Asked for with them and then without. */
  const BASE = "id, summary, detail, status, due_at, completed_at, cost_cents,"
    + " invoice_ref, trade_id, conversation_id,"
    + " units(label, properties(name, market_id)),"
    + " vendor:assigned_vendor(full_name, company), tech:assigned_tech(full_name)";
  const askJobs = (cols: string) => supabase.from("work_orders").select(cols)
    .order("completed_at", { ascending: false, nullsFirst: true }).limit(500);

  let got = await askJobs(`${BASE}, reported_photos, completion_photos`);
  if (got.error) got = await askJobs(BASE);
  const [{ data: trades }] = await Promise.all([
    supabase.from("trades").select("id, label, sort").order("sort"),
  ]);
  const jobs = got.data as unknown as Record<string, unknown>[] | null;

  return NextResponse.json({
    jobs: (jobs ?? []).map((j) => {
      const unit = j.units as unknown as
        { label: string | null; properties: { name: string; market_id: string | null } | null } | null;
      const vendor = j.vendor as unknown as { full_name: string | null; company: string | null } | null;
      const tech = j.tech as unknown as { full_name: string } | null;
      /* HOW MUCH EVIDENCE IS ON IT, not the files themselves: the board
         lists five hundred jobs and signing every picture on it would be
         five hundred round trips for something nobody has clicked. */
      const before = (j.reported_photos as string[] | null) ?? [];
      const after = (j.completion_photos as string[] | null) ?? [];
      return {
        id: j.id,
        evidence: before.length,
        proof: after.length,
        summary: j.summary,
        status: j.status,
        dueAt: j.due_at,
        completedAt: j.completed_at,
        costCents: j.cost_cents,
        invoiceRef: j.invoice_ref,
        tradeId: j.trade_id,
        conversationId: j.conversation_id,
        where: unit ? [unit.properties?.name, unit.label].filter(Boolean).join(" · ") : null,
        marketId: unit?.properties?.market_id ?? null,
        who: vendor?.company || vendor?.full_name || tech?.full_name || null,
      };
    }),
    trades: trades ?? [],
  });
}

/**
 * A job nobody texted in.
 *
 * Every work order so far has been born from a message: a tenant reports
 * something, somebody forwards it, a job comes out. That covers the common
 * case and misses the one where you noticed it yourself -- a gutter on the
 * walk round, a turn to schedule, a unit to make ready. Those were reaching
 * the system as a note to self, or not at all.
 *
 * So the same work order, with no conversation behind it. Everything else
 * about it is identical: it appears in the same list, gets dispatched the same
 * way, and closes under the same evidence rule.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { summary, detail, unitId, urgency, dueAt, tradeId, toKind, toId,
          conversationId } = await req.json().catch(() => ({}));

  const what = String(summary ?? "").trim();
  if (what.length < 3) {
    return NextResponse.json({ error: "Say what needs doing." }, { status: 400 });
  }
  if (!unitId) {
    // An address is not optional on a job. A work order nobody can be sent to
    // is a note, and it will sit in the list being counted as work.
    return NextResponse.json({ error: "Pick which property it is at." }, { status: 400 });
  }
  if (toKind && toKind !== "staff" && toKind !== "contact") {
    return NextResponse.json({ error: "unknown assignee" }, { status: 400 });
  }

  const level = Number(urgency);
  const db = supabaseAdmin();

  const { data, error } = await db.from("work_orders").insert({
    // Carried when the job came out of a thread. The two have to point at
    // each other: the tech's question is "what did they actually say", and
    // the office's is "did anybody ever reply to this person". A job raised
    // from a conversation and not linked to it answers neither.
    conversation_id: String(conversationId ?? "") || null,
    unit_id: String(unitId),
    summary: what.slice(0, 120),
    detail: String(detail ?? "").trim() || null,
    urgency: Number.isFinite(level) && level >= 1 && level <= 5 ? level : 3,
    trade_id: String(tradeId ?? "").trim() || null,
    due_at: String(dueAt ?? "").trim() || null,
    created_by: me.id,
    assigned_tech: toKind === "staff" ? toId : null,
    assigned_vendor: toKind === "contact" ? toId : null,
    status: toKind ? "assigned" : "new",
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Told, if it was given to somebody. A job assigned silently is a job
  // nobody knows they have.
  if (toKind === "staff" && toId) {
    await pushToStaff([String(toId)], {
      title: `${me.full_name} opened a job for you`,
      body: what.slice(0, 140),
      url: "/jobs",
      tag: `job-${data.id}`,
    });
  }

  return NextResponse.json({ ok: true, id: data.id, notified: toKind === "staff" });
}
