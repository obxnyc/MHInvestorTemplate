"use client";
import { useEffect, useState } from "react";

type Person = { id: string; name: string; sub: string };
type UnitOption = { id: string; label: string };

/**
 * A job you noticed yourself.
 *
 * Everything here has been born from a tenant's text, which covers the common
 * case and misses the one where you walked the park and saw it. A gutter, a
 * turn to schedule, a unit to make ready -- those were arriving as a note to
 * self or not at all.
 *
 * The address is required and the trade is not. Which property it is at
 * decides who can be sent and what gets billed where, and a job nobody can be
 * sent to is a note that will sit in the list being counted as work. The
 * trade is a label for the price history, and guessing it wrong poisons the
 * average it exists to produce -- so it is left blank until somebody knows.
 */
export default function NewJob(
  { trades, onClose, onMade }:
  { trades: { id: string; label: string }[]; onClose: () => void; onMade: () => void },
) {
  const [units, setUnits] = useState<UnitOption[] | null>(null);
  const [people, setPeople] = useState<{ staff: Person[]; vendors: Person[] } | null>(null);

  const [summary, setSummary] = useState("");
  const [detail, setDetail] = useState("");
  const [unitId, setUnitId] = useState("");
  const [tradeId, setTradeId] = useState("");
  const [urgency, setUrgency] = useState("3");
  const [dueAt, setDueAt] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/units").then((r) => r.json())
      .then((d) => setUnits(d.units ?? [])).catch(() => setUnits([]));
    fetch("/api/recipients").then((r) => r.json())
      .then((d) => setPeople({ staff: d.staff ?? [], vendors: d.vendors ?? [] }))
      .catch(() => setPeople({ staff: [], vendors: [] }));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);

    // "staff:uuid" / "contact:uuid", so one select can offer both without two
    // pieces of state that can disagree with each other.
    const [toKind, toId] = to ? to.split(":") : [null, null];

    const res = await fetch("/api/jobs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary, detail, unitId, tradeId, urgency, dueAt, toKind, toId }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(out.error ?? "That didn't work."); return; }
    onMade();
    onClose();
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="New job"
         onClick={onClose}>
      <form className="sheet wide" onClick={(e) => e.stopPropagation()} onSubmit={create}>
        <h3>New job</h3>
        <p>
          For something you noticed yourself. It lands in the same list as a job
          raised from a tenant&rsquo;s message and closes the same way.
        </p>

        {error && <p className="err">{error}</p>}

        <label className="fieldlab" htmlFor="js">What needs doing</label>
        <input id="js" value={summary} required autoFocus
               onChange={(e) => setSummary(e.target.value)}
               placeholder="Gutter hanging off the back of the house" />

        <label className="fieldlab" htmlFor="jw">Where</label>
        <select id="jw" value={unitId} required onChange={(e) => setUnitId(e.target.value)}>
          <option value="">Pick a property…</option>
          {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
        {units?.length === 0 && (
          <p className="hint">
            No properties on file yet — add one under Properties first.
          </p>
        )}

        <label className="fieldlab" htmlFor="jd">
          Anything else <span className="opt">— optional</span>
        </label>
        <textarea id="jd" rows={2} value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Back left corner, above the kitchen window." />

        <div className="jobrow">
          <label className="fieldlab" htmlFor="ju">
            How urgent
            <select id="ju" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              <option value="1">Emergency — today</option>
              <option value="2">Urgent — this week</option>
              <option value="3">Normal</option>
              <option value="4">When convenient</option>
              <option value="5">Whenever</option>
            </select>
          </label>

          <label className="fieldlab" htmlFor="jt">
            Trade <span className="opt">— for the price history</span>
            <select id="jt" value={tradeId} onChange={(e) => setTradeId(e.target.value)}>
              <option value="">Not sure yet</option>
              {trades.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
        </div>

        <label className="fieldlab" htmlFor="jdue">
          Wanted by <span className="opt">— optional</span>
        </label>
        <input id="jdue" type="date" value={dueAt}
               onChange={(e) => setDueAt(e.target.value)} />

        <label className="fieldlab" htmlFor="jto">
          Give it to <span className="opt">— or leave it for anyone to pick up</span>
        </label>
        <select id="jto" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Nobody yet</option>
          {people?.staff.length ? (
            <optgroup label="Field staff">
              {people.staff.map((p) => (
                <option key={p.id} value={`staff:${p.id}`}>{p.name}</option>
              ))}
            </optgroup>
          ) : null}
          {people?.vendors.length ? (
            <optgroup label="Trades">
              {people.vendors.map((p) => (
                <option key={p.id} value={`contact:${p.id}`}>{p.name}</option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <p className="hint">
          Assigning it here does not text anybody. A trade is sent their link
          when the job is dispatched from the board, so you can write it down
          now and decide who goes later.
        </p>

        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn pri"
                  disabled={busy || summary.trim().length < 3 || !unitId}>
            {busy ? "Opening…" : "Open the job"}
          </button>
        </div>
      </form>
    </div>
  );
}
