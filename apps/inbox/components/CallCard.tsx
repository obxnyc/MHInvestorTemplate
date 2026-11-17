"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ReturnCall from "./ReturnCall";
import { prettyPhone, timeAgo } from "@/lib/format";
import { CALL_CATEGORIES, CATEGORY_TONE } from "@/lib/callcats";

export type Line = { who: "caller" | "us"; at: number; text: string };
export type Recording = {
  recording_sid: string; kind: "call" | "voicemail"; duration_seconds: number | null;
  transcript: Line[] | null; transcript_status: string | null; created_at: string;
};
export type CallView = {
  id: string; createdAt: string; name: string | null; phone: string;
  category: string | null; suggested: string | null;
  afterHours: boolean; spanish: boolean; missed: boolean; returned: boolean; live: boolean;
  answeredBy: string | null; duration: number | null; texted: string | null;
  voicemail: string | null; summary: string | null; followUp: string | null; notes: string | null;
  conversationId: string | null; recordings: Recording[];
};
export type Target = { kind: "person" | "team"; id: string; label: string };

const mins = (s: number | null) => (s ? (s < 60 ? `${s}s` : `${Math.round(s / 60)}m`) : "");

/**
 * One call on the Calls page.
 *
 * Every button here waits for the server and says what it said. Nothing on
 * this card shows a thing as done -- moved, filed, saved -- until the answer
 * has come back and said so, because a transfer that silently failed looks
 * exactly like one that worked, and the caller is the one who finds out.
 */
