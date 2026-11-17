import { NextResponse } from "next/server";
import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { isDesk } from "@/lib/roles";
import { blastFooter, hasBrackets, personalize, pickAudience, type Audience } from "@/lib/brokers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Blasts to brokers (073).
 *
 *   GET                         the last thirty blasts
 *   POST { action: "test" }     one copy to the person pressing the button
 *   POST { action: "send" }     the app sends it, one email per broker
 *   POST { action: "gmail" }    recorded, and handed back as BCC batches for
 *                               a person to send from Gmail
 *   POST { action: "gmail-sent", blastId, batch }   that batch went
 *
 * The audience is worked out HERE, from the database, never taken from the
 * request: a list the browser sends is a list anybody can edit, and an
 * opted-out broker must stay out whatever the screen thought.
 *
 * Nothing sends unless a person pressed the button. No schedule calls this.
 */

const BATCH = 50;          // per Gmail BCC: well under Gmail's own limits
const POSTMARK_BATCH = 500; // Postmark's /email/batch maximum

async function gate() {
  const me = await requireStaff();
  if (!me) return { err: NextResponse.json({ error: "not signed in" }, { status: 401 }) };
  if (!isDesk(me.role)) return { err: NextResponse.json({ error: "office and admin only" }, { status: 403 }) };
  return { me };
}

export async function GET() {
  const g = await gate(); if (g.err) return g.err;
  const db = await supabaseServer();
  const { data, error } = await db.from("broker_blasts")
    .select("id, subject, via, recipients, sent, failed, created_at, audience")
    .order("created_at", { ascending: false }).limit(30);
  if (error) return NextResponse.json({
    error: /broker_blasts/.test(error.message) ? "Migration 073 has not been applied yet, so blasts have nowhere to be recorded." : error.message,
  }, { status: 500 });
  const { data: s } = await db.from("acquisition_settings").select("signature, mailing_address").maybeSingle();
  return NextResponse.json({
    blasts: data,
    signature: s?.signature ?? null, mailing_address: s?.mailing_address ?? null,
    appCanSend: Boolean(process.env.POSTMARK_SERVER_TOKEN),
  });
}

type Body = {
  action?: string; subject?: string; body?: string; audience?: Audience;
  blastId?: string; batch?: number; mailing_address?: string | null;
};

