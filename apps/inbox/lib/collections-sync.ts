/**
 * Rent collections: reading Rent Manager into the record, and texting.
 *
 * The rules are in `collections.ts` and are pure. This file is the part
 * that touches the world: Rent Manager, the database and the shared line.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readRoster } from "./delinquency-pull";
import { pick, num, readName, readOwed, newYork } from "./delinquency";
import { sendSms } from "./notify";
import { canSmsFromLine } from "./phone";
import {
  DEFAULT_POLICY, REMINDERS, STAGE_LABEL, shortDay, isStage, judge, remindersDue, settle, paidSince,
  type Account, type Draft, type Judged, type PayPromise, type Person, type Policy,
  type Reminder, type Reading, type Stage,
} from "./collections";

type Db = SupabaseClient;

export type Settings = {
  policy: Policy;
  enabled: Set<Reminder>;
  autoSend: boolean;
  sendHour: number;
};

export async function readSettings(db: Db): Promise<Settings> {
  const { data } = await db.from("collection_settings")
    .select("policy, enabled, auto_send, send_hour").eq("id", true).maybeSingle();
  const raw = (data?.policy ?? {}) as Partial<Policy>;
  const policy: Policy = { ...DEFAULT_POLICY };
  for (const k of Object.keys(DEFAULT_POLICY) as (keyof Policy)[]) {
    const n = Number(raw[k]);
    if (Number.isFinite(n) && n >= 0) policy[k] = n;
  }
  const enabled = new Set(((data?.enabled ?? REMINDERS) as string[])
    .filter((k): k is Reminder => (REMINDERS as readonly string[]).includes(k)));
  return {
    policy, enabled,
    autoSend: Boolean(data?.auto_send),
    sendHour: Number(data?.send_hour ?? 9),
  };
}

/* ------------------------------------------------------------------ the read */

export type SyncResult = {
  ok: boolean;
  error: string | null;
  tenants: number;
  owing: number;
  partial: boolean;
  moved: number;
  judged: number;
};

type Row = Record<string, unknown>;

/**
 * Read every tenant's balance from Rent Manager and bring the record up to
 * date: balances, the readings a payment is read from, the step each
 * account is at, and whether each promise came.
 *
 * A PARTIAL READ ZEROES NOBODY. A tenant who was not read this time is not
 * a tenant who paid; only a whole read may say somebody owes nothing, and
 * even then only by their record answering with no open charges.
 */
