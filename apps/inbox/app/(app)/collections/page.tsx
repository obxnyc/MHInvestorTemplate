import { redirect } from "next/navigation";
import { canSeeOffice, isDesk, DESK } from "@/lib/roles";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { newYork } from "@/lib/delinquency";
import {
  STAGES, isStage, judge, nextStep, paidSince, playsOutBy, readPromise, standing, expected,
  type Account, type Judged, type Stage,
} from "@/lib/collections";
import { readSettings, readingsFor, toPromise } from "@/lib/collections-sync";
import CollectionsBoard, { type Debt, type Pull } from "@/components/CollectionsBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rent collections — Larabee Homes" };

type Row = Record<string, unknown>;

/**
 * Who owes, what step they are at, what they promised, and when the money
 * is expected -- in one place, so the person on the phone with a tenant
 * never has to relay the conversation and the owner never has to ask.
 */
export default async function Collections() {
  const me = await requireStaff();
  if (!me || !canSeeOffice(me.role)) redirect("/");
  const db = supabaseAdmin();
  const today = newYork(new Date()).day;
  const settings = await readSettings(db);

  // One string literal: the client reads the row type out of it.
  const { data: acctRows, error: acctErr } = await db.from("collection_accounts")
    .select("rm_tenant_id, name, rm_status, contact_id, place, balance_cents, oldest_charge, read_at, stage, stage_on, court_on, case_number, paid_during, assigned_to, contacts(phone)")
    .or("balance_cents.gte.100,stage.in.(late,filed,judgment,writ),paid_during.not.is.null")
    .limit(2000);

  if (acctErr) {
    // The tables arrive with migration 069. Until then the screen says so
    // rather than looking like nobody owes anything.
    return <CollectionsBoard missing={acctErr.message} today={today} debts={[]} staff={[]}
             pull={null} canEdit={false} isAdmin={false} settings={null} paidLately={[]} expectedDays={[]} />;
  }
  const accts = (acctRows ?? []) as unknown as Row[];
  const ids = accts.map((a) => Number(a.rm_tenant_id));

  const [{ data: prRows }, reads, { data: staffRows }, { data: pullRows }, { data: paidRows }] = await Promise.all([
    ids.length
      ? db.from("collection_promises")
          .select("id, rm_tenant_id, amount_cents, due_on, made_at, balance_at_cents, paid_now_cents, status, paid_cents, note, staff:staff!collection_promises_made_by_fkey(full_name)")
          .in("rm_tenant_id", ids).gte("made_at", new Date(Date.now() - 120 * 86_400_000).toISOString())
          .order("made_at", { ascending: false })
      : Promise.resolve({ data: [] as Row[] }),
    readingsFor(db, ids),
    db.from("staff").select("id, full_name, role").eq("active", true).in("role", DESK),
    db.from("collection_pulls").select("at, ok, tenants, owing, partial, detail").order("at", { ascending: false }).limit(1),
    db.from("collection_events").select("rm_tenant_id, at, body").eq("kind", "payment")
      .gte("at", new Date(Date.now() - 14 * 86_400_000).toISOString()).order("at", { ascending: false }).limit(50),
  ]);

  /* WHEN WE LAST HEARD FROM THEM, and when we last did anything: texts in,
     calls answered, and our own notes, texts and calls out. Read from the
     shared line itself, so a conversation nobody wrote down still counts. */
  const contactRows = ids.length
    ? ((await db.from("contacts").select("id, rm_tenant_id").in("rm_tenant_id", ids)).data ?? []) as Row[]
    : [];
  const tenantOfContact = new Map(contactRows.map((c) => [String(c.id), Number(c.rm_tenant_id)]));
  const contactIds = [...tenantOfContact.keys()];
  const heard = new Map<number, string>();
  const worked = new Map<number, string>();
  const lastWords = new Map<number, { at: string; body: string; id: string; conversationId: string }>();
  const bump = (m: Map<number, string>, id: number | undefined, at: string) => {
    if (id === undefined) return;
    const was = m.get(id);
    if (!was || at > was) m.set(id, at);
  };
  if (contactIds.length) {
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const { data: convos } = await db.from("conversations").select("id, contact_id").in("contact_id", contactIds);
    const tenantOfConvo = new Map(((convos ?? []) as Row[]).map((c) => [String(c.id), tenantOfContact.get(String(c.contact_id))]));
    const convoIds = [...tenantOfConvo.keys()];
    const [msgs, calls] = await Promise.all([
      convoIds.length
        ? db.from("messages").select("id, conversation_id, direction, body, body_en, created_at")
            .in("conversation_id", convoIds).gte("created_at", since).order("created_at", { ascending: false }).limit(3000)
        : Promise.resolve({ data: [] as Row[] }),
      db.from("calls").select("contact_id, direction, missed, created_at").in("contact_id", contactIds).gte("created_at", since).limit(2000),
    ]);
    for (const m of (msgs.data ?? []) as Row[]) {
      const t = tenantOfConvo.get(String(m.conversation_id));
      const at = new Date(String(m.created_at)).toISOString();
      if (m.direction === "inbound") {
        bump(heard, t, at);
        if (t !== undefined && !lastWords.has(t)) {
          lastWords.set(t, { at, body: String(m.body_en || m.body || ""), id: String(m.id), conversationId: String(m.conversation_id) });
        }
      } else bump(worked, t, at);
    }
    for (const c of (calls.data ?? []) as Row[]) {
      const t = tenantOfContact.get(String(c.contact_id));
      const at = new Date(String(c.created_at)).toISOString();
      if (!c.missed) { bump(heard, t, at); bump(worked, t, at); }
      else if (c.direction === "inbound") bump(heard, t, at);
      else bump(worked, t, at);
    }
  }
  const { data: noteRows } = ids.length
    ? await db.from("collection_events").select("rm_tenant_id, at").in("rm_tenant_id", ids)
        .not("by", "is", null).gte("at", new Date(Date.now() - 60 * 86_400_000).toISOString())
    : { data: [] as Row[] };
  for (const n of (noteRows ?? []) as Row[]) bump(worked, Number(n.rm_tenant_id), new Date(String(n.at)).toISOString());

  const promisesBy = new Map<number, (Judged & { note: string | null; by: string | null })[]>();
  for (const r of (prRows ?? []) as Row[]) {
    const pr = toPromise(r);
    const j = judge(pr, reads.get(pr.rmTenantId) ?? [], today);
    const list = promisesBy.get(pr.rmTenantId) ?? [];
    list.push({
      ...pr, judged: j.status, paidCents: j.paidCents,
      note: (r.note as string | null) ?? null,
      by: ((r.staff as { full_name?: string } | null)?.full_name) ?? null,
    });
    promisesBy.set(pr.rmTenantId, list);
  }

  const debts: Debt[] = accts.map((a) => {
    const id = Number(a.rm_tenant_id);
    const stage: Stage = isStage(a.stage) ? a.stage : "current";
    const acct: Account = {
      rmTenantId: id, name: String(a.name), balanceCents: Number(a.balance_cents),
      oldestCharge: (a.oldest_charge as string | null) ?? null, stage,
      stageOn: (a.stage_on as string | null) ?? null, courtOn: (a.court_on as string | null) ?? null,
    };
    const promises = promisesBy.get(id) ?? [];
    const rs = reads.get(id) ?? [];
    const lateFrom = acct.stageOn ? `${acct.stageOn}T00:00:00.000Z` : null;
    const startAtLate = lateFrom
      ? ([...rs].reverse().find((r) => r.at <= lateFrom)?.cents ?? rs[0]?.cents ?? acct.balanceCents)
      : acct.balanceCents;
    const paidLate = lateFrom ? paidSince(startAtLate, rs, lateFrom) : 0;
    const st = standing(acct, promises, heard.get(id) ?? null, today, settings.policy, paidLate);
    const words = lastWords.get(id);
    const madeAfter = words && promises.some((p) => p.madeAt >= words.at && p.judged !== "cancelled");
    const read = words && !madeAfter && (Date.now() - Date.parse(words.at)) < 10 * 86_400_000
      ? readPromise(words.body, today) : null;
    return {
      id, name: acct.name, place: (a.place as string | null) ?? null,
      phone: ((a.contacts as { phone?: string } | null)?.phone) ?? null,
      contactId: (a.contact_id as string | null) ?? null,
      status: (a.rm_status as string | null) ?? null,
      balanceCents: acct.balanceCents, oldest: acct.oldestCharge,
      stage, stageOn: acct.stageOn, courtOn: acct.courtOn,
      caseNumber: (a.case_number as string | null) ?? null,
      paidDuring: isStage(a.paid_during) ? a.paid_during : null,
      assignedTo: (a.assigned_to as string | null) ?? null,
      next: nextStep(acct, today, settings.policy),
      outBy: stage === "current" && acct.balanceCents < 100 ? null : playsOutBy(acct, today, settings.policy),
      standing: st.standing, why: st.why, paidSinceLate: paidLate,
      promises: promises.map((p) => ({
        id: p.id, amountCents: p.amountCents, dueOn: p.dueOn, madeAt: p.madeAt,
        status: p.judged, paidCents: p.paidCents, note: p.note, by: p.by, paidNowCents: p.paidNowCents,
      })),
      heard: heard.get(id) ?? null,
      worked: worked.get(id) ?? null,
      suggestion: read && words ? { ...read, messageId: words.id, conversationId: words.conversationId, at: words.at } : null,
    };
  });

  const allPromises = debts.flatMap((d) => d.promises.map((p) => ({
    id: p.id, amountCents: p.amountCents, dueOn: p.dueOn, madeAt: p.madeAt, balanceAtCents: 0,
    paidNowCents: 0, status: "open" as const, judged: p.status, paidCents: p.paidCents,
    rmTenantId: d.id, name: d.name,
  })));
  const expectedDays = expected(allPromises, today, 14);

  const nameOf = new Map(accts.map((a) => [Number(a.rm_tenant_id), String(a.name)]));
  const paidLately = ((paidRows ?? []) as Row[]).map((r) => ({
    name: nameOf.get(Number(r.rm_tenant_id)) ?? `Tenant ${r.rm_tenant_id}`,
    at: String(r.at), body: String(r.body),
  }));

  const p = ((pullRows ?? []) as Row[])[0];
  const pull: Pull | null = p ? {
    at: String(p.at), ok: Boolean(p.ok), tenants: Number(p.tenants), owing: Number(p.owing),
    partial: Boolean(p.partial), detail: (p.detail as string | null) ?? null,
  } : null;

  return (
    <CollectionsBoard
      today={today}
      debts={debts}
      staff={((staffRows ?? []) as Row[]).map((s) => ({ id: String(s.id), name: String(s.full_name) }))}
      pull={pull}
      canEdit={isDesk(me.role)}
      isAdmin={me.role === "admin"}
      settings={{
        policy: settings.policy, enabled: [...settings.enabled], autoSend: settings.autoSend,
        sendHour: settings.sendHour,
      }}
      paidLately={paidLately}
      expectedDays={expectedDays}
      stages={[...STAGES]}
      meId={String(me.id)}
    />
  );
}
