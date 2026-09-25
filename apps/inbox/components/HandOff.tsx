"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Person = { id: string; name: string; sub: string };
type Mode = "forward" | "job";

/**
 * Hand a message to someone who can act on it.
 *
 * What this replaces is a screenshot. A tenant texts that a sink is leaking and
 * somebody photographs their own phone and sends it to the plumber -- which
 * works, and loses everything: it lives in one person's messages, nobody else
 * knows the plumber was called, and there is no record when the tenant asks a
 * week later.
 *
 * The work-order box is off by default, and that is the whole design. You text
 * a plumber to ask whether a dead water heater is his or the electrician's, and
 * at most one of those two conversations turns into work. A job created at the
 * moment of asking would be wrong often enough that people would stop opening
 * them at all.
 */
export default function HandOff(
  { messageId, preview, defaultMode = "forward", onClose }:
  { messageId: string; preview: string; defaultMode?: Mode; onClose: () => void },
) {
  const router = useRouter();
  const [, start] = useTransition();
  const [mode] = useState<Mode>(defaultMode);
  const [people, setPeople] = useState<{ staff: Person[]; vendors: Person[] } | null>(null);
  const [q, setQ] = useState("");
  const [to, setTo] = useState<{ kind: "staff" | "contact"; id: string; name: string } | null>(null);
  const [note, setNote] = useState("");
  const [job, setJob] = useState(mode === "job");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/recipients")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then(setPeople)
      .catch(() => setError("Could not load the list of people."));
  }, []);

  const match = (p: Person) =>
    !q.trim() || `${p.name} ${p.sub}`.toLowerCase().includes(q.trim().toLowerCase());

  async function submit() {
    // A job can exist with nobody on it yet; a forward cannot.
    if (mode === "forward" && !to) { setError("Pick someone first."); return; }
    setBusy(true); setError(null);

    const url = mode === "forward"
      ? `/api/messages/${messageId}/forward`
      : `/api/messages/${messageId}/work-order`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toKind: to?.kind ?? null,
        toId: to?.id ?? null,
        note: note.trim() || null,
        // Typed as local time; sent as an instant, because "due Tuesday 9am"
        // means 9am here, and a naive string would drift by the server's zone.
        dueAt: job && dueAt ? new Date(dueAt).toISOString() : null,
        ...(mode === "forward" ? { workOrder: job } : {}),
      }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) { setError(out.error ?? "That didn't go through."); return; }
    // A partial success -- sent but no job, or job but not texted -- is shown
    // rather than swallowed, because the half that failed is the half someone
    // has to do by hand.
    if (out.error) { setError(out.error); start(() => router.refresh()); return; }
    onClose();
    start(() => router.refresh());
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={
      mode === "forward" ? "Forward this message" : "Open a work order"
    } onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{mode === "forward" ? "Forward this message" : "Open a work order"}</h3>
        <blockquote className="quoted">{preview}</blockquote>

        {error && <p className="err">{error}</p>}

        <label className="fieldlab" htmlFor="ho-who">
          {mode === "forward" ? "Send it to" : "Give it to"}
          {mode === "job" && <span className="opt"> — optional</span>}
        </label>
        <input id="ho-who" className="pinsearch" value={to ? to.name : q}
               placeholder="Search staff or trades…"
               onChange={(e) => { setQ(e.target.value); setTo(null); }} />

        {!to && (
          <div className="pickwrap">
            {!people && <p className="pinmuted pad">Loading…</p>}
            {people && (
              <>
                <Group label="Trades" people={people.vendors.filter(match)}
                       onPick={(p) => setTo({ kind: "contact", id: p.id, name: p.name })} />
                <Group label="Staff" people={people.staff.filter(match)}
                       onPick={(p) => setTo({ kind: "staff", id: p.id, name: p.name })} />
                {!people.vendors.filter(match).length && !people.staff.filter(match).length && (
                  <p className="pinmuted pad">Nobody matches that.</p>
                )}
              </>
            )}
          </div>
        )}

        <label className="fieldlab" htmlFor="ho-note">Add a note <span className="opt">— optional</span></label>
        <textarea id="ho-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything they need to know" />

        {mode === "forward" && (
          <label className="check">
            <input type="checkbox" checked={job} onChange={(e) => setJob(e.target.checked)} />
            <span>
              Also open a work order
              <small>Leave this off if you are only asking a question.</small>
            </span>
          </label>
        )}

        {job && (
          <>
            <label className="fieldlab" htmlFor="ho-due">
              Promised by <span className="opt">— optional</span>
            </label>
            <input id="ho-due" type="datetime-local" value={dueAt}
                   onChange={(e) => setDueAt(e.target.value)} />
          </>
        )}

        <div className="acts">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn pri" onClick={submit} disabled={busy}>
            {busy ? "Sending…" : mode === "forward" ? "Forward" : "Open job"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Group(
  { label, people, onPick }:
  { label: string; people: Person[]; onPick: (p: Person) => void },
) {
  if (!people.length) return null;
  return (
    <>
      <p className="picklab">{label}</p>
      <ul className="pinpeople">
        {people.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p)}>
              <span>{p.name}</span>
              <span className="picksub">{p.sub}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
