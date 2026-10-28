"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { money0 } from "@/lib/papers";

type Row = {
  id: string; name: string; legal_name: string | null;
  homes: number; owesCents: number; parks: string[];
};

/**
 * The list of investors, and the way in to a set of sale papers.
 *
 * Two things are deliberately separate here. `configured` says whether
 * the owners table could be read at all; `holdings` says whether the
 * sales could. Without the second, every investor would be drawn as
 * holding nothing -- which is a sentence about the database written as
 * though it were a fact about the business.
 */
export default function OwnersBoard({ canAdd }: { canAdd: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [holdings, setHoldings] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [find, setFind] = useState("");

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [legal, setLegal] = useState("");
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/owners", { cache: "no-store" });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setError(out.error ?? "Could not read the investors."); return; }
    setRows(out.owners ?? []);
    setConfigured(out.configured !== false);
    setHoldings(out.holdings !== false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q || !rows) return rows ?? [];
    return rows.filter((r) =>
      r.name.toLowerCase().includes(q)
      || (r.legal_name ?? "").toLowerCase().includes(q)
      || r.parks.some((p) => p.toLowerCase().includes(q)));
  }, [rows, find]);

  /** Nothing is cleared until the server says it took it. */
  const add = async () => {
    setSaving(true); setSaid(null);
    const res = await fetch("/api/owners", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, legalName: legal }),
    });
    const out = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok || !out.ok) { setSaid(out.error ?? "That did not save."); return; }
    setName(""); setLegal(""); setAdding(false);
    await load();
  };

  if (error) return <p className="err">{error}</p>;
  if (!rows) return <p className="parkhint">Reading…</p>;

  return (
    <div className="parkpage">
      <header className="parkhead">
        <h1>Investors</h1>
        <div className="parkacts">
          {canAdd && (
            <button type="button" className={adding ? "btn pri" : "btn"}
                    onClick={() => { setAdding((v) => !v); setSaid(null); }}>
              {adding ? "Never mind" : "New investor"}
            </button>
          )}
        </div>
      </header>

      <p className="parkhint">
        Open one to see every home they hold, what they are charged each
        month, and to draw the purchase agreement and park land lease for a
        sale. Homes can be typed in by hand there, so the papers do not wait
        on the sale being recorded.
      </p>

      {!configured && (
        <p className="err">
          Investors need migration 017 run on the database first.
        </p>
      )}
      {configured && !holdings && (
        <p className="parkhint">
          Sales could not be read, so the homes and monthly figures below are
          not filled in. That is migration 031.
        </p>
      )}

      {adding && (
        <div className="papersetup">
          <div className="papergrid">
            <label>Name as you say it
              <input value={name} autoFocus
                     onChange={(e) => setName(e.target.value)} /></label>
            <label>Legal name, if it differs
              <input value={legal} placeholder="e.g. Oak Ridge Holdings LLC"
                     onChange={(e) => setLegal(e.target.value)} /></label>
          </div>
          <div className="paperacts">
            <button type="button" className="btn pri" disabled={saving || name.trim().length < 2}
                    onClick={() => void add()}>
              {saving ? "Saving…" : "Add investor"}
            </button>
            {said && <span className="err">{said}</span>}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="papersetup">
          <label className="findrow">Find
            <input value={find} onChange={(e) => setFind(e.target.value)}
                   placeholder="name, company or park" />
          </label>
        </div>
      )}

      {!rows.length ? (
        <p className="parkhint">
          No investors on file yet.{canAdd ? " Add the first one above." : ""}
        </p>
      ) : !shown.length ? (
        <p className="parkhint">Nothing here matches “{find.trim()}”.</p>
      ) : (
        <div className="ownercards">
          {shown.map((r) => (
            <div className="ownercard" key={r.id}>
              <Link href={`/owners/${r.id}`} className="ownername">{r.name}</Link>
              {r.legal_name && r.legal_name !== r.name && (
                <span className="dim">{r.legal_name}</span>
              )}
              <p className="ownerheld">
                {!holdings ? (
                  <span className="dim">holdings not read</span>
                ) : r.homes === 0 ? (
                  <span className="dim">no homes recorded</span>
                ) : (
                  <>
                    <strong>{r.homes} home{r.homes === 1 ? "" : "s"}</strong>
                    {r.parks.length > 0 && <> · {r.parks.join(", ")}</>}
                    {r.owesCents > 0 && (
                      <><br />${money0(r.owesCents / 100)} a month</>
                    )}
                  </>
                )}
              </p>
              <Link className="btn" href={`/owners/${r.id}`}>Papers</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
