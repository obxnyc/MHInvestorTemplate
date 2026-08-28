"use client";
import { useState } from "react";

export default function Compose(
  { mode, onClose, onSent }:
  { mode: "new" | "broadcast"; onClose: () => void; onSent: (id?: string) => void },
) {
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const broadcast = mode === "broadcast";

  async function send() {
    setBusy(true); setError(null);
    const res = await fetch(broadcast ? "/api/broadcast" : "/api/conversations/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(broadcast ? { body } : { to, body }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "Couldn't send. Try again."); return; }
    onSent(json.conversationId);
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{broadcast ? "Staff broadcast" : "New message"}</h3>
        <p>
          {broadcast
            ? "Goes to every active employee as an individual text, not a group thread — so replies come back as normal conversations anyone can pick up."
            : "Opens in the shared list like everything else. There is no private side channel."}
        </p>

        {!broadcast && (
          <input
            value={to} onChange={(e) => setTo(e.target.value)} autoFocus
            inputMode="tel" placeholder="Mobile number"
          />
        )}
        <textarea
          rows={3} value={body} onChange={(e) => setBody(e.target.value)}
          autoFocus={broadcast}
          placeholder={broadcast
            ? "Office closed tomorrow for the holiday. Emergency maintenance line is still live."
            : "Message"}
        />
        {error && <p className="err">{error}</p>}

        <div className="acts">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" disabled={busy || !body.trim() || (!broadcast && !to.trim())}
                  onClick={send}>
            {busy ? "Sending…" : broadcast ? "Send to all staff" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
