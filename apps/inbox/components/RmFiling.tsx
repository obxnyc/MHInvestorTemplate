"use client";
import { useState } from "react";

type Move = {
  property: number; propertyName: string;
  into: number | null; intoName: string; intoLabel: string;
  outOf: number | null; outOfName: string | null;
  why: string;
};
type Placed = {
  property: number; propertyName: string;
  intoName: string | null; why: string | null; wasIn: string | null;
};
type Found = {
  signedIn: boolean; moves?: Move[]; hint?: string; placed?: Placed[];
  parks?: { label: string; lots: number; runsOn: string | null }[];
};
type Result = { ok?: boolean; placed?: number; removed?: number; error?: string };

/**
 * Lots filed in the wrong place, and where they actually sit.
 *
 * Nothing here is written to Rent Manager. Twelve lots are in no park group
 * over there and one is in the park next door, and the obvious fix -- correct
 * Rent Manager -- is wrong while nobody remembers why they were filed that
 * way. A filing that looks like an oversight is sometimes a decision whose
 * reason has been forgotten.
 *
 * So placement is ours. A row says "whatever Rent Manager thinks, treat this
 * as a lot of that park", it remembers what Rent Manager said at the time,
 * and undoing it falls straight back to their answer. If it later turns out
 * their filing was right, one click and it is.
 *
 * Which park a lot belongs to is decided by its street number against the
 * numbers already in each park, which is the only evidence there is and here
 * is conclusive. It proposes by name, in words, and every one can be
 * unticked.
 */
export default function RmFiling() {
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState<"" | "look" | "place">("");
  const [done, setDone] = useState<Result | null>(null);
  const [sure, setSure] = useState(false);
  const [skip, setSkip] = useState<Set<number>>(new Set());

  async function look() {
    setBusy("look"); setDone(null); setSure(false); setSkip(new Set());
    try {
      setFound(await (await fetch("/api/rentmanager/filing")).json());
    } finally { setBusy(""); }
  }

  async function place() {
    const chosen = (found?.moves ?? []).filter((m) => !skip.has(m.property));
    setBusy("place");
    try {
      const res = await fetch("/api/rentmanager/filing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place: chosen.map((m) => ({
            property: m.property, intoName: m.intoName,
            why: m.why, wasIn: m.outOfName,
          })),
        }),
      });
      setDone(await res.json());
      await look();
    } finally { setBusy(""); setSure(false); }
  }

  async function unplace(ids: number[]) {
    setBusy("place");
    try {
      await fetch("/api/rentmanager/filing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ undo: ids }),
      });
      await look();
    } finally { setBusy(""); }
  }

  const toggle = (id: number) => setSkip((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const moves = (found?.moves ?? []).filter((m) => m.intoName);
  const todo = moves.filter((m) => !skip.has(m.property));

  return (
    <div className="rmmake">
      <div className="acts" style={{ justifyContent: "flex-start" }}>
        <button className="btn" disabled={busy !== ""} onClick={look}>
          {busy === "look" ? "Looking…" : "Find lots in the wrong place"}
        </button>
      </div>

      {found?.hint && <p className="notice">{found.hint}</p>}
      {done?.error && <p className="err">{done.error}</p>}

      {found?.parks && found.parks.length > 0 && (
        <p className="hint">
          {found.parks.map((p) =>
            `${p.label}: ${p.lots} lot${p.lots === 1 ? "" : "s"}`
            + (p.runsOn ? ` on ${p.runsOn}` : " (no common street number)"))
            .join(" · ")}
        </p>
      )}

      {found && moves.length === 0 && !found.hint && (
        <p className="okmsg">Every lot is in the park it is addressed for.</p>
      )}

      {moves.length > 0 && (
        <>
          <ul className="rmpick">
            {moves.map((m) => (
              <li key={m.property}>
                <label>
                  <input type="checkbox" checked={!skip.has(m.property)}
                         onChange={() => toggle(m.property)} />
                  <span>
                    <b>{m.propertyName}</b> → {m.intoLabel}
                    <span className="unames">{m.why}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {sure ? (
            <div className="rmsure">
              <p>
                This records <b>{todo.length}</b> placement
                {todo.length === 1 ? "" : "s"} <b>here only</b>. Rent
                Manager&rsquo;s records are left exactly as they are, and each
                of these can be undone in a click — at which point we fall
                straight back to whatever Rent Manager says.
              </p>
              <div className="acts">
                <button className="btn" autoFocus onClick={() => setSure(false)}>
                  Not yet
                </button>
                <button className="btn pri" disabled={busy !== "" || !todo.length}
                        onClick={place}>
                  {busy === "place" ? "Placing…" : `Place these ${todo.length} here`}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn pri" disabled={!todo.length}
                    onClick={() => setSure(true)}>
              Place {todo.length} here — Rent Manager untouched
            </button>
          )}
        </>
      )}

      {found?.placed && found.placed.length > 0 && (
        <details className="rehodd" open>
          <summary>{found.placed.length} placed here, overriding Rent Manager</summary>
          <ul className="rmpick">
            {found.placed.map((p) => (
              <li key={p.property}>
                <label style={{ cursor: "default" }}>
                  <span>
                    <b>{p.propertyName}</b> → {p.intoName ?? "standing on its own"}
                    <span className="unames">
                      {p.why}{p.wasIn ? ` · Rent Manager had it in ${p.wasIn}` : ""}
                    </span>
                  </span>
                  <button type="button" className="mini" disabled={busy !== ""}
                          style={{ marginLeft: "auto" }}
                          onClick={() => unplace([p.property])}>
                    Undo
                  </button>
                </label>
              </li>
            ))}
          </ul>
          <p className="whosnote">
            Undoing one falls straight back to whatever Rent Manager says about
            it. Nothing here has ever changed their records.
          </p>
        </details>
      )}
    </div>
  );
}