export async function syncCollections(db: Db, seconds = 42): Promise<SyncResult> {
  const today = newYork(new Date()).day;
  const { policy } = await readSettings(db);
  const got = await readRoster(seconds);
  if (!got.ok) {
    await db.from("collection_pulls").insert({ ok: false, detail: got.error });
    return { ok: false, error: got.error, tenants: 0, owing: 0, partial: false, moved: 0, judged: 0 };
  }

  const readAs = { ...got.readAs };
  const seen: { id: number; name: string; status: string | null; cents: number; oldest: string | null }[] = [];
  for (const t of got.rows) {
    const id = num(pick(t, ["TenantID", "TenantId", "ID"], readAs, "tenantId"));
    if (id === null) continue;
    const o = readOwed(t, readAs);
    if (!o) continue; // said nothing about money: not "paid up"
    const name = readName(String(pick(t, ["Name", "LastNameFirstName", "TenantDisplayID"], readAs, "name") ?? ""))
      ?? `Tenant ${id}`;
    const status = pick(t, ["Status", "TenantStatus"], readAs, "status");
    seen.push({
      id, name, status: typeof status === "string" ? status : null,
      cents: Math.max(0, Math.round(o.balance * 100)), oldest: o.oldest,
    });
  }

  /* Who they are on this side: the contact the tenant import joined, its
     phone, its unit and the park. Several contacts can share a tenancy;
     the one the shared line can text is preferred. */
  const ids = seen.map((s) => s.id);
  const contact = new Map<number, { id: string; unit: string | null; place: string | null; textable: boolean }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("contacts")
      .select("id, phone, rm_tenant_id, unit_id, units(label, properties(name))")
      .in("rm_tenant_id", ids.slice(i, i + 200));
    for (const c of (data ?? []) as unknown as {
      id: string; phone: string | null; rm_tenant_id: number; unit_id: string | null;
      units: { label: string | null; properties: { name: string | null } | null } | null;
    }[]) {
      const textable = Boolean(c.phone && canSmsFromLine(c.phone));
      const had = contact.get(Number(c.rm_tenant_id));
      if (had && (had.textable || !textable)) continue;
      const u = c.units;
      const prop = u?.properties?.name ?? null;
      const place = !u ? null : !prop ? (u.label ?? null)
        : !u.label || u.label === prop ? prop : `${prop} · ${u.label}`;
      contact.set(Number(c.rm_tenant_id), { id: c.id, unit: c.unit_id, place, textable });
    }
  }

  const before = new Map<number, Row>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await db.from("collection_accounts")
      .select("rm_tenant_id, balance_cents, stage, stage_on, court_on, oldest_charge")
      .in("rm_tenant_id", ids.slice(i, i + 500));
    for (const r of (data ?? []) as Row[]) before.set(Number(r.rm_tenant_id), r);
  }

  const now = new Date().toISOString();
  const upserts: Row[] = [];
  const readings: Row[] = [];
  const events: Row[] = [];
  let moved = 0;
  for (const s of seen) {
    const had = before.get(s.id);
    const c = contact.get(s.id);
    const acct: Account = {
      rmTenantId: s.id, name: s.name, balanceCents: s.cents, oldestCharge: s.oldest,
      stage: isStage(had?.stage) ? had!.stage as Stage : "current",
      stageOn: (had?.stage_on as string | null) ?? null,
      courtOn: (had?.court_on as string | null) ?? null,
    };
    const next = settle(acct, today, policy);
    const row: Row = {
      rm_tenant_id: s.id, name: s.name, rm_status: s.status,
      balance_cents: s.cents, oldest_charge: s.oldest, read_at: now, updated_at: now,
      contact_id: c?.id ?? null, unit_id: c?.unit ?? null, place: c?.place ?? null,
      stage: next.stage, stage_on: next.stageOn,
    };
    if (next.movedTo) {
      moved++;
      row.stage_by = null;
      if (next.paidDuring) {
        row.paid_during = next.paidDuring;
        if (next.paidDuring !== "late") row.court_on = null;
      }
      events.push({
        rm_tenant_id: s.id, kind: next.paidDuring ? "payment" : "stage",
        stage_from: acct.stage, stage_to: next.stage,
        body: next.paidDuring
          ? `Paid in full while at "${STAGE_LABEL[next.paidDuring]}".`
            + (next.paidDuring === "late" ? "" : " If the eviction was filed, it needs dismissing.")
          : `Late: ${STAGE_LABEL.late.toLowerCase()} served ${shortDay(next.stageOn ?? today)}. Balance $${(s.cents / 100).toFixed(2)}.`,
      });
    }
    upserts.push(row);
    const prev = had ? Number(had.balance_cents) : 0;
    if (!had ? s.cents > 0 : prev !== s.cents) readings.push({ rm_tenant_id: s.id, at: now, cents: s.cents });
  }

  for (let i = 0; i < upserts.length; i += 200) {
    const { error } = await db.from("collection_accounts").upsert(upserts.slice(i, i + 200), { onConflict: "rm_tenant_id" });
    if (error) {
      await db.from("collection_pulls").insert({ ok: false, tenants: seen.length, detail: `writing balances: ${error.message}` });
      return { ok: false, error: error.message, tenants: seen.length, owing: 0, partial: got.partial, moved: 0, judged: 0 };
    }
  }
  if (readings.length) await db.from("collection_readings").insert(readings);
  if (events.length) await db.from("collection_events").insert(events);

  const judged = await judgeAll(db, today);
  const owing = seen.filter((s) => s.cents >= 100).length;
  await db.from("collection_pulls").insert({
    ok: true, tenants: seen.length, owing, partial: got.partial,
    detail: `via ${got.using}; read as ${JSON.stringify(readAs)}`,
  });
  return { ok: true, error: null, tenants: seen.length, owing, partial: got.partial, moved, judged };
}

/* ------------------------------------------------------------------ promises */

export async function readingsFor(db: Db, ids: number[]): Promise<Map<number, Reading[]>> {
  const out = new Map<number, Reading[]>();
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("collection_readings")
      .select("rm_tenant_id, at, cents").in("rm_tenant_id", ids.slice(i, i + 200))
      .gte("at", new Date(Date.now() - 200 * 86_400_000).toISOString())
      .order("at", { ascending: true });
    for (const r of (data ?? []) as { rm_tenant_id: number; at: string; cents: number }[]) {
      const list = out.get(Number(r.rm_tenant_id)) ?? [];
      list.push({ at: new Date(r.at).toISOString(), cents: r.cents });
      out.set(Number(r.rm_tenant_id), list);
    }
  }
  return out;
}

