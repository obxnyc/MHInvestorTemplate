"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { money0 } from "@/lib/papers";

type Row = {
  id: string; name: string; legal_name: string | null;
  homes: number; owesCents: number; parks: string[];
  /** Where their latest pack stands, or null if none has gone out. */
  papers: "signed" | "opened" | "sent" | "expired" | null;
  papersAt: string | null;
  /** Investor, resident, or one of ours. */
  kind: Kind;
};

/* THREE THINGS WERE SHARING THIS LIST. An investor buys homes from us
   and gets papers. A resident owns their own home and rents the lot it
   stands on -- there is no purchase agreement from us and never was.
   And some of these are our own companies: Hudson Yards owns The Pines.
   Twenty of the fifty-nine names here were one of the last two, every
   one of them listed as an investor. */
type Kind = "investor" | "resident" | "ours";
const KINDS: { key: Kind; tab: string; one: string; empty: string }[] = [
  { key: "investor", tab: "Investors", one: "Investor",
    empty: "No investors on file yet." },
  { key: "resident", tab: "Residents", one: "Resident",
    empty: "Nobody here owns their own home on one of our lots yet." },
  { key: "ours", tab: "Ours", one: "Ours",
    empty: "None of our own companies are listed here yet." },
];

/* Said in the words somebody would use, with the signed one marked so
   it can be found by scanning rather than by reading. The point of this
   line is one question -- have they signed -- and the answer to it must
   not look like the other three. */
const STANDS: Record<string, { say: string; tone: string }> = {
  signed:  { say: "Signed",            tone: "pill ok" },
  opened:  { say: "Opened, not signed", tone: "pill warn" },
  sent:    { say: "Sent, not opened",   tone: "pill gray" },
  expired: { say: "Link expired",       tone: "pill warn" },
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
  /** Whether signing could be read, as opposed to nothing being sent. */
  const [papers, setPapers] = useState(true);
  /** Whether the kinds could be read, as opposed to all being investors. */
  const [kinds, setKinds] = useState(true);
  const [tab, setTab] = useState<Kind>("investor");
  /** Which owner is being moved between the three, and why it failed. */
  const [moving, setMoving] = useState<string | null>(null);
  const [moveSaid, setMoveSaid] = useState<string | null>(null);
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
    setPapers(out.papers !== false);
    setKinds(out.kinds !== false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  /* The tab first, then the text. Searching inside one tab is what
     somebody means by typing a name while looking at a tab. */
  const inTab = useMemo(
    () => (rows ?? []).filter((r) => !kinds || r.kind === tab),
    [rows, kinds, tab]);

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q) return inTab;
    return inTab.filter((r) =>
      r.name.toLowerCase().includes(q)
      || (r.legal_name ?? "").toLowerCase().includes(q)
      || r.parks.some((p) => p.toLowerCase().includes(q)));
  }, [inTab, find]);

  /** How many are in each tab, so the tabs say what is behind them. */
  const tally = useMemo(() => {
    const n: Record<Kind, number> = { investor: 0, resident: 0, ours: 0 };
    for (const r of rows ?? []) n[r.kind] = (n[r.kind] ?? 0) + 1;
    return n;
  }, [rows]);

  /**
   * Move somebody between the three.
   *
   * Changes a label and nothing else -- no sale, no lot, no money, and
   * nothing deleted. The row moves out of the tab you are looking at,
   * which is the whole point, so the list is re-read rather than patched
   * in place.
   */
  const setKind = async (id: string, kind: Kind) => {
    setMoving(id); setMoveSaid(null);
    try {
      const res = await fetch("/api/owners", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, kind }),
      });
      const out = await res.json().catch(() => ({}));
      /* Nothing on screen changes until the server says it took it. */
      if (!res.ok || !out.ok) {
        setMoveSaid(out.error ?? "That did not move."); return;
      }
      await load();
    } catch (e) {
      setMoveSaid(e instanceof Error ? e.message : "That did not move.");
    } finally { setMoving(null); }
  };

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

      {/* WHO IS ON THIS LIST. Three different relationships were sharing
          one screen, and the only one the papers are for is the first. */}
      {kinds && rows.length > 0 && (
        <div className="tabsrow">
          {KINDS.map((k) => (
            <button key={k.key} type="button"
                    className={tab === k.key ? "chip on" : "chip"}
                    onClick={() => setTab(k.key)}>
              {k.tab} <span className="dim">{tally[k.key]}</span>
            </button>
          ))}
        </div>
      )}
      {!kinds && rows.length > 0 && (
        <p className="parkhint">
          Everybody here reads as an investor: sorting them into residents
          and our own companies needs migration 050 run on the database.
        </p>
      )}
      {moveSaid && <p className="err">{moveSaid}</p>}

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
        <p className="parkhint">
          {find.trim()
            ? `Nothing in ${KINDS.find((k) => k.key === tab)?.tab} matches `
              + `“${find.trim()}”.`
            : KINDS.find((k) => k.key === tab)?.empty}
        </p>
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
              {/* WHERE THE PAPERS STAND, on the list rather than only
                  inside. Opening six investors one at a time to find out
                  who has signed is the whole job this list exists to
                  save. `papers` false is the database not answering,
                  which is not the same as nobody having been sent
                  anything -- the same pair as `holdings` above. */}
              {papers && r.papers && (
                <p className="ownerstands">
                  <span className={STANDS[r.papers].tone}>
                    {STANDS[r.papers].say}
                  </span>
                  {r.papersAt && (
                    <span className="dim">
                      {" "}{new Date(r.papersAt).toLocaleDateString("en-US",
                        { dateStyle: "medium" })}
                    </span>
                  )}
                </p>
              )}
              {/* MOVE SOMEBODY WITHOUT ASKING ME. Twenty of these had to
                  be read out one at a time and set by hand, which is the
                  shape of a job that belongs on the screen. It changes a
                  label and nothing else. */}
              {kinds && canAdd && (
                <div className="ownerkind">
                  {KINDS.map((k) => (
                    <button key={k.key} type="button"
                            className={r.kind === k.key ? "chip on" : "chip"}
                            disabled={moving === r.id || r.kind === k.key}
                            onClick={() => void setKind(r.id, k.key)}>
                      {k.one}
                    </button>
                  ))}
                </div>
              )}
              <Link className="btn" href={`/owners/${r.id}`}>
                {r.kind === "investor" ? "Papers" : "Open"}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
