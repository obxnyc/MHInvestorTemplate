"use client";
import { useState } from "react";

export type Owner = { id: string; name: string };

/**
 * Which LLC holds this property, and a way to add one without leaving.
 *
 * The list starts empty, which is the whole problem with putting it behind a
 * settings screen somewhere: the moment anybody needs an LLC is the moment
 * they are halfway through adding a property, and a dropdown with nothing in
 * it and no way to fill it is a dead end. So the last option in the list makes
 * one.
 *
 * Adding is admin and office only, same as adding a property -- anyone else
 * gets the list and no new-owner option, because the refusal would come back
 * from the server anyway and a button that always fails is worse than no
 * button.
 */
export default function OwnerPicker(
  { id, value, owners, ready, canAdd, onChange, onAdded }:
  {
    id: string;
    value: string;
    owners: Owner[];
    /** False when migration 017 has not been run and there is no table yet. */
    ready: boolean;
    canAdd: boolean;
    onChange: (ownerId: string) => void;
    onAdded: (o: Owner) => void;
  },
) {
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [legal, setLegal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null);
    const res = await fetch("/api/owners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, legalName: legal }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(out.error ?? "That didn't save."); return; }
    onAdded({ id: String(out.id), name: String(out.name) });
    onChange(String(out.id));
    setMaking(false); setName(""); setLegal("");
  }

  return (
    <>
      <label className="fieldlab" htmlFor={id}>
        Owner <span className="opt">— which LLC holds it</span>
      </label>
      <select id={id} value={making ? "__new" : value}
              onChange={(e) => {
                if (e.target.value === "__new") { setMaking(true); return; }
                setMaking(false);
                onChange(e.target.value);
              }}>
        <option value="">Not set</option>
        {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        {canAdd && ready && <option value="__new">＋ Add an LLC…</option>}
      </select>

      {!ready && (
        <p className="hint">
          Owners need migration 017 run on the database before an LLC can be
          added or chosen.
        </p>
      )}

      {ready && canAdd && !owners.length && !making && (
        <p className="hint">
          No LLCs yet. Choose <strong>Add an LLC…</strong> above to make the
          first one.
        </p>
      )}

      {making && (
        /* Not a modal. This opens from inside a form that is itself often in a
           dialog, and a dialog over a dialog is how people lose what they had
           typed. */
        <div className="ownernew">
          <label className="fieldlab" htmlFor={`${id}n`}>
            What you call it
          </label>
          <input id={`${id}n`} value={name} autoFocus
                 placeholder="Larabee Holdings II"
                 onChange={(e) => setName(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === "Enter") { e.preventDefault(); if (name.trim().length > 1) save(); }
                 }} />

          <label className="fieldlab" htmlFor={`${id}l`}>
            Legal name <span className="opt">— if a lease or a cheque says something else</span>
          </label>
          <input id={`${id}l`} value={legal}
                 placeholder="Larabee Holdings II, LLC"
                 onChange={(e) => setLegal(e.target.value)} />

          {err && <p className="err">{err}</p>}

          <div className="acts">
            <button type="button" className="btn"
                    onClick={() => { setMaking(false); setErr(null); }}>
              Cancel
            </button>
            <button type="button" className="btn pri"
                    disabled={busy || name.trim().length < 2} onClick={save}>
              {busy ? "Saving…" : "Save this LLC"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