export const toPromise = (r: Row): PayPromise & { rmTenantId: number } => ({
  id: String(r.id),
  rmTenantId: Number(r.rm_tenant_id),
  amountCents: Number(r.amount_cents),
  dueOn: String(r.due_on),
  // A row with no time on it (a default the database fills, missing from a
  // stand-in) must not take the whole screen down with a RangeError.
  madeAt: Number.isNaN(Date.parse(String(r.made_at ?? r.created_at))) ? new Date().toISOString()
    : new Date(String(r.made_at ?? r.created_at)).toISOString(),
  balanceAtCents: Number(r.balance_at_cents),
  paidNowCents: Number(r.paid_now_cents ?? 0),
  status: (r.status === "cancelled" ? "cancelled" : "open"),
});

/**
 * Re-read every live promise against the money. Promises from the last 90
 * days are re-judged, so a payment that lands after the day turns a broken
 * promise into a kept one -- and the history says that happened.
 */
export async function judgeAll(db: Db, today: string, only?: number[]): Promise<number> {
  let q = db.from("collection_promises")
    .select("id, rm_tenant_id, amount_cents, due_on, made_at, balance_at_cents, paid_now_cents, status, paid_cents")
    .neq("status", "cancelled")
    .gte("made_at", new Date(Date.now() - 90 * 86_400_000).toISOString());
  if (only) q = q.in("rm_tenant_id", only);
  const { data } = await q;
  const rows = (data ?? []) as Row[];
  if (!rows.length) return 0;
  const reads = await readingsFor(db, [...new Set(rows.map((r) => Number(r.rm_tenant_id)))]);
  let changed = 0;
  for (const r of rows) {
    const pr = toPromise(r);
    const j = judge(pr, reads.get(pr.rmTenantId) ?? [], today);
    if (j.status === r.status && j.paidCents === Number(r.paid_cents)) continue;
    changed++;
    await db.from("collection_promises").update({
      status: j.status, paid_cents: j.paidCents, judged_at: new Date().toISOString(),
    }).eq("id", pr.id);
    if (j.status !== r.status) {
      const amt = `$${(pr.amountCents / 100).toFixed(2)}`;
      await db.from("collection_events").insert({
        rm_tenant_id: pr.rmTenantId, kind: "promise", promise_id: pr.id,
        body: j.status === "kept"
          ? (r.status === "broken" ? `Paid after all: the ${amt} promised for ${shortDay(pr.dueOn)} came in late.` : `Kept: the ${amt} promised for ${shortDay(pr.dueOn)} came in.`)
          : j.status === "broken"
            ? `Broken: ${amt} was promised by ${shortDay(pr.dueOn)}${j.paidCents ? `; $${(j.paidCents / 100).toFixed(2)} of it came` : " and none of it came"}.`
            : `Open again: the ${amt} promised for ${shortDay(pr.dueOn)}.`,
      });
    }
  }
  return changed;
}

/* ------------------------------------------------------------------ texting */

/**
 * Text a tenant from the shared line, INTO their conversation, so the reply
 * lands in the inbox beside everything else they have said and whoever
 * answers can see what was sent. Never a side channel.
 */
export async function textContact(
  db: Db, contactId: string, body: string, staffId: string | null,
): Promise<{ ok: boolean; messageId: string | null; conversationId: string | null; error: string | null }> {
  const { data: who } = await db.from("contacts").select("id, phone").eq("id", contactId).maybeSingle();
  if (!who?.phone || !canSmsFromLine(who.phone)) {
    return { ok: false, messageId: null, conversationId: null, error: "There is no mobile number the shared line can text." };
  }
  let { data: convo } = await db.from("conversations")
    .select("id").eq("contact_id", contactId).neq("status", "closed")
    .order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (!convo) {
    const { data, error } = await db.from("conversations").insert({
      contact_id: contactId, category: "collections", source: "sms",
      subject: "Rent", assigned_to: staffId, claimed_at: staffId ? new Date().toISOString() : null,
    }).select("id").single();
    if (error) return { ok: false, messageId: null, conversationId: null, error: error.message };
    convo = data;
  }
  const sid = await sendSms(who.phone, body);
  const { data: msg, error } = await db.from("messages").insert({
    conversation_id: convo!.id, direction: "outbound", channel: "sms", body,
    twilio_sid: sid, status: sid ? "queued" : "failed", sent_by: staffId,
  }).select("id").single();
  await db.from("conversations").update({
    last_message_at: new Date().toISOString(), last_message_preview: body.slice(0, 160),
  }).eq("id", convo!.id);
  if (!sid) return { ok: false, messageId: msg?.id ?? null, conversationId: convo!.id, error: "The carrier did not take it." };
  if (error) return { ok: true, messageId: null, conversationId: convo!.id, error: "Sent, but not written to the thread." };
  return { ok: true, messageId: msg!.id, conversationId: convo!.id, error: null };
}

