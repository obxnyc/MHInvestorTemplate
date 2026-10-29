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
  { trades, onClose, onMade, from }:
  {
    trades: { id: string; label: string }[];
    onClose: () => void; onMade: () => void;
    /** Raised out of a conversation rather than from the jobs board.
     *
     *  Prefilled, not auto-created: what somebody texted is the start of a
     *  work order and rarely the whole of it. "The heat's been funny" needs a
     *  lot number and an urgency before anybody can be sent, and the person
     *  reading the thread is the one who knows both. */
    from?: { conversationId: string; summary?: string; detail?: string;
             unitId?: string | null };
  },
) {
  const [units, setUnits] = useState<UnitOption[] | null>(null);
  const [people, setPeople] = useState<{ staff: Person[]; vendors: Person[] } | null>(null);

  const [summary, setSummary] = useState(from?.summary ?? "");
  const [detail, setDetail] = useState(from?.detail ?? "");
  const [unitId, setUnitId] = useState(from?.unitId ?? "");
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

  /** Photos and videos to send along with the job. */
  const [files, setFiles] = useState<File[]>([]);
  /** Said when the job opened but the files did not all follow. */
  const [said, setSaid] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    setSaid(null);

    // "staff:uuid" / "contact:uuid", so one select can offer both without two
    // pieces of state that can disagree with each other.
    const [toKind, toId] = to ? to.split(":") : [null, null];

    const res = await fetch("/api/jobs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary, detail, unitId, tradeId, urgency, dueAt,
                             toKind, toId, conversationId: from?.conversationId }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(out.error ?? "That didn't work.");
      return;
    }

    /* THE EVIDENCE, AFTER THE JOB EXISTS. It has to be this way round --
       the files are stored under the job's id -- and it is why they are
       uploaded here rather than carried in the request above: a video is
       slow and a job is fast, and joining them would leave the button
       doing nothing visible for half a minute. */
    if (files.length && out.id) {
      const body = new FormData();
      for (const f of files) body.append("files", f);
      try {
        const up = await fetch(`/api/jobs/${out.id}/attach`,
          { method: "POST", body });
        const said = await up.json().catch(() => ({}));
        const refused = Array.isArray(said.refused) ? said.refused : [];
        if (refused.length) {
          /* THE JOB IS OPEN EITHER WAY. Closing the form on a half-done
             upload is how somebody finds out next week that the vendor
             never saw the video. */
          setBusy(false);
          setSaid(`The job is open${said.added ? ` with ${said.added} file`
            + `${said.added === 1 ? "" : "s"}` : ""}, but ${refused.length} did`
            + ` not go: ${refused.join("; ")}.`);
          onMade();
          return;
        }
      } catch {
        setBusy(false);
        setSaid("The job is open, but the files did not upload. Add them"
          + " from the job itself.");
        onMade();
        return;
      }
    }

    setBusy(false);
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
        {said && <p className="err">{said}</p>}

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

        <label className="fieldlab" htmlFor="jfiles">
          Photos or video <span className="opt">— what whoever goes will see</span>
        </label>
        <input id="jfiles" type="file" multiple
               accept="image/*,video/*,application/pdf"
               onChange={(e) => {
                 setFiles(Array.from(e.target.files ?? []));
                 setSaid(null);
               }} />
        {files.length > 0 && (
          <p className="hint">
            {files.length} file{files.length === 1 ? "" : "s"}:{" "}
            {files.map((f) => `${f.name} (${Math.round(f.size / 1e6) || "<1"}MB)`)
              .join(", ")}.
            {files.some((f) => f.size > 25e6) && (
              <> A file over 25MB will not go — on a phone, trim the video or
                send it at a lower quality.</>
            )}
          </p>
        )}
        <p className="hint">
          Whoever the job goes to sees these on their own page, before they
          turn up. They stay on the job afterwards.
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
