import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { canSeeOffice, isDesk } from "@/lib/roles";
import { newYork } from "@/lib/delinquency";
import { isStage, judge, nextStep, playsOutBy, readPromise, STAGE_LABEL, type Account } from "@/lib/collections";
import { readSettings, readingsFor, toPromise } from "@/lib/collections-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a text thread needs to know about the person's rent: owed, the step,
 * the open promise. Empty when they owe nothing and nothing is open --
 * a thread about a dripping tap does not need a rent banner on it.
 *
 * Also a suggested promise read from what they just wrote, so "I can pay
 * 400 Friday" becomes one press rather than a note somebody has to relay.
 */
export async function GET(req: Request) {
  const me = await requireStaff();
  if (!me || !canSeeOffice(me.role)) return NextResponse.json({ card: null });
  const url = new URL(req.url);
  const contactId = url.searchParams.get("contact");
  const conversationId = url.searchParams.get("conversation");
  if (!contactId) return NextResponse.json({ card: null });
  const db = supabaseAdmin();

  const { data: c } = await db.from("contacts").select("rm_tenant_id").eq("id", contactId).maybeSingle();
  const tid = c?.rm_tenant_id ? Number(c.rm_tenant_id) : null;
  if (!tid) return NextResponse.json({ card: null });
  const { data: a, error } = await db.from("collection_accounts")
    .select("rm_tenant_id, name, balance_cents, oldest_charge, stage, stage_on, court_on, read_at")
    .eq("rm_tenant_id", tid).maybeSingle();
  if (error || !a) return NextResponse.json({ card: null });
  if (Number(a.balance_cents) < 100 && (a.stage === "current" || a.stage === "out")) return NextResponse.json({ card: null });

  const today = newYork(new Date()).day;
  const { policy } = await readSettings(db);
  const acct: Account = {
    rmTenantId: tid, name: String(a.name), balanceCents: Number(a.balance_cents),
    oldestCharge: a.oldest_charge, stage: isStage(a.stage) ? a.stage : "current",
    stageOn: a.stage_on, courtOn: a.court_on,
  };
  const { data: prs } = await db.from("collection_promises")
    .select("id, rm_tenant_id, amount_cents, due_on, made_at, balance_at_cents, paid_now_cents, status")
    .eq("rm_tenant_id", tid).neq("status", "cancelled").order("made_at", { ascending: false }).limit(5);
  const reads = (await readingsFor(db, [tid])).get(tid) ?? [];
  const promises = ((prs ?? []) as Record<string, unknown>[]).map((r) => {
    const p = toPromise(r);
    return { ...p, ...judge(p, reads, today) };
  });
  const open = promises.find((p) => p.status === "open") ?? null;

  let suggestion = null;
  if (conversationId && isDesk(me.role)) {
    const { data: last } = await db.from("messages").select("id, body, body_en, created_at")
      .eq("conversation_id", conversationId).eq("direction", "inbound")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last && !promises.some((p) => p.madeAt >= new Date(last.created_at).toISOString())) {
      const r = readPromise(String(last.body_en || last.body || ""), today);
      if (r) suggestion = { ...r, messageId: last.id };
    }
  }

  return NextResponse.json({
    card: {
      rmTenantId: tid,
      balanceCents: acct.balanceCents,
      readAt: a.read_at,
      stage: acct.stage,
      stageLabel: STAGE_LABEL[acct.stage],
      next: nextStep(acct, today, policy),
      outBy: playsOutBy(acct, today, policy),
      open: open ? { amountCents: open.amountCents, dueOn: open.dueOn, paidCents: open.paidCents } : null,
      broken: !open && promises[0]?.status === "broken" ? { amountCents: promises[0].amountCents, dueOn: promises[0].dueOn } : null,
      suggestion,
      canEdit: isDesk(me.role),
      today,
    },
  });
}
