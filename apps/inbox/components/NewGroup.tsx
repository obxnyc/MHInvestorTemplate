"use client";
import { useEffect, useState } from "react";

type Person = { id: string; full_name: string; role: string };

/**
 * A working group.
 *
 * Small, formed around a job, made by whoever needs it. Not administered: a
 * group that needs an admin to create is a group that gets replaced by a text
 * thread on four personal phones, which is the thing this whole system exists
 * to pull back in.
 */
export default function NewGroup({ onClose }: { onClose: () => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/team").then((r) => r.json())
      .then((d) => setPeople(d.colleagues ?? [])).catch(() => setPeople([]));
  }, []);

  async function create() {
    if (!picked.length) { setError("Pick at least one person."); return; }
    setBusy(true); setError(null);
    const res = await fetch("/api/team", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        picked.length === 1 && !title.trim()
          // One person and no name is a plain conversation, not a group -- and
          // going through the group path would make a second thread beside the
          // one you already have with them.
          ? { staffId: picked[0] }
          : { staffIds: picked, title }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !out.id) { setError(out.error ?? "That didn't work."); return; }
    location.assign(`/team?t=${out.id}`);
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="New group"
         onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>New group</h3>
        <p>Stays inside the office. Nothing here is ever sent to a tenant.</p>

        {error && <p className="err">{error}</p>}

        <label className="fieldlab" htmlFor="gt">
          Name it <span className="opt">— optional, but it helps later</span>
        </label>
        <input id="gt" value={title} onChange={(e) => setTitle(e.target.value)}
               placeholder="e.g. Oak Grove turns" />

        <p className="fieldlab">Who&rsquo;s in</p>
        {!people && <p className="pinmuted pad">Loading…</p>}
        <div className="chipset">
          {(people ?? []).map((p) => (
            <button key={p.id} type="button"
                    className={`chip${picked.includes(p.id) ? " on" : ""}`}
                    aria-pressed={picked.includes(p.id)}
                    onClick={() => setPicked(
                      picked.includes(p.id)
                        ? picked.filter((x) => x !== p.id)
                        : [...picked, p.id])}>
              {p.full_name}
            </button>
          ))}
          {people && !people.length && (
            <span className="pinmuted">Nobody else is set up yet.</span>
          )}
        </div>

        <div className="acts">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn pri" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
