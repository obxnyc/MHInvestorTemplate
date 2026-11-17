"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { money0 } from "@/lib/papers";

type Row = {
  id: string; name: string; legal_name: string | null; contact_name?: string | null;
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
/* Under the owner's name: the name on the papers when it differs, else the
   person behind an entity (Josh Barron behind The 226 Ocean Trust). */
const smallPrint = (r: { name: string; legal_name: string | null; contact_name?: string | null }) =>
  (r.legal_name?.trim() && r.legal_name.trim() !== r.name ? r.legal_name.trim() : "") || r.contact_name?.trim() || "";

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
      || (r.contact_name ?? "").toLowerCase().includes(q)
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

  const here = KINDS.find((k) => k.key === tab)!;
  const initials = (n: string) => n.replace(/\b(LLC|Inc|Trust|The)\b\.?/gi, "").trim()
    .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "·";

  return (
    <div className="olpage">
      <header className="olhead">
        <div>
          <h1>Investors</h1>
          <p className="olsub">{tally.investor} investor{tally.investor === 1 ? "" : "s"}
            {holdings ? ` · ${(rows ?? []).filter((r) => r.kind === "investor").reduce((a, r) => a + r.homes, 0)} homes` : ""}</p>
        </div>
        {canAdd && (
          <button type="button" className={adding ? "btn" : "btn pri"}
                  onClick={() => { setAdding((v) => !v); setSaid(null); }}>
            {adding ? "Cancel" : "New investor"}
          </button>
        )}
      </header>

      {!configured && <p className="err">Investors need migration 017 run on the database first.</p>}
      {configured && !holdings && (
        <p className="parkhint">Sales could not be read, so homes and monthly figures are not filled in (migration 031).</p>
      )}
      {!kinds && rows.length > 0 && (
        <p className="parkhint">Sorting into residents and our own companies needs migration 050.</p>
      )}

      {adding && (
        <div className="oladd">
          <label>Name<input value={name} autoFocus onChange={(e) => setName(e.target.value)} /></label>
          <label>Legal name, if it differs
            <input value={legal} placeholder="e.g. Oak Ridge Holdings LLC" onChange={(e) => setLegal(e.target.value)} /></label>
          <button type="button" className="btn pri" disabled={saving || name.trim().length < 2} onClick={() => void add()}>
            {saving ? "Saving…" : "Add"}
          </button>
          {said && <span className="err">{said}</span>}
        </div>
      )}

      {rows.length > 0 && (
        <div className="oltools">
          <label className="olsearch">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input value={find} onChange={(e) => setFind(e.target.value)} type="search"
                   placeholder="Search by name, company or park" aria-label="Search investors" />
          </label>
          {kinds && (
            <div className="olseg" role="tablist">
              {KINDS.map((k) => (
                <button key={k.key} type="button" role="tab" aria-selected={tab === k.key}
                        className={tab === k.key ? "on" : ""} onClick={() => setTab(k.key)}>
                  {k.tab}<span>{tally[k.key]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {moveSaid && <p className="err">{moveSaid}</p>}

      {!rows.length ? (
        <p className="olempty">No investors on file yet.{canAdd ? " Add the first one above." : ""}</p>
      ) : !shown.length ? (
        <p className="olempty">{find.trim() ? `Nothing in ${here.tab} matches “${find.trim()}”.` : here.empty}</p>
      ) : (
        <ul className="ollist">
          {shown.map((r) => (
            <li key={r.id} className="olrow">
              <Link href={`/owners/${r.id}`} className="olmain">
                <span className="olav" aria-hidden="true">{initials(r.name)}</span>
                <span className="olwho">
                  <strong>{r.name}</strong>
                  {[smallPrint(r), r.parks.join(", ")].some(Boolean)
                    ? <small>{[smallPrint(r), r.parks.join(", ")].filter(Boolean).join(" · ")}</small> : null}
                </span>
                <span className="olnum">
                  {!holdings ? <small>—</small> : r.homes === 0 ? <small>No homes</small> : (
                    <>
                      <strong>{r.homes} home{r.homes === 1 ? "" : "s"}</strong>
                      {r.owesCents > 0 ? <small>${money0(r.owesCents / 100)}/mo</small> : null}
                    </>
                  )}
                </span>
                <span className="olpapers">
                  {/* Have they signed: the one question this column answers. */}
                  {papers && r.papers ? <span className={STANDS[r.papers].tone}>{STANDS[r.papers].say}</span> : null}
                </span>
                <svg className="olgo" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              {/* Moving somebody between investor, resident and ours changes
                  a label and nothing else -- tucked away, since it is rare. */}
              {kinds && canAdd && (
                <select className="olkind" aria-label={`${r.name} is`} value={r.kind} disabled={moving === r.id}
                        onChange={(e) => void setKind(r.id, e.target.value as Kind)}>
                  {KINDS.map((k) => <option key={k.key} value={k.key}>{k.one}</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
