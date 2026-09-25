"use client";
import { useEffect, useRef, useState } from "react";
import { initials, swatch } from "@/lib/format";
import type { Recipient } from "@/lib/compose";

/**
 * Who to message.
 *
 * Picking the person comes first, and then you land in their thread and write
 * there. The dialog this replaced asked for a phone number and a message in
 * one step, which meant composing blind: no history above the box, no way to
 * reach somebody already on file without knowing their number by heart, and no
 * route at all to a colleague.
 *
 * Staff, tenants, vendors and a bare number are one list, because the person
 * composing knows the name they want. Making them first decide which kind of
 * record that name lives in is asking them to know how the database is
 * arranged before they can send a text.
 */
function Picker({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<Recipient[] | null>(null);
  const [results, setResults] = useState<Recipient[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which request is current. A slow search for "sa" landing after a fast one
  // for "sam" would otherwise overwrite the right answer with a stale one.
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    // Straight away when the box is empty, so the recent list is there before
    // the dialog has finished opening.
    const wait = q.trim() ? 180 : 0;
    const timer = setTimeout(() => {
      fetch(`/api/compose?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((d) => {
          if (mine !== seq.current) return;
          setRecent(d.recent ?? null);
          setResults(d.results ?? null);
        })
        .catch(() => { if (mine === seq.current) setError("Couldn't load. Try again."); });
    }, wait);
    return () => clearTimeout(timer);
  }, [q]);

  async function open(p: Recipient) {
    setBusy(true); setError(null);
    try {
      if (p.kind === "staff") {
        const res = await fetch("/api/team", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId: p.id }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.id) throw new Error(out.error ?? "That didn't work.");
        location.assign(`/team?t=${out.id}`);
        return;
      }
      const res = await fetch("/api/conversations/new", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p.kind === "contact" ? { contactId: p.id } : { to: p.id }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.conversationId) throw new Error(out.error ?? "That didn't work.");
      location.assign(`/c/${out.conversationId}`);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "That didn't work.");
    }
  }

  const list = results ?? recent;
  const heading = results ? null : "Recent";

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="New message"
         onClick={onClose}>
      <div className="sheet rcp" onClick={(e) => e.stopPropagation()}>
        <div className="rcphead">
          <h3>New message</h3>
          <button className="x" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <input
          value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
          placeholder="Search staff, tenants, vendors, or a number…"
        />

        {error && <p className="err">{error}</p>}

        {heading && list && list.length > 0 && <p className="rcpcap">{heading}</p>}

        <div className="rcplist">
          {list === null && <p className="dim pad">Looking…</p>}
          {list !== null && list.length === 0 && (
            <p className="dim pad">
              {q.trim()
                ? "Nobody by that name. A full mobile number opens a new thread."
                : "Nobody yet — search for a name or type a number."}
            </p>
          )}
          {(list ?? []).map((p) => {
            const [bg, fg] = swatch(p.name);
            return (
              <button key={`${p.kind}:${p.id}`} className="rcprow" disabled={busy}
                      onClick={() => open(p)}>
                <span className="av" style={{ background: bg, color: fg }}>
                  {initials(p.name)}
                </span>
                <span className="rcpwho">
                  <span className="rcpname">
                    {p.name}
                    {p.kind === "staff" && <span className="tag staffbadge">STAFF</span>}
                  </span>
                  {p.sub && <span className="rcpsub">{p.sub}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A message to everybody who works here, which is a different thing from a
 *  message to one person and keeps its own dialog. */
function Broadcast({ onClose }: { onClose: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true); setError(null);
    const res = await fetch("/api/broadcast", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "Couldn't send. Try again."); return; }
    onClose();
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Staff broadcast"
         onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Staff broadcast</h3>
        <p>
          Goes to every active employee as an individual text, not a group thread — so
          replies come back as normal conversations anyone can pick up.
        </p>
        <textarea
          rows={3} value={body} onChange={(e) => setBody(e.target.value)} autoFocus
          placeholder="Office closed tomorrow for the holiday. Emergency maintenance line is still live."
        />
        {error && <p className="err">{error}</p>}
        <div className="acts">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" disabled={busy || !body.trim()} onClick={send}>
            {busy ? "Sending…" : "Send to all staff"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Compose(
  { mode, onClose }: { mode: "new" | "broadcast"; onClose: () => void },
) {
  return mode === "broadcast"
    ? <Broadcast onClose={onClose} />
    : <Picker onClose={onClose} />;
}
