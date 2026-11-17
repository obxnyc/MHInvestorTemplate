import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isDesk, canSeeOffice } from "@/lib/roles";
import { newYork } from "@/lib/delinquency";
import {
  DEFAULT_POLICY, REMINDERS, STAGE_LABEL, isStage, shortDay, stageIndex, type Policy, type Stage,
} from "@/lib/collections";
import {
  draftsToday, judgeAll, readSettings, sendDrafts, syncCollections, textContact,
} from "@/lib/collections-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = Record<string, unknown>;

/**
 * One tenant's whole story: every note, every step, every promise, and
 * every text and call with them on the shared line -- so nobody has to
 * relay a conversation for it to be on the record. It is already here.
 */
export async function GET(req: Request) {
  const me = await requireStaff();
  if (!me || !canSeeOffice(me.role)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const url = new URL(req.url);
  const db = supabaseAdmin();

  if (url.searchParams.get("drafts") === "1") {
    return NextResponse.json(await draftsToday(db));
  }

  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "which tenant?" }, { status: 400 });

  const [{ data: events }, { data: contacts }, { data: readings }] = await Promise.all([
    db.from("collection_events").select("id, at, by, kind, body, stage_from, stage_to, staff:staff!collection_events_by_fkey(full_name)")
      .eq("rm_tenant_id", id).order("at", { ascending: false }).limit(300),
    db.from("contacts").select("id, full_name, phone").eq("rm_tenant_id", id),
    db.from("collection_readings").select("at, cents").eq("rm_tenant_id", id)
      .order("at", { ascending: false }).limit(60),
  ]);

  const contactIds = ((contacts ?? []) as Row[]).map((c) => String(c.id));
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  let messages: Row[] = [];
  let calls: Row[] = [];
  if (contactIds.length) {
    const { data: convos } = await db.from("conversations").select("id").in("contact_id", contactIds);
    const convoIds = ((convos ?? []) as Row[]).map((c) => String(c.id));
    const [m, c] = await Promise.all([
      convoIds.length
        ? db.from("messages").select("id, conversation_id, direction, body, body_en, created_at, channel, staff:staff!messages_sent_by_fkey(full_name)")
            .in("conversation_id", convoIds).gte("created_at", since)
            .order("created_at", { ascending: false }).limit(200)
        : Promise.resolve({ data: [] as Row[], error: null }),
      db.from("calls").select("id, direction, missed, duration_seconds, created_at, notes, summary, follow_up, voicemail_text, conversation_id, who:staff!calls_answered_by_fkey(full_name)")
        .in("contact_id", contactIds).gte("created_at", since)
        .order("created_at", { ascending: false }).limit(100),
    ]);
    messages = (m.data ?? []) as Row[];
    calls = (c.data ?? []) as Row[];
    // A select naming a foreign key the database does not have fails whole;
    // fall back to the plain columns rather than showing nobody's calls.
    if (c.error) {
      const plain = await db.from("calls").select("id, direction, missed, duration_seconds, created_at, notes, summary, follow_up, voicemail_text, conversation_id")
        .in("contact_id", contactIds).gte("created_at", since).order("created_at", { ascending: false }).limit(100);
      calls = (plain.data ?? []) as Row[];
    }
    if (m.error && convoIds.length) {
      const plain = await db.from("messages").select("id, conversation_id, direction, body, body_en, created_at, channel")
        .in("conversation_id", convoIds).gte("created_at", since).order("created_at", { ascending: false }).limit(200);
      messages = (plain.data ?? []) as Row[];
    }
  }
  const nameOf = (r: Row, k: string) => ((r[k] as { full_name?: string } | null)?.full_name) ?? null;

  type Item = { at: string; kind: string; body: string; who: string | null; dir?: string; link?: string | null };
  const items: Item[] = [
    ...((events ?? []) as Row[]).map((e) => ({
      at: String(e.at), kind: String(e.kind), body: String(e.body), who: nameOf(e, "staff"),
    })),
    ...messages.map((m) => ({
      at: String(m.created_at), kind: m.direction === "inbound" ? "heard" : "sent",
      body: String(m.body_en || m.body || ""), who: m.direction === "inbound" ? null : nameOf(m, "staff"),
      dir: String(m.direction), link: `/c/${m.conversation_id}`,
    })),
    ...calls.map((c) => ({
      at: String(c.created_at), kind: c.missed ? "missed" : "call",
      body: [
        `${c.direction === "inbound" ? "Called in" : "Called them"}${c.missed ? " — missed" : c.duration_seconds ? ` · ${Math.round(Number(c.duration_seconds) / 60)} min` : ""}`,
        c.summary, c.notes, c.follow_up ? `Follow up: ${c.follow_up}` : null, c.voicemail_text ? `Voicemail: “${c.voicemail_text}”` : null,
      ].filter(Boolean).join("\n"),
      who: nameOf(c, "who"), link: c.conversation_id ? `/c/${c.conversation_id}` : null,
    })),
  ].filter((i) => i.body.trim());
  // Our own reminder texts are both an event and a message; show the message.
  const seenText = new Set(items.filter((i) => i.kind === "sent").map((i) => i.body.trim()));
  const merged = items.filter((i) => !(i.kind === "text" && seenText.has(i.body.replace(/^Texted( automatically)?: “|”$/g, "").trim())))
    .sort((a, b) => b.at.localeCompare(a.at));

  return NextResponse.json({
    items: merged,
    readings: readings ?? [],
    contacts: contacts ?? [],
  });
}

