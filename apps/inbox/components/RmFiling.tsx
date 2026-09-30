"use client";
import { useState } from "react";

type Move = {
  property: number; propertyName: string;
  into: number | null; intoName: string; intoLabel: string;
  outOf: number | null; outOfName: string | null;
  why: string;
};
type Found = { signedIn: boolean; moves?: Move[]; hint?: string;
               parks?: { label: string; lots: number; runsOn: string | null }[] };
type Result = {
  dryRun: boolean;
  results: { groupId: number; name?: string | null; ok: boolean; already?: boolean;
             was?: number; now?: number | null; expected?: number; reason?: string;
             tried?: { shape: string; status: number; body: string }[] }[];
};

/**
 * Lots filed in the wrong place, and a button that files them right.
 *
 * The twelve orphans and the one stray are a five-minute job in Rent
 * Manager's own group editor, once. The reason this exists is that it is not
 * once: 1140 is filling up, Pamalee is being built, and a lot added over
 * there with nobody remembering to put it in a group is the normal case
 * rather than the exception. This finds them every time and fixes them in a
 * click.
 *
 * It proposes by name, in words, before it writes anything, because the
 * evidence is a street number and a street number can be wrong.
 */
export default function RmFiling() {
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState<"" | "look" | "fix">("");
  const [done, setDone] = useState<Result | null>(null);
  const [sure, setSure] = useState(false);
  const [skip, setSkip] = useState<Set<number>>(new Set());

  async function look() {
    setBusy("look"); setDone(null); setSure(false); setSkip(new Set());
    try {
      setFound(await (await fetch("/api/rentmanager/filing")).json());
    } finally { setBusy(""); }
  }

  async function fix(go: boolean) {
    const moves = (found?.moves ?? []).filter((m) => !skip.has(m.property) && m.into);
    // Grouped per destination, because the write replaces a group's member
    // list and doing that once per lot would be nine writes to one group.
    const byGroup = new Map<number, { add: number[]; remove: number[] }>();
    for (const m of moves) {
      const into = byGroup.get(m.into!) ?? { add: [], remove: [] };
      into.add.push(m.property);
      byGroup.set(m.into!, into);
      if (m.outOf) {
        const out = byGroup.get(m.outOf) ?? { add: [], remove: [] };
        out.remove.push(m.property);
        byGroup.set(m.outOf, out);
      }
    }
    setBusy("fix");
    try {
      const res = await fetch("/api/rentmanager/groups/members", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          go,
          moves: [...byGroup.entries()].map(([groupId, m]) => ({ groupId, ...m })),
        }),
      });
      setDone(await res.json());
      if (go) await look();
    } finally { setBusy(""); setSure(false); }
  }

  const moves = (found?.moves ?? []).filter((m) => m.into);
  const todo = moves.filter((m) => !skip.has(m.property));

  return (
    <div className="rmmake">
      <div className="acts" style={{ justifyContent: "flex-start" }}>
        <button className="btn" disabled={busy !== ""} onClick={look}>
          {busy === "look" ? "Looking…" : "Find lots in the wrong place"}
        </button>
      </div>

      {found?.hint && <p className="notice">{found.hint}</p>}

      {found?.parks && found.parks.length > 0 && (
        <p className="hint">
          {found.parks.map((p) =>
            `${p.label}: ${p.lots} lot${p.lots === 1 ? "" : "s"}`
            + (p.runsOn ? ` on ${p.runsOn}` : " (no common street number)")).join(" · ")}
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
                         onChange={() => setSkip((s) => {
                           const next = new Set(s);
                           if (next.has(m.property)) next.delete(m.property);
                           else next.add(m.property);
                           return next;
                         })} />
                  <span>
                    <b>{m.propertyName}</b> → {m.intoLabel}
                    <span className="unames">{m.why}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {!done && (sure ? (
            <div className="rmsure">
              <p>
                This writes to Rent Manager. It moves <b>{todo.length}</b>{" "}
                propert{todo.length === 1 ? "y" : "ies"} between groups and changes
                nothing else about them — no addresses, no owners, no rent. Each
                group is read first and written back with its existing members
                plus these, so nothing already in a group is lost.
              </p>
              <div className="acts">
                <button className="btn" autoFocus onClick={() => setSure(false)}>
                  Not yet
                </button>
                <button className="btn danger" disabled={busy !== "" || !todo.length}
                        onClick={() => fix(true)}>
                  {busy === "fix" ? "Filing…" : `File these ${todo.length}`}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn pri" disabled={!todo.length}
                    onClick={() => setSure(true)}>
              File {todo.length} in Rent Manager
            </button>
          ))}
        </>
      )}

      {done && (
        <div className="rmresult">
          <ul className="rmlist">
            {done.results.map((r) => (
              <li key={r.groupId} className={r.ok ? "ok" : "no"}>
                <span className="rmpath">{r.name ?? `Group ${r.groupId}`}</span>
                <span className="rmstatus">
                  {r.already ? "already right"
                    : r.ok ? `${r.was} → ${r.now}`
                    : "refused"}
                </span>
                {r.reason && <span className="rmwhy">{r.reason}</span>}
                {r.tried && r.tried.length > 0 && !r.ok && (
                  <details className="rmshape">
                    <summary>what Rent Manager said</summary>
                    {r.tried.map((t, i) => (
                      <p key={i}><strong>{t.shape}</strong> — HTTP {t.status} {t.body}</p>
                    ))}
                  </details>
                )}
              </li>
            ))}
          </ul>
          <p className="whosnote">
            Each group was read again afterwards. The numbers above are what it
            actually holds now, not what the call claimed.
          </p>
        </div>
      )}
    </div>
  );
}
