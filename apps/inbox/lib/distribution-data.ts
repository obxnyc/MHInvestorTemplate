import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  netCents, owedCents, checks, versusLast, vacantLots, withGuarantee, entityOf,
  addBankDays, changesOf, reconcile, type Line, type Carry,
} from "@/lib/distribute";

/**
 * One month of owner distributions as the screen, the emails and the Excel
 * download all see it: worked out here from what is saved, never taken from
 * a page. Moved out of the route so the download reads exactly the same
 * numbers the email was built from.
 */

export const prevMonth = (m: string) => {
  const d = new Date(`${m}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

export const cleanLines = (raw: unknown): Line[] =>
  (Array.isArray(raw) ? raw : [])
    .map((l) => ({
      label: String(l?.label ?? "").trim().slice(0, 200), cents: Math.round(Number(l?.cents)),
      ...(l?.date ? { date: String(l.date).slice(0, 20) } : {}),
      ...(l?.merchant ? { merchant: String(l.merchant).slice(0, 80) } : {}),
      ...(l?.category ? { category: String(l.category).slice(0, 40) } : {}),
      ...(Number(l?.markupPct) > 0 && Number(l?.markupPct) <= 100 ? { markupPct: Math.round(Number(l.markupPct) * 100) / 100 } : {}),
      ...(Number.isFinite(Number(l?.sheetCents)) && l?.sheetCents !== null && l?.sheetCents !== undefined
        ? { sheetCents: Math.round(Number(l.sheetCents)) } : {}),
      ...(l?.sheetLabel ? { sheetLabel: String(l.sheetLabel).trim().slice(0, 200) } : {}),
      ...(l?.removed === true ? { removed: true } : {}),
    }))
    .filter((l) => l.label && Number.isFinite(l.cents) && Math.abs(l.cents) < 1e10);

export const emails = (s: unknown) => String(s ?? "").split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
export const okEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
export const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function build(month: string) {
  const db = supabaseAdmin();
  const [runRes, payeesRes] = await Promise.all([
    db.from("distribution_runs").select("*").eq("month", `${month}-01`).maybeSingle(),
    db.from("distribution_payees").select("*").order("name"),
  ]);
  // 065: who else gets a copy, and what has been entered in Rent Manager.
  // Missing until 065 is run; everything else works without them.
  const settings = await db.from("distribution_settings").select("cc_all").maybeSingle();
  const ccAll = settings.error ? null : ((settings.data?.cc_all as string | null) ?? "");
  if (runRes.error || payeesRes.error) {
    const msg = (runRes.error ?? payeesRes.error)!.message;
    return { month, migrationMissing: /distribution_|does not exist/.test(msg), error: msg };
  }
  const payees = (payeesRes.data ?? []).map((p) => ({
    id: String(p.id), name: String(p.name), emails: (p.emails as string | null) ?? "",
    settleDays: Number(p.settle_days ?? 2), active: !!p.active, sheetId: (p.sheet_id as string | null) ?? null,
    entity: (p.entity as string | null) ?? "",
    guaranteedCents: p.guaranteed_rent_cents == null ? null : Number(p.guaranteed_rent_cents),
    reserveHeldCents: p.reserve_held_cents == null ? null : Number(p.reserve_held_cents),
    reserveRequiredCents: p.reserve_required_cents == null ? null : Number(p.reserve_required_cents),
    reservePendingCents: Number(p.reserve_pending_cents ?? 0),
    startsOn: (p.starts_on as string | null) ?? null,
    cc: (p.cc_emails as string | null) ?? "",
  }));
  const run = runRes.data;
  if (!run) return { month, run: null, payees, statements: [], ccAll, changes: [] };

  const stRes = await db.from("distribution_statements").select("*").eq("run_id", run.id);
  const byPayee = Object.fromEntries(payees.map((p) => [p.id, p]));
  const byPayeeId = (id: string) => byPayee[id];

  // Last month, from our own record when it is here: what was actually
  // paid, and the lines it was paid on. Otherwise the sheet's own
  // "Distributions Paid" is the best there is.
  const lastRun = await db.from("distribution_runs").select("id").eq("month", `${prevMonth(month)}-01`).maybeSingle();
  const lastBy: Record<string, { lines: Line[]; sentCents: number | null; sentOn: string | null; owedCents: number | null; unrecorded: number }> = {};
  if (lastRun.data) {
    const ls = (await db.from("distribution_statements").select("*").eq("run_id", lastRun.data.id)).data ?? [];
    const lp = ls.length ? (await db.from("distribution_payments").select("id, statement_id, amount_cents, paid_at, send_on, confirmation")
      .in("statement_id", ls.map((x) => x.id)).not("paid_at", "is", null)).data ?? [] : [];
    const lastRec = await db.from("distribution_recorded").select("key").eq("run_id", lastRun.data.id);
    const lastDone = new Set((lastRec.data ?? []).map((r) => String(r.key)));
    for (const x of ls) {
      const paid = lp.filter((p) => p.statement_id === x.id);
      const pay = byPayeeId(String(x.payee_id));
      const lines = x.emailed_at ? cleanLines(x.lines) : withGuarantee(cleanLines(x.lines), pay?.guaranteedCents);
      const carry: Carry = { previousOwedCents: n(x.previous_owed_cents), priorPaidCents: n(x.prior_paid_cents) };
      const changes = changesOf(String(x.id), lines, paid.map((p) => ({ id: String(p.id), cents: Number(p.amount_cents),
        paidAt: String(p.paid_at), sendOn: String(p.send_on), confirmation: (p.confirmation as string | null) ?? null })));
      lastBy[String(x.payee_id)] = {
        lines,
        sentCents: paid.length ? paid.reduce((a, p) => a + Number(p.amount_cents), 0) : null,
        sentOn: paid.length ? String(paid.map((p) => p.send_on).sort().pop()) : null,
        // A statement with no lines was never worked out here, so there is nothing to compare.
        owedCents: lines.length ? owedCents(lines, carry) : null,
        unrecorded: lastRec.error ? 0 : changes.filter((c) => !lastDone.has(c.key)).length,
      };
    }
  }
  const ids = (stRes.data ?? []).map((s) => s.id);
  const payRes = ids.length
    ? await db.from("distribution_payments").select("*").in("statement_id", ids).order("send_on")
    : { data: [] as Record<string, unknown>[] };
  const pays = (payRes.data ?? []).map((p) => ({
    id: String(p.id), statementId: String(p.statement_id), sendOn: String(p.send_on),
    cents: Number(p.amount_cents), paidAt: (p.paid_at as string | null) ?? null,
    confirmation: (p.confirmation as string | null) ?? null,
  }));

  const statements = (stRes.data ?? []).map((s) => {
    const payee = byPayee[String(s.payee_id)];
    /* The rent agreement is applied every time the statement is read, from
       the lines as saved and the agreement as it stands -- until the
       statement is emailed, when the lines that were sent are frozen into it
       and become the record. */
    const lines = s.emailed_at ? cleanLines(s.lines) : withGuarantee(cleanLines(s.lines), payee?.guaranteedCents);
    const carry: Carry = {
      previousOwedCents: n(s.previous_owed_cents), priorPaidCents: n(s.prior_paid_cents),
      priorPaidOn: (s.prior_paid_on as string | null) ?? null, depositsCents: n(s.deposits_cents),
      /* Reserves going INTO this statement. A sent statement keeps what it was
         sent with (067), because the owner's balance has moved on since. */
      reserveHeldCents: s.emailed_at && s.reserve_before_cents != null ? Number(s.reserve_before_cents) : payee?.reserveHeldCents ?? null,
      reservePendingCents: s.emailed_at && s.reserve_pending_before_cents != null ? Number(s.reserve_pending_before_cents) : payee?.reservePendingCents ?? 0,
      reserveRequiredCents: payee?.reserveRequiredCents ?? null,
      statedNetCents: n(s.stated_net_cents), statedOwedCents: n(s.stated_owed_cents),
    };
    const mine = pays.filter((p) => p.statementId === String(s.id))
      .map((p) => ({ ...p, arrivesOn: addBankDays(p.sendOn, payee?.settleDays ?? 2) }));
    return {
      id: String(s.id), payeeId: String(s.payee_id), payee: payee?.name ?? "(payee missing)",
      email: payee?.emails ?? "", cc: payee?.cc ?? "", settleDays: payee?.settleDays ?? 2, entity: payee?.entity ?? "",
      guaranteedCents: payee?.guaranteedCents ?? null, vacant: vacantLots(lines),
      // Distributions not started yet this month: kept on screen, never sent, owed or planned.
      startsOn: payee?.startsOn ?? null, notStarted: !!payee?.startsOn && payee.startsOn > `${month}-01`,
      sendsAs: entityOf({ entity: payee?.entity, payee: payee?.name ?? "" }),
      title: (s.title as string | null) ?? "", ...carry, owedNote: (s.owed_note as string | null) ?? "",
      source: s.source ?? null,
      lines, netCents: netCents(lines), owedCents: owedCents(lines, carry),
      checks: [
        ...checks(s.title as string | null, lines, carry),
        // Last month as this screen left it, against what Rent Manager now says about it.
        ...(lastBy[String(s.payee_id)] ? reconcile({ month: `${prevMonth(month)}-01`, owedCents: lastBy[String(s.payee_id)].owedCents,
          paidCents: lastBy[String(s.payee_id)].sentCents, unrecorded: lastBy[String(s.payee_id)].unrecorded }, carry) : []),
        // What the read-in could not turn into a line is said, not dropped.
        ...(((s.source as { blank?: string[] } | null)?.blank ?? []).length
          ? [`The sheet left ${(s.source as { blank: string[] }).blank.length} amount(s) blank, so they are not on this statement: ${(s.source as { blank: string[] }).blank.slice(0, 3).join("; ")}${(s.source as { blank: string[] }).blank.length > 3 ? "…" : ""}.`] : []),
        ...(((s.source as { extra?: string[] } | null)?.extra ?? []).length
          ? [`The sheet has another section below this one (${(s.source as { extra: string[] }).extra.join(", ")}) that is not on this statement.`] : []),
      ],
      versus: (() => {
        const last = lastBy[String(s.payee_id)];
        const sent = last?.sentCents ?? carry.priorPaidCents ?? null;
        const on = last?.sentCents != null ? last.sentOn : carry.priorPaidOn ?? null;
        return versusLast(owedCents(lines, carry), { sentCents: sent, sentOn: on, lines: last?.lines ?? null }, lines);
      })(),
      note: (s.note as string | null) ?? "", hold: !!s.hold,
      checkedAt: (s.checked_at as string | null) ?? null, checkedById: (s.checked_by as string | null) ?? null, checkedBy: null as string | null,
      emailedAt: (s.emailed_at as string | null) ?? null, emailedTo: (s.emailed_to as string | null) ?? null,
      emailDetail: (s.email_detail as string | null) ?? null,
      payments: mine,
      paidCents: mine.filter((p) => p.paidAt).reduce((a, p) => a + p.cents, 0),
      plannedCents: mine.reduce((a, p) => a + p.cents, 0),
    };
  }).sort((a, b) => a.payee.localeCompare(b.payee));

  // Who checked each statement, by name.
  const checkers = [...new Set(statements.map((s) => s.checkedById).filter((x): x is string => !!x))];
  if (checkers.length) {
    const names = Object.fromEntries(((await db.from("staff").select("id, full_name").in("id", checkers)).data ?? [])
      .map((x) => [String(x.id), String(x.full_name ?? "")]));
    for (const s of statements) s.checkedBy = s.checkedById ? names[s.checkedById] ?? "" : null;
  }

  // Everything Rent Manager does not have yet, and which of it has been entered.
  const rec = await db.from("distribution_recorded").select("key, recorded_at, recorded_by").eq("run_id", run.id);
  const who = rec.data?.length
    ? Object.fromEntries(((await db.from("staff").select("id, full_name").in("id", [...new Set(rec.data.map((r) => r.recorded_by).filter(Boolean))])).data ?? [])
      .map((x) => [String(x.id), String(x.full_name ?? "")]))
    : {};
  const done = new Map((rec.data ?? []).map((r) => [String(r.key), { at: String(r.recorded_at), by: who[String(r.recorded_by)] ?? "" }]));
  const changes = rec.error ? null : statements.flatMap((s) => changesOf(s.id, s.lines, s.payments).map((c) => ({
    ...c, statementId: s.id, payee: s.payee, title: s.title,
    recordedAt: done.get(c.key)?.at ?? null, recordedBy: done.get(c.key)?.by ?? null,
  })));

  return {
    month,
    run: { id: String(run.id), capCents: Number(run.daily_cap_cents), startOn: (run.start_on as string | null) ?? null,
      perPaymentCents: Number(run.per_payment_cap_cents ?? 500000) },
    payees, statements, ccAll, changes,
  };
}