export default function CallCard({ call, targets }: { call: CallView; targets: Target[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState(call.notes ?? "");

  async function send(what: string, url: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    setBusy(what);
    setSaid(null);
    try {
      const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const text = await r.text();
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 200) || `The server answered ${r.status}.` }; }
      if (!r.ok || body.error) {
        setSaid({ ok: false, text: String(body.error ?? `The server answered ${r.status}.`) });
        return null;
      }
      return body;
    } catch {
      setSaid({ ok: false, text: "Could not reach the server. Check the connection and try again." });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function textBack() {
    const b = await send("text", `/api/calls/${call.id}/thread`, { method: "POST" });
    if (b?.conversationId) router.push(`/c/${b.conversationId}`);
  }

  async function transfer() {
    const t = targets.find((x) => `${x.kind}:${x.id}` === to);
    if (!t) { setSaid({ ok: false, text: "Choose who to transfer to first." }); return; }
    const b = await send("transfer", `/api/calls/${call.id}/transfer`, {
      method: "POST",
      body: JSON.stringify(t.kind === "person" ? { personId: t.id } : { routeKey: t.id }),
    });
    if (b) { setSaid({ ok: true, text: `Transferred to ${b.to}. You can hang up.` }); router.refresh(); }
  }

  async function file(category: string) {
    const b = await send("file", `/api/calls/${call.id}`, {
      method: "PATCH", body: JSON.stringify({ category: category || null }),
    });
    if (b) { setSaid({ ok: true, text: `Filed as ${category || "uncategorised"}.` }); router.refresh(); }
  }

  async function saveNotes() {
    const b = await send("notes", `/api/calls/${call.id}`, {
      method: "PATCH", body: JSON.stringify({ notes }),
    });
    if (b) { setSaid({ ok: true, text: "Note saved." }); router.refresh(); }
  }

  async function transcript() {
    const b = await send("transcript", `/api/calls/${call.id}/transcript`, { method: "POST" });
    if (b) { setSaid({ ok: !b.waiting, text: String(b.message ?? "") }); router.refresh(); }
  }

  const conversation = call.recordings.filter((r) => r.kind === "call");
  const lines = conversation.flatMap((r) => r.transcript ?? []);
  const transcribing = conversation.some((r) => r.transcript_status !== "completed");
  const tone = CATEGORY_TONE[call.category ?? ""] ?? "ot";
  const needsCallback = call.missed && !call.returned && call.texted !== "portal";

  return (
    <article className={`thread cl-card${needsCallback ? " needs" : ""}${call.live ? " cl-live" : ""}`}>
      <div className="line1">
        <span className="name">{call.name || prettyPhone(call.phone) || "Number withheld"}</span>
        <span className="when">{timeAgo(call.createdAt)}</span>
      </div>
      <div className="cl-meta">
        {call.name && call.phone && <span className="cl-num">{prettyPhone(call.phone)}</span>}
        {call.category && <span className={`cl-cat cl-${tone}`}>{call.category}</span>}
        {call.afterHours && <span className="cl-badge">After hours</span>}
        {call.spanish && <span className="cl-badge">Spanish</span>}
        {call.live && <span className="cl-badge cl-onair">On the line now</span>}
      </div>

      <p className="cl-status">
        {call.live ? <>Answered by {call.answeredBy ?? "someone"}</>
          : call.texted === "portal" ? <>Sent the resident portal link. No callback needed.</>
          : call.missed ? (call.returned ? <>Missed · returned</> : <span className="unclaimed">Missed — needs a callback</span>)
          : call.answeredBy ? <>Answered by {call.answeredBy}{call.duration ? ` · ${mins(call.duration)}` : ""}</>
          : <>Hung up before anyone answered</>}
        {call.texted === "missed" && <> · missed-call text sent</>}
        {call.texted === "homes" && <> · available homes texted</>}
      </p>

      {call.summary && <p className="cl-summary">{call.summary}</p>}
      {call.followUp && <p className="cl-follow"><b>Next step:</b> {call.followUp}</p>}
      {call.suggested && call.suggested !== call.category && (
        <p className="cl-suggest">
          Sounds like <b>{call.suggested}</b>.{" "}
          <button type="button" className="cl-link" disabled={!!busy} onClick={() => file(call.suggested!)}>
            File it there
          </button>
        </p>
      )}
      {!call.summary && call.voicemail && <p className="preview">Voicemail: {call.voicemail}</p>}

      {call.recordings.map((r) => (
        <div key={r.recording_sid} className="cl-rec">
          <span className="cl-reclabel">{r.kind === "voicemail" ? "Voicemail" : "Call recording"}{r.duration_seconds ? ` · ${mins(r.duration_seconds)}` : ""}</span>
          <audio controls preload="none" src={`/api/calls/recording/${r.recording_sid}`} className="rec" />
        </div>
      ))}

      {lines.length > 0 && (
        <details className="cl-transcript">
          <summary>Transcript</summary>
          <ol>
            {lines.map((l, i) => (
              <li key={i} className={l.who === "caller" ? "cl-them" : "cl-us"}>
                <b>{l.who === "caller" ? (call.name ?? "Caller") : "Larabee"}</b> {l.text}
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="cl-actions">
        {call.phone && needsCallback && <ReturnCall callId={call.id} phone={call.phone} />}
        {call.phone && !needsCallback && <a className="mini" href={`tel:${call.phone}`}>Call</a>}
        {call.phone && (
          <button type="button" className="mini" disabled={!!busy} onClick={textBack}>
            {busy === "text" ? "Opening…" : "Text back"}
          </button>
        )}
        {call.conversationId && <a className="mini" href={`/c/${call.conversationId}`}>Open thread</a>}
        {conversation.length > 0 && (lines.length === 0 || transcribing) && (
          <button type="button" className="mini" disabled={!!busy} onClick={transcript}>
            {busy === "transcript" ? "Checking…" : "Get transcript"}
          </button>
        )}
      </div>

      {call.live && (
        <div className="cl-transfer">
          <label htmlFor={`to-${call.id}`}>Transfer to</label>
          <select id={`to-${call.id}`} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose…</option>
            <optgroup label="A person">
              {targets.filter((t) => t.kind === "person").map((t) =>
                <option key={t.id} value={`person:${t.id}`}>{t.label}</option>)}
            </optgroup>
            <optgroup label="A team">
              {targets.filter((t) => t.kind === "team").map((t) =>
                <option key={t.id} value={`team:${t.id}`}>{t.label}</option>)}
            </optgroup>
          </select>
          <button type="button" className="mini primary" disabled={!!busy || !to} onClick={transfer}>
            {busy === "transfer" ? "Transferring…" : "Transfer"}
          </button>
        </div>
      )}

      <details className="cl-more">
        <summary>Category and notes</summary>
        <div className="cl-form">
          <label htmlFor={`cat-${call.id}`}>Filed as</label>
          <select id={`cat-${call.id}`} value={call.category ?? ""} disabled={!!busy}
            onChange={(e) => file(e.target.value)}>
            <option value="">Uncategorised</option>
            {CALL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label htmlFor={`notes-${call.id}`}>Notes</label>
          <textarea id={`notes-${call.id}`} rows={3} value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the summary missed" />
          <button type="button" className="mini primary" disabled={!!busy || notes === (call.notes ?? "")}
            onClick={saveNotes}>
            {busy === "notes" ? "Saving…" : "Save note"}
          </button>
        </div>
      </details>
      {call.notes && <p className="cl-notes"><b>Note:</b> {call.notes}</p>}

      {said && <p className={said.ok ? "cl-said" : "cl-error"} role="status">{said.text}</p>}
    </article>
  );
}