const cents = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const isDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Everything that changes the record, each by name. Who did it comes from
 * the session and never from the request.
 */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (!me || !isDesk(me.role)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const body = await req.json().catch(() => ({})) as Row;
  const action = String(body.action ?? "");
  const db = supabaseAdmin();
  const today = newYork(new Date()).day;
  const id = Number(body.id);

  const account = async () => {
    const { data } = await db.from("collection_accounts")
      .select("rm_tenant_id, name, balance_cents, stage, stage_on, court_on, contact_id").eq("rm_tenant_id", id).maybeSingle();
    return data as Row | null;
  };

  switch (action) {
    case "refresh": {
      const r = await syncCollections(db, 45);
      return NextResponse.json(r, { status: r.ok ? 200 : 502 });
    }

    case "note": {
      const text = String(body.body ?? "").trim();
      if (!text) return NextResponse.json({ error: "Write the note first." }, { status: 400 });
      if (!(await account())) return NextResponse.json({ error: "no such tenant" }, { status: 404 });
      const { error } = await db.from("collection_events").insert({ rm_tenant_id: id, kind: "note", by: me.id, body: text.slice(0, 4000) });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "promise": {
      const a = await account();
      if (!a) return NextResponse.json({ error: "no such tenant" }, { status: 404 });
      const amount = cents(body.amount);
      if (!amount) return NextResponse.json({ error: "How much did they say they would pay?" }, { status: 400 });
      if (!isDay(body.dueOn)) return NextResponse.json({ error: "Which day did they say?" }, { status: 400 });
      if (String(body.dueOn) < today) return NextResponse.json({ error: "That day has already passed." }, { status: 400 });
      const paidNow = cents(body.paidNow) ?? 0;
      const note = String(body.note ?? "").trim() || null;
      const { data: pr, error } = await db.from("collection_promises").insert({
        rm_tenant_id: id, amount_cents: amount, due_on: body.dueOn, made_by: me.id,
        balance_at_cents: Number(a.balance_cents), paid_now_cents: paidNow, note,
        message_id: typeof body.messageId === "string" && body.messageId ? body.messageId : null,
      }).select("id").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await db.from("collection_events").insert({
        rm_tenant_id: id, kind: "promise", by: me.id, promise_id: pr.id,
        body: `Promised $${(amount / 100).toFixed(2)} by ${shortDay(String(body.dueOn))}`
          + (paidNow ? ` (paid $${(paidNow / 100).toFixed(2)} now)` : "")
          + (note ? `. ${note}` : "."),
      });
      return NextResponse.json({ ok: true, id: pr.id });
    }

    case "cancel-promise": {
      const pid = String(body.promiseId ?? "");
      const { data: pr } = await db.from("collection_promises").select("id, rm_tenant_id, amount_cents, due_on, status")
        .eq("id", pid).maybeSingle();
      if (!pr) return NextResponse.json({ error: "no such promise" }, { status: 404 });
      await db.from("collection_promises").update({
        status: "cancelled", cancelled_by: me.id, cancelled_at: new Date().toISOString(),
      }).eq("id", pid);
      await db.from("collection_events").insert({
        rm_tenant_id: pr.rm_tenant_id, kind: "promise", by: me.id, promise_id: pid,
        body: `Took off the promise of $${(Number(pr.amount_cents) / 100).toFixed(2)} by ${shortDay(String(pr.due_on))}`
          + (String(body.why ?? "").trim() ? `: ${String(body.why).trim()}` : "."),
      });
      return NextResponse.json({ ok: true });
    }

    case "stage": {
      const a = await account();
      if (!a) return NextResponse.json({ error: "no such tenant" }, { status: 404 });
      const to = String(body.to ?? "");
      if (!isStage(to)) return NextResponse.json({ error: "not a step" }, { status: 400 });
      const on = isDay(body.on) ? String(body.on) : today;
      if (on > today) return NextResponse.json({ error: "A step taken in the future has not been taken." }, { status: 400 });
      const patch: Row = { stage: to, stage_on: on, stage_by: me.id, updated_at: new Date().toISOString() };
      if (to === "filed") {
        if (body.courtOn !== undefined && body.courtOn !== "" && !isDay(body.courtOn)) {
          return NextResponse.json({ error: "That court date is not a date." }, { status: 400 });
        }
        patch.court_on = isDay(body.courtOn) ? body.courtOn : null;
        if (typeof body.caseNumber === "string") patch.case_number = body.caseNumber.trim() || null;
      }
      if (to === "current") patch.paid_during = null;
      const from = String(a.stage) as Stage;
      const { error } = await db.from("collection_accounts").update(patch).eq("rm_tenant_id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const back = stageIndex(to) < stageIndex(from);
      const why = String(body.why ?? "").trim();
      await db.from("collection_events").insert({
        rm_tenant_id: id, kind: "stage", by: me.id, stage_from: from, stage_to: to,
        body: `${back ? "Moved back to" : "Done"}: ${STAGE_LABEL[to]} on ${shortDay(on)}`
          + (to === "filed" && patch.court_on ? `. Court ${shortDay(String(patch.court_on))}` : "")
          + (to === "filed" && patch.case_number ? `, case ${patch.case_number}` : "")
          + (why ? `. ${why}` : "."),
      });
      return NextResponse.json({ ok: true });
    }

    case "court": {
      const a = await account();
      if (!a) return NextResponse.json({ error: "no such tenant" }, { status: 404 });
      if (!isDay(body.courtOn)) return NextResponse.json({ error: "That court date is not a date." }, { status: 400 });
      await db.from("collection_accounts").update({
        court_on: body.courtOn,
        ...(typeof body.caseNumber === "string" ? { case_number: body.caseNumber.trim() || null } : {}),
      }).eq("rm_tenant_id", id);
      await db.from("collection_events").insert({
        rm_tenant_id: id, kind: "stage", by: me.id, body: `Court date: ${shortDay(String(body.courtOn))}.`,
      });
      return NextResponse.json({ ok: true });
    }

    case "dismissed": {
      await db.from("collection_accounts").update({ paid_during: null }).eq("rm_tenant_id", id);
      await db.from("collection_events").insert({
        rm_tenant_id: id, kind: "stage", by: me.id, body: "The case is dismissed / nothing to dismiss.",
      });
      return NextResponse.json({ ok: true });
    }

    case "assign": {
      const who = String(body.staffId ?? "") || null;
      await db.from("collection_accounts").update({ assigned_to: who }).eq("rm_tenant_id", id);
      return NextResponse.json({ ok: true });
    }

    case "text": {
      const a = await account();
      if (!a) return NextResponse.json({ error: "no such tenant" }, { status: 404 });
      const text = String(body.body ?? "").trim();
      if (!text) return NextResponse.json({ error: "Write the text first." }, { status: 400 });
      if (!a.contact_id) return NextResponse.json({ error: "This tenant has no contact on file to text." }, { status: 400 });
      const r = await textContact(db, String(a.contact_id), text, me.id);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
      return NextResponse.json({ ok: true, conversationId: r.conversationId });
    }

    case "send-reminders": {
      const keys = new Set(Array.isArray(body.keys) ? (body.keys as unknown[]).map(String) : []);
      if (!keys.size) return NextResponse.json({ error: "Tick the texts to send." }, { status: 400 });
      // Rebuilt here rather than taken from the browser: the words that go
      // out are the server's, and a text already sent is not in this list.
      const { drafts } = await draftsToday(db);
      const pick = drafts.filter((d) => keys.has(d.key));
      const r = await sendDrafts(db, pick, me.id);
      return NextResponse.json({ ok: true, ...r });
    }

    case "settings": {
      if (me.role !== "admin") return NextResponse.json({ error: "Only an admin changes the policy." }, { status: 403 });
      const cur = await readSettings(db);
      const raw = (body.policy ?? {}) as Row;
      const policy: Policy = { ...cur.policy };
      for (const k of Object.keys(DEFAULT_POLICY) as (keyof Policy)[]) {
        if (raw[k] === undefined || raw[k] === "") continue;
        const n = Number(raw[k]);
        if (!Number.isInteger(n) || n < 0 || n > 120) {
          return NextResponse.json({ error: `${k} must be a whole number of days or percent.` }, { status: 400 });
        }
        policy[k] = n;
      }
      if (policy.lateAfterDay < policy.dueDay || policy.lateAfterDay > 27) {
        return NextResponse.json({ error: "Late-after must be on or after the due day, and before the 28th." }, { status: 400 });
      }
      const enabled = Array.isArray(body.enabled)
        ? (body.enabled as unknown[]).map(String).filter((k) => (REMINDERS as readonly string[]).includes(k))
        : [...cur.enabled];
      const sendHour = body.sendHour === undefined ? cur.sendHour : Number(body.sendHour);
      if (!Number.isInteger(sendHour) || sendHour < 8 || sendHour > 19) {
        return NextResponse.json({ error: "Texts go between 8am and 7pm." }, { status: 400 });
      }
      const { error } = await db.from("collection_settings").update({
        policy, enabled, send_hour: sendHour,
        auto_send: body.autoSend === undefined ? cur.autoSend : Boolean(body.autoSend),
        updated_by: me.id, updated_at: new Date().toISOString(),
      }).eq("id", true);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    case "rejudge": {
      const n = await judgeAll(db, today, Number.isInteger(id) ? [id] : undefined);
      return NextResponse.json({ ok: true, changed: n });
    }
  }
  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}
