import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendEmailChecked } from "@/lib/notify";
import {
  netCents, planPayments, readPaste, statementHtml, statementText, subjectFor,
  addBankDays, bankDayFrom, type Line,
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

const cleanLines = (raw: unknown): Line[] =>
  (Array.isArray(raw) ? raw : [])
    .map((l) => ({ label: String(l?.label ?? "").trim().slice(0, 120), cents: Math.round(Number(l?.cents)) }))
    .filter((l) => l.label && Number.isFinite(l.cents) && Math.abs(l.cents) < 1e10);

const emails = (s: unknown) => String(s ?? "").split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
const okEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

async function build(month: string) {
  const db = supabaseAdmin();
  const first = `${month}-01`;
  const [runRes, ownersRes, homesRes] = await Promise.all([
    db.from("distribution_runs").select("*").eq("month", first).maybeSingle(),
    db.from("owners").select("id, name, legal_name, kind, active, statement_email, settle_days, pay_note")
      .eq("active", true).order("name"),
    db.from("home_sales").select("owner_id").is("ended_on", null),
  ]);
  if (runRes.error || ownersRes.error) {
    const msg = (runRes.error ?? ownersRes.error)!.message;
    return { month, migrationMissing: /distribution_runs|statement_email|settle_days|does not exist/.test(msg), error: msg };
  }
  const homes: Record<string, number> = {};
  for (const h of homesRes.data ?? []) homes[String(h.owner_id)] = (homes[String(h.owner_id)] ?? 0) + 1;
  const owners = (ownersRes.data ?? []).map((o) => ({
    id: String(o.id), name: String(o.legal_name || o.name), kind: o.kind as string,
    email: (o.statement_email as string | null) ?? "", settleDays: Number(o.settle_days ?? 2),
    payNote: (o.pay_note as string | null) ?? "", homes: homes[String(o.id)] ?? 0,
  }));

  const run = runRes.data;
  if (!run) return { month, run: null, owners, statements: [] };

  const [stRes, payRes] = await Promise.all([
    db.from("distribution_statements").select("*").eq("run_id", run.id),
    db.from("distribution_payments").select("*, distribution_statements!inner(run_id)")
      .eq("distribution_statements.run_id", run.id).order("send_on"),
  ]);
  const byOwner = Object.fromEntries(owners.map((o) => [o.id, o]));
  const pays = (payRes.data ?? []).map((p) => ({
    id: String(p.id), statementId: String(p.statement_id), sendOn: String(p.send_on),
    cents: Number(p.amount_cents), paidAt: (p.paid_at as string | null) ?? null,
    confirmation: (p.confirmation as string | null) ?? null,
  }));
  const statements = (stRes.data ?? []).map((s) => {
    const owner = byOwner[String(s.owner_id)];
    const lines = cleanLines(s.lines);
    const mine = pays.filter((p) => p.statementId === String(s.id))
      .map((p) => ({ ...p, arrivesOn: addBankDays(p.sendOn, owner?.settleDays ?? 2) }));
    return {
      id: String(s.id), ownerId: String(s.owner_id), ownerName: owner?.name ?? "(owner not found)",
      email: owner?.email ?? "", settleDays: owner?.settleDays ?? 2,
      lines, netCents: netCents(lines), note: (s.note as string | null) ?? "", hold: !!s.hold,
      emailedAt: (s.emailed_at as string | null) ?? null, emailedTo: (s.emailed_to as string | null) ?? null,
      emailDetail: (s.email_detail as string | null) ?? null,
      payments: mine,
      paidCents: mine.filter((p) => p.paidAt).reduce((a, p) => a + p.cents, 0),
      plannedCents: mine.reduce((a, p) => a + p.cents, 0),
    };
  }).sort((a, b) => a.ownerName.localeCompare(b.ownerName));

  return {
    month,
    run: { id: String(run.id), capCents: Number(run.daily_cap_cents), startOn: (run.start_on as string | null) ?? null, note: run.note ?? "" },
    owners, statements,
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

  switch (b.action) {
    case "start": {
      // A month starts with a statement for every investor who has a home
      // with us. Others are added by hand.
      const { data: run, error } = await db.from("distribution_runs")
        .upsert({ month: `${month}-01`, created_by: me!.id }, { onConflict: "month", ignoreDuplicates: false })
        .select("id").single();
      if (error) return fail(error.message, 500);
      const now = await build(month);
      const seed = (now.owners ?? []).filter((o) => o.kind === "investor" && o.homes > 0)
        .map((o) => ({ run_id: run.id, owner_id: o.id, updated_by: me!.id }));
      if (seed.length) await db.from("distribution_statements").upsert(seed, { onConflict: "run_id,owner_id", ignoreDuplicates: true });
      break;
    }

    case "add-owner": {
      const id = await runId();
      if (!id) return fail("Start the month first.");
      const { error } = await db.from("distribution_statements")
        .upsert({ run_id: id, owner_id: String(b.ownerId), updated_by: me!.id }, { onConflict: "run_id,owner_id", ignoreDuplicates: true });
      if (error) return fail(error.message, 500);
      break;
    }

    case "remove": {
      const st = await db.from("distribution_statements").select("id, emailed_at").eq("id", String(b.statementId)).single();
      const paid = await db.from("distribution_payments").select("id").eq("statement_id", String(b.statementId)).not("paid_at", "is", null);
      if (st.data?.emailed_at || (paid.data ?? []).length) {
        return fail("This statement has been emailed or paid, so it stays on the record.");
      }
      await db.from("distribution_statements").delete().eq("id", String(b.statementId));
      break;
    }

    case "save": {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: me!.id };
      if ("lines" in b) patch.lines = cleanLines(b.lines);
      if ("note" in b) patch.note = String(b.note ?? "").slice(0, 2000) || null;
      if ("hold" in b) patch.hold = !!b.hold;
      const { error } = await db.from("distribution_statements").update(patch).eq("id", String(b.statementId));
      if (error) return fail(error.message, 500);
      break;
    }

    case "owner": {
      const list = emails(b.email);
      const bad = list.filter((e) => !okEmail(e));
      if (bad.length) return fail(`That is not an email address: ${bad.join(", ")}`);
      const settle = Math.round(Number(b.settleDays));
      if (!(settle >= 0 && settle <= 30)) return fail("Bank days must be between 0 and 30.");
      const { error } = await db.from("owners")
        .update({ statement_email: list.join(", ") || null, settle_days: settle, pay_note: String(b.payNote ?? "").slice(0, 300) || null })
        .eq("id", String(b.ownerId));
      if (error) return fail(error.message, 500);
      break;
    }

    case "paste": {
      const id = await runId();
      if (!id) return fail("Start the month first.");
      const now = await build(month);
      const read = readPaste(String(b.text ?? ""), (now.owners ?? []).map((o) => ({ id: o.id, name: o.name })));
      const entries = Object.entries(read.byOwner).filter(([, v]) => v.lines.length);
      if (!entries.length) {
        return fail(`Nothing in that paste matched an owner.${read.unmatched.length ? ` Not recognised: ${read.unmatched.slice(0, 5).join(" · ")}` : ""}`);
      }
      const rows = entries.map(([ownerId, v]) => ({
        run_id: id, owner_id: ownerId, lines: v.lines, updated_by: me!.id, updated_at: new Date().toISOString(),
      }));
      // Never overwrite a statement already emailed: what was sent is the record.
      const sent = new Set(((await db.from("distribution_statements").select("owner_id").eq("run_id", id).not("emailed_at", "is", null)).data ?? []).map((r) => String(r.owner_id)));
      const { error } = await db.from("distribution_statements")
        .upsert(rows.filter((r) => !sent.has(r.owner_id)), { onConflict: "run_id,owner_id" });
      if (error) return fail(error.message, 500);
      const mismatched = entries.filter(([, v]) => v.statedNetCents !== null && v.statedNetCents !== netCents(v.lines))
        .map(([oid, v]) => ({ ownerId: oid, stated: v.statedNetCents, lines: netCents(v.lines) }));
      return NextResponse.json({
        ...(await build(month)),
        pasted: { owners: entries.length, unmatched: read.unmatched, mismatched, skippedSent: rows.filter((r) => sent.has(r.owner_id)).length },
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
        .map((s) => ({ id: s.id, name: s.ownerName, settleDays: s.settleDays, cents: s.netCents - s.paidCents }));
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
      const ids: string[] = Array.isArray(b.statementIds) ? b.statementIds.map(String) : [];
      if (!ids.length) return fail("Which statements?");
      const now = await build(month);
      const { data: { user } } = await (await supabaseServer()).auth.getUser();
      const sender = user?.email ?? undefined;
      const results: { ownerName: string; ok: boolean; detail: string }[] = [];
      for (const s of (now.statements ?? []).filter((x) => ids.includes(x.id))) {
        if (s.emailedAt && !b.resend) { results.push({ ownerName: s.ownerName, ok: false, detail: "already emailed" }); continue; }
        const to = emails(s.email);
        if (!to.length) { results.push({ ownerName: s.ownerName, ok: false, detail: "no email address on file" }); continue; }
        if (!s.lines.length) { results.push({ ownerName: s.ownerName, ok: false, detail: "the statement has no lines" }); continue; }
        const input = { month: `${month}-01`, ownerName: s.ownerName, lines: s.lines, note: s.note, payments: s.payments };
        const r = await sendEmailChecked(to, subjectFor(`${month}-01`), statementText(input), statementHtml(input), {
          from: process.env.DISTRIBUTIONS_FROM || undefined,
          replyTo: process.env.DISTRIBUTIONS_REPLY_TO || sender,
          bcc: process.env.DISTRIBUTIONS_BCC || sender,
        });
        await db.from("distribution_statements").update({
          ...(r.ok ? { emailed_at: new Date().toISOString(), emailed_to: to.join(", ") } : {}),
          email_detail: r.detail,
        }).eq("id", s.id);
        results.push({ ownerName: s.ownerName, ...r });
      }
      return NextResponse.json({ ...(await build(month)), sent: results });
    }

    default:
      return fail("unknown action");
  }
  return NextResponse.json(await build(month));
}