/** Everybody the reminders could go to, with what a text needs to say. */
export async function people(db: Db): Promise<(Person & { contactId: string | null })[]> {
  const out: (Person & { contactId: string | null })[] = [];
  const { data } = await db.from("collection_accounts")
    .select("rm_tenant_id, name, rm_status, balance_cents, contact_id, contacts(phone), units(tenant_rent_cents, monthly_rent, late_fee_cents)")
    .neq("stage", "out").limit(5000);
  for (const r of (data ?? []) as unknown as {
    rm_tenant_id: number; name: string; rm_status: string | null; balance_cents: number; contact_id: string | null;
    contacts: { phone: string | null } | null;
    units: { tenant_rent_cents: number | null; monthly_rent: number | null; late_fee_cents: number | null } | null;
  }[]) {
    const phone = r.contacts?.phone && canSmsFromLine(r.contacts.phone) ? r.contacts.phone : null;
    const rent = r.units?.tenant_rent_cents ?? (r.units?.monthly_rent != null ? Math.round(Number(r.units.monthly_rent) * 100) : null);
    out.push({
      rmTenantId: Number(r.rm_tenant_id), name: r.name, phone, status: r.rm_status,
      balanceCents: r.balance_cents, rentCents: rent || null,
      lateFeeCents: r.units?.late_fee_cents ?? null, contactId: r.contact_id,
    });
  }
  return out;
}

/** The texts due today that have not gone. */
export async function draftsToday(db: Db, settings?: Settings): Promise<{ day: string; drafts: (Draft & { contactId: string | null })[] }> {
  const s = settings ?? await readSettings(db);
  const day = newYork(new Date()).day;
  const ps = await people(db);
  const { data: prs } = await db.from("collection_promises")
    .select("id, rm_tenant_id, amount_cents, due_on, made_at, balance_at_cents, paid_now_cents, status, paid_cents")
    .in("status", ["open", "broken"])
    .gte("due_on", new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10));
  const promises: (Judged & { rmTenantId: number })[] = ((prs ?? []) as Row[]).map((r) => ({
    ...toPromise(r), judged: r.status as Judged["judged"], paidCents: Number(r.paid_cents ?? 0),
  }));
  const { data: sentRows } = await db.from("collection_texts")
    .select("key").gte("claimed_at", new Date(Date.now() - 45 * 86_400_000).toISOString());
  const sent = new Set(((sentRows ?? []) as { key: string }[]).map((r) => r.key));
  const contactOf = new Map(ps.map((p) => [p.rmTenantId, p.contactId]));
  const drafts = remindersDue(day, ps, promises, sent, s.enabled, s.policy)
    .map((d) => ({ ...d, contactId: contactOf.get(d.rmTenantId) ?? null }));
  return { day, drafts };
}

/**
 * Send the given drafts. Each is CLAIMED in the ledger before it is sent:
 * a second press, or the schedule waking while somebody presses, loses the
 * insert and sends nothing. Send-then-record would send twice whenever two
 * overlapped.
 */
export async function sendDrafts(
  db: Db, drafts: (Draft & { contactId: string | null })[], staffId: string | null,
): Promise<{ sent: number; failed: { name: string; why: string }[]; skipped: number }> {
  let sent = 0, skipped = 0;
  const failed: { name: string; why: string }[] = [];
  for (const d of drafts) {
    const { error: claim } = await db.from("collection_texts").insert({
      key: d.key, rm_tenant_id: d.rmTenantId, kind: d.kind, sent_by: staffId,
    });
    if (claim) { skipped++; continue; }
    if (!d.contactId) {
      failed.push({ name: d.name, why: "no contact on file" });
      await db.from("collection_texts").update({ status: "failed", detail: "no contact" }).eq("key", d.key);
      continue;
    }
    const r = await textContact(db, d.contactId, d.body, staffId);
    await db.from("collection_texts").update({
      status: r.ok ? "sent" : "failed", detail: r.error, message_id: r.messageId,
    }).eq("key", d.key);
    if (r.ok) {
      sent++;
      await db.from("collection_events").insert({
        rm_tenant_id: d.rmTenantId, kind: "text", by: staffId,
        body: `${staffId ? "Texted" : "Texted automatically"}: “${d.body}”`,
      });
    } else failed.push({ name: d.name, why: r.error ?? "not sent" });
  }
  return { sent, failed, skipped };
}

export { paidSince };