export async function POST(req: Request) {
  const g = await gate(); if (g.err) return g.err;
  const me = g.me!;
  const b = await req.json().catch(() => ({})) as Body;
  const db = await supabaseServer();

  if (b.action === "gmail-sent") return gmailSent(db, me.id, String(b.blastId ?? ""), Number(b.batch));

  // The postal address lives with the pitch; saving it here means the first
  // blast is not blocked on a trip to another screen.
  if (typeof b.mailing_address === "string") {
    await db.from("acquisition_settings").upsert({ id: true, mailing_address: b.mailing_address.trim() || null, updated_by: me.id });
  }

  const subject = String(b.subject ?? "").trim();
  const text = String(b.body ?? "").trim();
  if (!subject || !text) return NextResponse.json({ error: "A blast needs a subject and a message." }, { status: 400 });
  if (hasBrackets(subject + text)) return NextResponse.json({ error: "There are still [square brackets] in the message. Fill them in first." }, { status: 400 });

  const { data: s } = await db.from("acquisition_settings").select("signature, mailing_address").maybeSingle();
  if (!s?.mailing_address?.trim() && b.action !== "test")
    return NextResponse.json({ error: "Add your business mailing address first. Every bulk email has to carry one." }, { status: 400 });
  const footer = blastFooter(s?.signature ?? null, s?.mailing_address ?? null);
  const from = process.env.BROKER_BLAST_FROM ?? process.env.DISTRIBUTIONS_FROM ?? process.env.POSTMARK_FROM ?? "cade@larabeehomesllc.com";
  const replyTo = process.env.BROKER_BLAST_REPLY_TO ?? "cade@larabeehomesllc.com";
  const token = process.env.POSTMARK_SERVER_TOKEN;

  if (b.action === "test") {
    const { data: { user } } = await db.auth.getUser();
    if (!user?.email) return NextResponse.json({ error: "Your sign-in has no email address to send a test to." }, { status: 400 });
    if (!token) return NextResponse.json({ error: "Email is not set up on this deployment (POSTMARK_SERVER_TOKEN)." }, { status: 400 });
    const r = await postmark(token, [{
      From: from, To: user.email, ReplyTo: replyTo, Subject: `[TEST] ${subject}`,
      TextBody: `${personalize(text, { name: me.full_name })}\n\n${footer}`, MessageStream: "outbound",
    }]);
    return r[0]?.ok ? NextResponse.json({ ok: true, to: user.email })
      : NextResponse.json({ error: `Postmark refused the test: ${r[0]?.detail}` }, { status: 502 });
  }

  // Everybody, then the filter -- here, not in the browser.
  const all: Record<string, unknown>[] = [];
  for (let from_ = 0; ; from_ += 1000) {
    const { data, error } = await db.from("brokers")
      .select("id, name, kind, stage, state, starred, email, opted_out_at").range(from_, from_ + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const audience: Audience = {
    kind: b.audience?.kind === "commercial" || b.audience?.kind === "residential" ? b.audience.kind : "all",
    stages: Array.isArray(b.audience?.stages) ? b.audience!.stages.map(String) : [],
    state: String(b.audience?.state ?? ""), starredOnly: Boolean(b.audience?.starredOnly),
  };
  const pick = pickAudience(all as never[], audience) as { to: { id: string; name: string; email: string; stage: string }[]; noEmail: number; optedOut: number };
  if (!pick.to.length) return NextResponse.json({ error: "Nobody with an email matches that audience." }, { status: 400 });

  const via = b.action === "send" ? "app" : b.action === "gmail" ? "gmail" : null;
  if (!via) return NextResponse.json({ error: "unknown action" }, { status: 400 });
  if (via === "app" && !token) return NextResponse.json({ error: "Email is not set up on this deployment, so the app cannot send. Use Gmail instead." }, { status: 400 });

  const { data: blast, error: be } = await db.from("broker_blasts").insert({
    subject, body: text, audience, via, recipients: pick.to.length, created_by: me.id,
  }).select("id").single();
  if (be) return NextResponse.json({ error: be.message }, { status: 500 });

  // Recorded as queued FIRST: a send that dies half way leaves a list that
  // says who is still waiting, rather than a list that says nothing.
  const { error: re } = await db.from("broker_blast_recipients").insert(pick.to.map((t, i) => ({
    blast_id: blast.id, broker_id: t.id, email: t.email.trim().toLowerCase(), status: "queued",
    batch: via === "gmail" ? Math.floor(i / BATCH) : null,
  })));
  if (re) return NextResponse.json({ error: re.message }, { status: 500 });

  if (via === "gmail") {
    const batches: string[][] = [];
    for (let i = 0; i < pick.to.length; i += BATCH) batches.push(pick.to.slice(i, i + BATCH).map((t) => t.email.trim().toLowerCase()));
    return NextResponse.json({
      blastId: blast.id, batches,
      subject, body: `${personalize(text, null)}\n\n${footer}`,
      skipped: { noEmail: pick.noEmail, optedOut: pick.optedOut },
    });
  }

  const stream = process.env.POSTMARK_BROADCAST_STREAM ?? "broadcast";
  let sent = 0, failed = 0;
  const results: { id: string; ok: boolean; detail: string }[] = [];
  for (let i = 0; i < pick.to.length; i += POSTMARK_BATCH) {
    const chunk = pick.to.slice(i, i + POSTMARK_BATCH);
    const r = await postmark(token!, chunk.map((t) => ({
      From: from, To: t.email, ReplyTo: replyTo, Subject: subject,
      TextBody: `${personalize(text, t)}\n\n${footer}`, MessageStream: stream,
    })));
    chunk.forEach((t, k) => results.push({ id: t.id, ok: Boolean(r[k]?.ok), detail: r[k]?.detail ?? "no answer" }));
  }
  for (const r of results) {
    if (r.ok) sent++; else failed++;
    await db.from("broker_blast_recipients").update({ status: r.ok ? "sent" : "failed", detail: r.detail.slice(0, 500), at: new Date().toISOString() })
      .eq("blast_id", blast.id).eq("broker_id", r.id);
  }
  await db.from("broker_blasts").update({ sent, failed }).eq("id", blast.id);
  await logTouches(db, me.id, results.filter((r) => r.ok).map((r) => r.id), subject);
  const firstFail = results.find((r) => !r.ok)?.detail;
  return NextResponse.json({ blastId: blast.id, sent, failed, firstFail, skipped: { noEmail: pick.noEmail, optedOut: pick.optedOut } });
}

type Db = Awaited<ReturnType<typeof supabaseServer>>;

async function gmailSent(db: Db, by: string, blastId: string, batch: number) {
  if (!/^[0-9a-f-]{36}$/.test(blastId) || !Number.isInteger(batch) || batch < 0)
    return NextResponse.json({ error: "which blast and which batch?" }, { status: 400 });
  const { data: rows, error } = await db.from("broker_blast_recipients")
    .select("broker_id, status").eq("blast_id", blastId).eq("batch", batch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: blast } = await db.from("broker_blasts").select("subject, sent").eq("id", blastId).single();
  const slice = (rows ?? []).filter((r) => r.status !== "sent");
  if (!slice.length) return NextResponse.json({ ok: true, already: true });
  const ids = slice.map((r) => r.broker_id);
  await db.from("broker_blast_recipients").update({ status: "sent", detail: "sent from Gmail", at: new Date().toISOString() })
    .eq("blast_id", blastId).in("broker_id", ids);
  await db.from("broker_blasts").update({ sent: (blast?.sent ?? 0) + ids.length }).eq("id", blastId);
  await logTouches(db, by, ids, blast?.subject ?? "Blast");
  return NextResponse.json({ ok: true, marked: ids.length });
}

async function logTouches(db: Db, by: string, ids: string[], subject: string) {
  if (!ids.length) return;
  await db.from("broker_touches").insert(ids.map((id) => ({ broker_id: id, kind: "email", body: `Blast: ${subject}`, by })));
  // A broker nobody had written to has now been written to.
  await db.from("brokers").update({ stage: "emailed", updated_at: new Date().toISOString(), updated_by: by })
    .in("id", ids).eq("stage", "new");
}

async function postmark(token: string, messages: Record<string, unknown>[]) {
  try {
    const res = await fetch("https://api.postmarkapp.com/email/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Postmark-Server-Token": token },
      body: JSON.stringify(messages), signal: AbortSignal.timeout(40_000),
    });
    const t = await res.text();
    let j: unknown = null;
    try { j = JSON.parse(t); } catch { /* not JSON */ }
    if (!res.ok || !Array.isArray(j)) {
      const why = `Postmark answered ${res.status}: ${t.slice(0, 300)}`;
      return messages.map(() => ({ ok: false, detail: why }));
    }
    return (j as { ErrorCode?: number; Message?: string }[]).map((r) => ({
      ok: r.ErrorCode === 0, detail: r.ErrorCode === 0 ? "sent" : `code ${r.ErrorCode}: ${r.Message ?? ""}`,
    }));
  } catch (e) {
    return messages.map(() => ({ ok: false, detail: `could not reach Postmark: ${(e as Error).message}` }));
  }
}
