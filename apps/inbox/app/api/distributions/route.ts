import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendEmailChecked } from "@/lib/notify";
import { planPayments, readPaste, ownerEmailHtml, ownerEmailText, subjectFor, bankDayFrom } from "@/lib/distribute";
import { build, prevMonth, cleanLines, emails, okEmail } from "@/lib/distribution-data";
import { excelUrl } from "@/lib/statement-link";

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
    const st = await db.from("distribution_statements").select("emailed_at, source").eq("id", statementId).single();
    if ((st.data?.source as { group?: string } | null)?.group === "Test") return false;
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
      // A changed statement is not the one that was checked.
      if (["lines", "depositsCents", "note"].some((k) => k in b)) { patch.checked_at = null; patch.checked_by = null; }
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
      const ccList = emails(b.cc);
      const badCc = ccList.filter((e) => !okEmail(e));
      if (badCc.length) return fail(`That is not an email address: ${badCc.join(", ")}`);
      const settle = Math.round(Number(b.settleDays));
      if (!(settle >= 0 && settle <= 30)) return fail("Bank days must be between 0 and 30.");
      const { error } = await db.from("distribution_payees")
        .update({ emails: list.join(", ") || null, settle_days: settle,
          ...("cc" in b ? { cc_emails: ccList.join(", ") || null } : {}),
          ...("entity" in b ? { entity: String(b.entity ?? "").trim().slice(0, 120) || null } : {}),
          ...("guaranteedCents" in b ? { guaranteed_rent_cents: Number(b.guaranteedCents) > 0 ? Math.round(Number(b.guaranteedCents)) : null } : {}),
          ...("reserveHeldCents" in b ? { reserve_held_cents: b.reserveHeldCents === null || b.reserveHeldCents === "" || !(Number(b.reserveHeldCents) >= 0) ? null : Math.round(Number(b.reserveHeldCents)) } : {}),
          ...("startsOn" in b ? { starts_on: /^\d{4}-\d{2}$/.test(String(b.startsOn)) ? `${b.startsOn}-01` : null } : {}),
          ...("reserveRequiredCents" in b ? { reserve_required_cents: b.reserveRequiredCents === null || b.reserveRequiredCents === "" || !(Number(b.reserveRequiredCents) >= 0) ? null : Math.round(Number(b.reserveRequiredCents)) } : {}) })
        .eq("id", String(b.payeeId));
      if (error) return fail(error.message, 500);
      // Reserves, the rent agreement and the addresses are all on the statement
      // the owner gets, so a change to them unchecks every unsent one of theirs.
      await db.from("distribution_statements").update({ checked_at: null, checked_by: null })
        .eq("payee_id", String(b.payeeId)).is("emailed_at", null);
      break;
    }

    case "check": {
      const ids: string[] = Array.isArray(b.statementIds) ? b.statementIds.map(String) : [String(b.statementId ?? "")].filter(Boolean);
      if (!ids.length) return fail("Which statements?");
      const { error } = await db.from("distribution_statements")
        .update(b.checked === false ? { checked_at: null, checked_by: null } : { checked_at: new Date().toISOString(), checked_by: me!.id })
        .in("id", ids);
      if (error) return fail(/checked_/.test(error.message) ? "Migration 066 has not been run yet." : error.message, 500);
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
      const per = Math.round(Number(b.perPaymentCents ?? 500_000));
      if (!(per >= 100)) return fail("The most per payment has to be a real amount.");
      if (!(cap >= 100)) return fail("The daily limit has to be a real amount.");
      const start = /^\d{4}-\d{2}-\d{2}$/.test(String(b.startOn)) ? String(b.startOn) : todayNY();
      const startOn = start < todayNY() ? todayNY() : start;
      await db.from("distribution_runs").update({ daily_cap_cents: cap, per_payment_cap_cents: per, start_on: startOn }).eq("id", id);

      const now = await build(month);
      // Unpaid planned payments are thrown away and planned again; paid ones
      // are the record, and use up their day's limit.
      const unpaid = (now.statements ?? []).flatMap((s) => s.payments.filter((p) => !p.paidAt).map((p) => p.id));
      if (unpaid.length) await db.from("distribution_payments").delete().in("id", unpaid);
      const taken: Record<string, number> = {};
      for (const s of now.statements ?? []) for (const p of s.payments) if (p.paidAt) taken[p.sendOn] = (taken[p.sendOn] ?? 0) + p.cents;
      const owed = (now.statements ?? []).filter((s) => !s.hold && !s.notStarted && (s.source as { group?: string } | null)?.group !== "Test")
        .map((s) => ({ id: s.id, name: s.payee, settleDays: s.settleDays, cents: s.owedCents - s.paidCents }));
      const plan = planPayments(owed, cap, bankDayFrom(startOn), taken, per);
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

    case "cc-all": {
      const list = emails(b.cc);
      const bad = list.filter((e) => !okEmail(e));
      if (bad.length) return fail(`That is not an email address: ${bad.join(", ")}`);
      const { error } = await db.from("distribution_settings").upsert({ id: true, cc_all: list.join(", ") || null });
      if (error) return fail(/distribution_settings/.test(error.message) ? "Migration 065 has not been run yet." : error.message, 500);
      break;
    }

    case "record": {
      /* Ticked when somebody has entered the change in Rent Manager. Only a
         change that is on the list now can be ticked, so a stale screen
         cannot tick something that has since been changed again. */
      const id = await runId();
      if (!id) return fail("Start the month first.");
      const keys: string[] = Array.isArray(b.keys) ? b.keys.map(String) : [];
      if (!keys.length) return fail("Which changes?");
      if (b.recorded) {
        const now = await build(month);
        const live = new Set((now.changes ?? []).map((c) => c.key));
        const stale = keys.filter((k) => !live.has(k));
        if (stale.length) return fail("That changed since the screen was loaded. Look at it again before ticking it.");
        const { error } = await db.from("distribution_recorded")
          .upsert(keys.map((key) => ({ run_id: id, key, recorded_by: me!.id, recorded_at: new Date().toISOString() })), { onConflict: "run_id,key", ignoreDuplicates: true });
        if (error) return fail(/distribution_recorded/.test(error.message) ? "Migration 065 has not been run yet." : error.message, 500);
      } else {
        const { error } = await db.from("distribution_recorded").delete().eq("run_id", id).in("key", keys);
        if (error) return fail(error.message, 500);
      }
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
        if (s.hold) { results.push({ payee: s.payee, ok: false, detail: "on hold, so not sent" }); continue; }
        if (s.notStarted) { results.push({ payee: s.payee, ok: false, detail: `distributions start ${s.startsOn}, so not sent` }); continue; }
        groups.set(s.sendsAs, [...(groups.get(s.sendsAs) ?? []), s]);
      }
      for (const [entity, list] of groups) {
        /* Nobody's statement goes out unchecked unless the person sending
           said, on the screen, to send it anyway. One unchecked statement
           holds back the whole email, because the email is all of them. */
        const unchecked = list.filter((s) => !s.checkedAt);
        if (unchecked.length && !b.sendUnchecked) {
          for (const s of list) results.push({ payee: s.payee, ok: false,
            detail: `not sent: ${unchecked.length === list.length ? "not checked yet" : `${unchecked.map((x) => x.title || x.payee).join(", ")} not checked yet`}` });
          continue;
        }
        const to = [...new Set(list.flatMap((s) => emails(s.email)).map((e) => e.toLowerCase()))];
        // Copied: the owner's own (an accountant) and the bookkeeper on every one -- never twice, never someone already in To.
        const cc = [...new Set([...list.flatMap((s) => emails(s.cc)), ...emails(now.ccAll)].map((e) => e.toLowerCase()))].filter((e) => !to.includes(e));
        if (!to.length) { for (const s of list) results.push({ payee: s.payee, ok: false, detail: "no email address on file" }); continue; }
        const inputs = list.map((s) => ({ month: `${month}-01`, payee: s.payee, title: s.title, lines: s.lines, note: s.note, payments: s.payments,
          previousOwedCents: s.previousOwedCents, priorPaidCents: s.priorPaidCents, priorPaidOn: s.priorPaidOn, depositsCents: s.depositsCents,
          reserveHeldCents: s.reserveHeldCents, reserveRequiredCents: s.reserveRequiredCents }));
        // The download link names exactly these statements and is signed over them.
        const excel = { excelUrl: excelUrl(month, list.map((x) => x.id)) };
        const r = await sendEmailChecked(to, subjectFor(`${month}-01`), ownerEmailText(`${month}-01`, entity, inputs, excel), ownerEmailHtml(`${month}-01`, entity, inputs, excel), {
          /* From whoever presses Send -- the address owners already get these
             from. The app's default (leasing@) was never a confirmed Postmark
             sender, so the first real send was refused. Postmark still has to
             have this address (or its domain) confirmed; if it does not, the
             refusal names it on screen. */
          from: process.env.DISTRIBUTIONS_FROM || sender || undefined,
          replyTo: process.env.DISTRIBUTIONS_REPLY_TO || sender,
          bcc: process.env.DISTRIBUTIONS_BCC || sender,
          cc,
        });
        // What was sent is the record: the lines as emailed, top-ups included.
        // A TEST is never the record: it stays editable and can be sent again.
        for (const s of list) {
          const test = (s.source as { group?: string } | null)?.group === "Test";
          await db.from("distribution_statements").update({
            ...(r.ok && !test ? { emailed_at: new Date().toISOString(), emailed_to: to.join(", ") + (cc.length ? `; cc ${cc.join(", ")}` : ""), lines: s.lines } : {}),
            email_detail: r.ok && test ? `Test sent ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} to ${to.join(", ")}${cc.length ? `; cc ${cc.join(", ")}` : ""}.` : r.detail,
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
