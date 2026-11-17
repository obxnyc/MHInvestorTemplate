"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { addDays, dollars, shortDay } from "@/lib/collections";

type Card = {
  rmTenantId: number;
  balanceCents: number;
  readAt: string | null;
  stage: string;
  stageLabel: string;
  next: { label: string; due: string; overdue: number } | null;
  outBy: string;
  open: { amountCents: number; dueOn: string; paidCents: number } | null;
  broken: { amountCents: number; dueOn: string } | null;
  suggestion: { cents: number; dueOn: string; from: string; messageId: string } | null;
  canEdit: boolean;
  today: string;
};

/**
 * Rent, on the thread where the tenant is talking about it.
 *
 * The person collecting is on the office line; this is where they are when
 * the tenant says "I can pay Friday". Logging it here means it is on the
 * collections screen for everybody the moment it is said -- nobody relays
 * anything.
 */
export default function CollectionCard({ contactId, conversationId, bump }: {
  contactId: string | null; conversationId: string; bump?: unknown;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [form, setForm] = useState<"promise" | "note" | null>(null);
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = async () => {
    if (!contactId) { setCard(null); return; }
    const r = await fetch(`/api/collections/card?contact=${contactId}&conversation=${conversationId}`).catch(() => null);
    const out = await r?.json().catch(() => null);
    setCard(out?.card ?? null);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setForm(null); setSaid(null); setProblem(null); load(); }, [contactId, conversationId, bump]);

  if (!card) return null;

  const send = async (body: Record<string, unknown>, done: string) => {
    setBusy(true); setProblem(null); setSaid(null);
    const r = await fetch("/api/collections", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: card.rmTenantId, ...body }),
    }).catch(() => null);
    const out = await r?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!r || !r.ok) { setProblem(out.error ?? "That did not save."); return; }
    setSaid(done); setForm(null); setAmount(""); setNote(""); load();
  };

  const tone = card.broken ? "rc-broken" : card.open ? (card.open.dueOn <= card.outBy ? "rc-arranged" : "rc-talking") : "rc-silent";

  return (
    <div className={`rccard ${tone}`}>
      <div className="rccardtop">
        <span>Owes <b>{dollars(card.balanceCents)}</b></span>
        <span>{card.stageLabel}</span>
        <Link href={`/collections#t${card.rmTenantId}`}>Collections</Link>
      </div>
      {card.next ? (
        <p>Next: {card.next.label} {card.next.overdue ? <b>— {card.next.overdue} days overdue</b> : card.next.due === card.today ? "today" : `by ${shortDay(card.next.due)}`}</p>
      ) : null}
      {card.open ? <p>Promised {dollars(card.open.amountCents)} by {shortDay(card.open.dueOn)}{card.open.paidCents ? ` · ${dollars(card.open.paidCents)} in so far` : ""}.</p>
        : card.broken ? <p>Broke a promise of {dollars(card.broken.amountCents)} due {shortDay(card.broken.dueOn)}.</p> : null}
      {said ? <p className="rcok">{said}</p> : null}
      {problem ? <p className="rcbad">{problem}</p> : null}
      {card.canEdit ? (
        <>
          {card.suggestion && !form ? (
            <div className="rcsuggest">
              <span>They said: <q>{card.suggestion.from}</q></span>
              <button className="btn mini pri" disabled={busy} onClick={() => send({
                action: "promise", amount: card.suggestion!.cents / 100, dueOn: card.suggestion!.dueOn,
                messageId: card.suggestion!.messageId, note: "From their text.",
              }, "Promise logged.")}>Log {dollars(card.suggestion.cents)} by {shortDay(card.suggestion.dueOn)}</button>
            </div>
          ) : null}
          {form === "promise" ? (
            <div className="rccardform">
              <input aria-label="Amount" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <input aria-label="By" type="date" min={card.today} value={due || addDays(card.today, 3)} onChange={(e) => setDue(e.target.value)} />
              <button className="btn mini pri" disabled={busy || !amount}
                      onClick={() => send({ action: "promise", amount, dueOn: due || addDays(card.today, 3) }, "Promise logged.")}>Log promise</button>
              <button className="btn mini" onClick={() => setForm(null)}>Cancel</button>
            </div>
          ) : form === "note" ? (
            <div className="rccardform">
              <input aria-label="Note" style={{ maxWidth: "100%", flex: "1 1 14rem" }} placeholder="What they said about the rent" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn mini pri" disabled={busy || !note.trim()} onClick={() => send({ action: "note", body: note }, "Note saved on their collections record.")}>Save</button>
              <button className="btn mini" onClick={() => setForm(null)}>Cancel</button>
            </div>
          ) : (
            <div className="rccardform">
              <button className="btn mini" onClick={() => setForm("promise")}>They promised to pay</button>
              <button className="btn mini" onClick={() => setForm("note")}>Rent note</button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
