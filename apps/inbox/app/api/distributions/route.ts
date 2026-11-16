import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendEmailChecked } from "@/lib/notify";
import {
  netCents, owedCents, checks, versusLast, vacantLots, withGuarantee, planPayments, readPaste, ownerEmailHtml, ownerEmailText, subjectFor, entityOf,
  addBankDays, bankDayFrom, type Line, type Carry,
} from "@/lib/distribute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner distributions for one month: the statements, the emails, and the
 * Bill Pay payments that settle them.
 *
 * Every amount that is paid or emailed is worked out HERE from what is
 * saved, never taken from the page.
 */

const desk = (role: unknown) => role === "admin" || role === "office";
const MONTH = /^\d{4}-\d{2}$/;
const todayNY = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const prevMonth = (m: string) => {
  const d = new Date(`${m}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

const cleanLines = (raw: unknown): Line[] =>
  (Array.isArray(raw) ? raw : [])
    .map((l) => ({
      label: String(l?.label ?? "").trim().slice(0, 200), cents: Math.round(Number(l?.cents)),
      ...(l?.date ? { date: String(l.date).slice(0, 20) } : {}),
      ...(l?.merchant ? { merchant: String(l.merchant).slice(0, 80) } : {}),
      ...(l?.category ? { category: String(l.category).slice(0, 40) } : {}),
      ...(Number(l?.markupPct) > 0 && Number(l?.markupPct) <= 100 ? { markupPct: Math.round(Number(l.markupPct) * 100) / 100 } : {}),
      ...(Number.isFinite(Number(l?.sheetCents)) && l?.sheetCents !== null && l?.sheetCents !== undefined
        ? { sheetCents: Math.round(Number(l.sheetCents)) } : {}),
    }))
    .filter((l) => l.label && Number.isFinite(l.cents) && Math.abs(l.cents) < 1e10);

const emails = (s: unknown) => String(s ?? "").split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
const okEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function build(month: string) {
  const db = supabaseAdmin();
  const [runRes, payeesRes] = await Promise.all([
    db.from("distribution_runs").select("*").eq("month", `${month}-01`).maybeSingle(),
    db.from("distribution_payees").select("*").order("name"),
  ]);
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
  }));
  const run = runRes.data;
  if (!run) return { month, run: null, payees, statements: [] };

  const stRes = await db.from("distribution_statements").select("*").eq("run_id", run.id);

  // Last month, from our own record when it is here: what was actually
  // paid, and the lines it was paid on. Otherwise the sheet's own
  // "Distributions Paid" is the best there is.
  const lastRun = await db.from("distribution_runs").select("id").eq("month", `${prevMonth(month)}-01`).maybeSingle();
  const lastBy: Record<string, { lines: Line[]; sentCents: number | null; sentOn: string | null }> = {};
  if (lastRun.data) {
    const ls = (await db.from("distribution_statements").select("id, payee_id, lines").eq("run_id", lastRun.data.id)).data ?? [];
    const lp = ls.length ? (await db.from("distribution_payments").select("statement_id, amount_cents, paid_at, send_on")
      .in("statement_id", ls.map((x) => x.id)).not("paid_at", "is", null)).data ?? [] : [];
    for (const x of ls) {
      const paid = lp.filter((p) => p.statement_id === x.id);
      lastBy[String(x.payee_id)] = {
        lines: cleanLines(x.lines),
        sentCents: paid.length ? paid.reduce((a, p) => a + Number(p.amount_cents), 0) : null,
        sentOn: paid.length ? String(paid.map((p) => p.send_on).sort().pop()) : null,
      };
    }
  }
  const ids = (stRes.data ?? []).map((s) => s.id);
  const payRes = ids.length
    ? await db.from("distribution_payments").select("*").in("statement_id", ids).order("send_on")
    : { data: [] as Record<string, unknown>[] };
  const byPayee = Object.fromEntries(payees.map((p) => [p.id, p]));
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
      reserveHeldCents: payee?.reserveHeldCents ?? null, reserveRequiredCents: payee?.reserveRequiredCents ?? null,
      statedNetCents: n(s.stated_net_cents), statedOwedCents: n(s.stated_owed_cents),
    };
    const mine = pays.filter((p) => p.statementId === String(s.id))
      .map((p) => ({ ...p, arrivesOn: addBankDays(p.sendOn, payee?.settleDays ?? 2) }));
    return {
      id: String(s.id), payeeId: String(s.payee_id), payee: payee?.name ?? "(payee missing)",
      email: payee?.emails ?? "", settleDays: payee?.settleDays ?? 2, entity: payee?.entity ?? "",
      guaranteedCents: payee?.guaranteedCents ?? null, vacant: vacantLots(lines),
      sendsAs: entityOf({ entity: payee?.entity, payee: payee?.name ?? "" }),
      title: (s.title as string | null) ?? "", ...carry, owedNote: (s.owed_note as string | null) ?? "",
      source: s.source ?? null,
      lines, netCents: netCents(lines), owedCents: owedCents(lines, carry),
      checks: [
        ...checks(s.title as string | null, lines, carry),
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
      emailedAt: (s.emailed_at as string | null) ?? null, emailedTo: (s.emailed_to as string | null) ?? null,
      emailDetail: (s.email_detail as string | null) ?? null,
      payments: mine,
      paidCents: mine.filter((p) => p.paidAt).reduce((a, p) => a + p.cents, 0),
      plannedCents: mine.reduce((a, p) => a + p.cents, 0),
    };
  }).sort((a, b) => a.payee.localeCompare(b.payee));

  return {
    month,
    run: { id: String(run.id), capCents: Number(run.daily_cap_cents), startOn: (run.start_on as string | null) ?? null },
    payees, statements,
  };
}

export async function GET(req: Request) {
  const me = await requireStaff();
  if (!desk(me?.role)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const month = new URL(req.url).searchParams.get("month") || todayNY().slice(0, 7);
  if (!MONTH.test(month)) return NextResponse.json({ error: "bad month" }, { status: 400 });
  return NextResponse.json(await build(month));
}

export async function POST(req: Request) {
  const me = await requireStaff();
  if (!desk(me?.role)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const month = String(b.month ?? "");
  if (!MONTH.test(month)) return NextResponse.json({ error: "which month?" }, { status: 400 });
  const db = supabaseAdmin();
  const fail = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
  const runId = async () => (await db.from("distribution_runs").select("id").eq("month", `${month}-01`).maybeSingle()).data?.id as string | undefined;
  const sentOrPaid = async (statementId: string) => {
    const st = await db.from("distribution_statements").select("emailed_at").eq("id", statementId).single();
    const paid = await db.from("distribution_payments").select("id").eq("statement_id", statementId).not("paid_at", "is", null);
    return !!st.data?.emailed_at || (paid.data ?? []).length > 0;
  };

  switch (b.action) {
    case "start": {
      // A month starts with everybody who had a statement last month, so the
      // list is right before anything is read in.
      const { data: run, error } = await db.from("distribution_runs")
        .upsert({ month: `${month}-01`, created_by: me!.id }, { onConflict: "month" }).select("id").single();
      if (error) return fail(error.message, 500);
      const last = await db.from("distribution_runs").select("id").eq("month", `${prevMonth(month)}-01`).maybeSingle();
      const lastPayees = last.data
        ? ((await db.from("distribution_statements").select("payee_id").eq("run_id", last.data.id)).data ?? []).map((r) => r.payee_id)
        : ((await db.from("distribution_payees").select("id").eq("active", true)).data ?? []).map((r) => r.id);
      const seed = lastPayees.filter(Boolean).map((pid) => ({ run_id: run.id, payee_id: pid, updated_by: me!.id }));
      if (seed.length) await db.from("distribution_statements").upsert(seed, { onConflict: "run_id,payee_id", ignoreDuplicates: true });
      break;
    }

    case "add-payee": {
      const id = await runId();
      if (!id) return fail("Start the month first.");
      const name = String(b.name ?? "").trim().slice(0, 120);
      if (!name) return fail("Whose statement?");
      const { data: p, error } = await db.from("distribution_payees")
        .upsert({ name }, { onConflict: "name" }).select("id").single();
      if (error) return fail(error.message, 500);
      await db.from("distribution_statements")
        .upsert({ run_id: id, payee_id: p.id, updated_by: me!.id }, { onConflict: "run_id,payee_id", ignoreDuplicates: true });
      break;
    }

    case "remove": {
      if (await sentOrPaid(String(b.statementId))) return fail("This statement has been emailed or paid, so it stays on the record.");
      await db.from("distribution_statements").delete().eq("id", String(b.statementId));
      break;
    }

    case "save": {
      if (await sentOrPaid(String(b.statementId)) && ("lines" in b)) {
        return fail("This statement has been emailed or paid. What was sent is the record.");
      }
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: me!.id };
      // Top-ups are worked out on every read, never stored before sending.
      if ("lines" in b) patch.lines = cleanLines(b.lines).filter((l) => l.category !== "Guaranteed rent");
      if ("depositsCents" in b) {
        const d = Number(b.depositsCents);
        patch.deposits_cents = Number.isFinite(d) && d >= 0 ? Math.round(d) : null;
      }
      if ("note" in b) patch.note = String(b.note ?? "").slice(0, 2000) || null;
      if ("hold" in b) patch.hold = !!b.hold;
      const { error } = await db.from("distribution_statements").update(patch).eq("id", String(b.statementId));
      if (error) return fail(error.message, 500);
      break;
    }

    case "payee": {
      const list = emails(b.email);
      const bad = list.filter((e) => !okEmail(e));
      if (bad.length) return fail(`That is not an email address: ${bad.join(", ")}`);
      const settle = Math.round(Number(b.settleDays));
      if (!(settle >= 0 && settle <= 30)) return fail("Bank days must be between 0 and 30.");
      const { error } = await db.from("distribution_payees")
        .update({ emails: list.join(", ") || null, settle_days: settle,
          ...("entity" in b ? { entity: String(b.entity ?? "").trim().slice(0, 120) || null } : {}),
          ...("guaranteedCents" in b ? { guaranteed_rent_cents: Number(b.guaranteedCents) > 0 ? Math.round(Number(b.guaranteedCents)) : null } : {}),
          ...("reserveHeldCents" in b ? { reserve_held_cents: b.reserveHeldCents === null || b.reserveHeldCents === "" || !(Number(b.reserveHeldCents) >= 0) ? null : Math.round(Number(b.reserveHeldCents)) } : {}),
          ...("reserveRequiredCents" in b ? { reserve_required_cents: b.reserveRequiredCents === null || b.reserveRequiredCents === "" || !(Number(b.reserveRequiredCents) >= 0) ? null : Math.round(Number(b.reserveRequiredCents)) } : {}) })
        .eq("id", String(b.payeeId));
      if (error) return fail(error.message, 500);
      break;
    }

    case "paste": {
      const id = await runId();
      if (!id) return fail("Start the month first.");
      const now = await build(month);
      const read = readPaste(String(b.text ?? ""), (now.payees ?? []).map((p) => ({ id: p.id, name: p.name })));
      const entries = Object.entries(read.byOwner).filter(([, v]) => v.lines.length);
      if (!entries.length) {
        return fail(`Nothing in that paste matched a payee.${read.unmatched.length ? ` Not recognised: ${read.unmatched.slice(0, 5).join(" · ")}` : ""}`);
      }
      const locked = new Set((now.statements ?? []).filter((s) => s.emailedAt || s.paidCents).map((s) => s.payeeId));
      const rows = entries.filter(([pid]) => !locked.has(pid)).map(([pid, v]) => ({
        run_id: id, payee_id: pid, lines: v.lines, stated_owed_cents: v.statedNetCents,
        updated_by: me!.id, updated_at: new Date().toISOString(),
      }));
      if (rows.length) {
        const { error } = await db.from("distribution_statements").upsert(rows, { onConflict: "run_id,payee_id" });
        if (error) return fail(error.message, 500);
      }
      return NextResponse.json({
        ...(await build(month)),
        pasted: { payees: rows.length, unmatched: read.unmatched, skippedSent: entries.length - rows.length },
      });
    }

    case "plan": {
      const id = await runId();
      if (!id) return fail("Start the month first.");
      const cap = Math.round(Number(b.capCents ?? 2_500_000));
      if (!(cap >= 100)) return fail("The daily limit has to be a real amount.");
      const start = /^\d{4}-\d{2}-\d{2}$/.test(String(b.startOn)) ? String(b.startOn) : todayNY();
      const startOn = start < todayNY() ? todayNY() : start;
      await db.from("distribution_runs").update({ daily_cap_cents: cap, start_on: startOn }).eq("id", id);

      const now = await build(month);
      // Unpaid planned payments are thrown away and planned again; paid ones
      // are the record, and use up their day's limit.
      const unpaid = (now.statements ?? []).flatMap((s) => s.payments.filter((p) => !p.paidAt).map((p) => p.id));
      if (unpaid.length) await db.from("distribution_payments").delete().in("id", unpaid);
      const taken: Record<string, number> = {};
      for (const s of now.statements ?? []) for (const p of s.payments) if (p.paidAt) taken[p.sendOn] = (taken[p.sendOn] ?? 0) + p.cents;
      const owed = (now.statements ?? []).filter((s) => !s.hold)
        .map((s) => ({ id: s.id, name: s.payee, settleDays: s.settleDays, cents: s.owedCents - s.paidCents }));
      const plan = planPayments(owed, cap, bankDayFrom(startOn), taken);
      if (plan.length) {
        const { error } = await db.from("distribution_payments")
          .insert(plan.map((p) => ({ statement_id: p.id, send_on: p.sendOn, amount_cents: p.cents })));
        if (error) return fail(error.message, 500);
      }
      break;
    }

    case "paid": {
      const conf = String(b.confirmation ?? "").trim().slice(0, 80);
      const { error } = await db.from("distribution_payments")
        .update(b.undo ? { paid_at: null, paid_by: null, confirmation: null }
                       : { paid_at: new Date().toISOString(), paid_by: me!.id, confirmation: conf || null })
        .eq("id", String(b.paymentId));
      if (error) return fail(error.message, 500);
      break;
    }

    case "send": {
      /* ONE EMAIL PER OWNING ENTITY. Every statement of an entity that is
         asked for goes in one email, a block each; two entities are two
         emails even at the same address. The grouping is the payee's entity,
         never the address -- see migration 060. */
      const ids: string[] = Array.isArray(b.statementIds) ? b.statementIds.map(String) : [];
      if (!ids.length) return fail("Which statements?");
      const now = await build(month);
      const { data: { user } } = await (await supabaseServer()).auth.getUser();
      const sender = user?.email ?? undefined;
      const results: { payee: string; ok: boolean; detail: string }[] = [];
      const asked = (now.statements ?? []).filter((x) => ids.includes(x.id));
      const groups = new Map<string, typeof asked>();
      for (const s of asked) {
        if (s.emailedAt && !b.resend) { results.push({ payee: s.payee, ok: false, detail: "already emailed" }); continue; }
        if (!s.lines.length) { results.push({ payee: s.payee, ok: false, detail: "the statement has no lines" }); continue; }
        groups.set(s.sendsAs, [...(groups.get(s.sendsAs) ?? []), s]);
      }
      for (const [entity, list] of groups) {
        const to = [...new Set(list.flatMap((s) => emails(s.email)).map((e) => e.toLowerCase()))];
        if (!to.length) { for (const s of list) results.push({ payee: s.payee, ok: false, detail: "no email address on file" }); continue; }
        const inputs = list.map((s) => ({ month: `${month}-01`, payee: s.payee, title: s.title, lines: s.lines, note: s.note, payments: s.payments,
          previousOwedCents: s.previousOwedCents, priorPaidCents: s.priorPaidCents, priorPaidOn: s.priorPaidOn, depositsCents: s.depositsCents,
          reserveHeldCents: s.reserveHeldCents, reserveRequiredCents: s.reserveRequiredCents }));
        const r = await sendEmailChecked(to, subjectFor(`${month}-01`), ownerEmailText(`${month}-01`, entity, inputs), ownerEmailHtml(`${month}-01`, entity, inputs), {
          from: process.env.DISTRIBUTIONS_FROM || undefined,
          replyTo: process.env.DISTRIBUTIONS_REPLY_TO || sender,
          bcc: process.env.DISTRIBUTIONS_BCC || sender,
        });
        // What was sent is the record: the lines as emailed, top-ups included.
        for (const s of list) {
          await db.from("distribution_statements").update({
            ...(r.ok ? { emailed_at: new Date().toISOString(), emailed_to: to.join(", "), lines: s.lines } : {}),
            email_detail: r.detail,
          }).eq("id", s.id);
        }
        results.push({ payee: list.length > 1 ? `${entity} (${list.length} properties)` : list[0].payee, ...r });
      }
      return NextResponse.json({ ...(await build(month)), sent: results });
    }

    default:
      return fail("unknown action");
  }
  return NextResponse.json(await build(month));
}
