import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { pullDelinquency } from "@/lib/delinquency-pull";
import { pullVacancies } from "@/lib/vacancy-pull";
import { activeRecipients, newYork, render, SEND_HOUR, type Recipient, type Report, type Vacancies } from "@/lib/delinquency";
import { sendEmailChecked } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The Hobby ceiling. Rent Manager is given 42 of it; a report cut short
// says so in its subject rather than going out looking complete.
export const maxDuration = 60;

const REPORT = "delinquency";

/** CRON_SECRET for a person with it, or the key pg_cron presents, which
 *  lives in Vault and is checked by the database (migration 051). */
async function authorized(req: Request): Promise<boolean> {
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!given) return false;
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const a = Buffer.from(given), b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  const { data, error } = await supabaseAdmin().rpc("report_key_ok", { k: given });
  if (error) console.error("cron/delinquency key check", error.message);
  return data === true;
}

/**
 * The morning report: who owes, and what is empty or being shown.
 *
 * Called by pg_cron at 14:00 and 15:00 UTC (see 051). Sends only when it is
 * 10 o'clock in New York, and only once a day: the run is claimed in
 * report_runs before anything is sent, so a double fire is refused by the
 * unique index rather than by luck.
 *
 *   ?dry=1    build it and return it; send nothing, record nothing.
 *   ?force=1  send now whatever the hour, and record it as a manual send.
 *
 * A report Rent Manager could not produce is STILL SENT, saying so. The
 * people on the list are expecting it at 10, and silence would read as
 * either "nobody owes" or "it broke" with no way to tell which.
 */
async function handle(req: Request) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const force = url.searchParams.get("force") === "1";
  const now = newYork(new Date());

  if (!dry && !force && now.hour !== SEND_HOUR) {
    return NextResponse.json({
      skipped: `it is ${now.hour}:00 in New York, and the report goes at ${SEND_HOUR}:00`,
    });
  }

  const db = supabaseAdmin();
  let runId: string | null = null;
  if (!dry) {
    const { data, error } = await db.from("report_runs")
      .insert({ report: REPORT, day: now.day, scheduled: !force })
      .select("id").single();
    if (error) {
      // 23505: today's scheduled run is already claimed.
      if (error.code === "23505") {
        return NextResponse.json({ skipped: `already sent for ${now.day}` });
      }
      console.error("cron/delinquency claim", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    runId = data.id as string;
  }

  /* Both at once: each has most of the minute, and neither waits on the
     other. A vacancy list that fails does not stop the balances going out,
     and the other way round. */
  const [report, vac] = await Promise.all([
    pullDelinquency(now.day).catch((e): Report => ({
      day: now.day, ok: false, error: `The report fell over: ${(e as Error).message}`,
      debtors: [], tenantsRead: 0, partial: false, using: null, readAs: {},
    })),
    pullVacancies(now.day).catch((e): Vacancies => ({
      list: [],
      note: `The vacancy list could not be produced: ${(e as Error).message}`,
    })),
  ]);
  const mail = render(report, vac);

  const { data: list } = await db.from("report_recipients")
    .select("email, name, starts_on, ends_on").eq("report", REPORT);
  const to = activeRecipients((list ?? []) as Recipient[], now.day).map((r) => r.email);

  if (dry) {
    return NextResponse.json({
      dry: true, to, subject: mail.subject, text: mail.text,
      ok: report.ok, error: report.error, owing: report.debtors.length,
      tenantsRead: report.tenantsRead, partial: report.partial,
      using: report.using, readAs: report.readAs,
      listed: vac?.list.length ?? null, vacancyNote: vac?.note ?? null,
    });
  }

  const sent = await sendEmailChecked(to, mail.subject, mail.text, mail.html);
  const detail = [
    sent.detail,
    report.ok
      ? `${report.debtors.length} owing of ${report.tenantsRead} read via ${report.using}${report.partial ? " (partial)" : ""}`
      : `no report: ${report.error}`,
    `${vac?.list.filter((v) => v.status === "for_rent").length ?? 0} for rent, ${vac?.list.filter((v) => v.status === "upcoming").length ?? 0} upcoming${vac?.note ? `: ${vac.note}` : ""}`,
    `read as ${JSON.stringify(report.readAs)}`,
  ].join(" | ");
  await db.from("report_runs").update({
    finished_at: new Date().toISOString(), ok: sent.ok && report.ok, sent_to: to, detail,
  }).eq("id", runId!);

  console.log("cron/delinquency", { day: now.day, sent: sent.ok, reportOk: report.ok, detail });
  return NextResponse.json({ ok: sent.ok, reportOk: report.ok, to, subject: mail.subject, detail },
    { status: sent.ok ? 200 : 502 });
}

export const GET = handle;
export const POST = handle;
