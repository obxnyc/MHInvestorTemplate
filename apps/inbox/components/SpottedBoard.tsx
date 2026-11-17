"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SPOT_KINDS, SPOT_STAGES, SPOT_TAGS } from "@/lib/scout";
import { STAGE_COLOR } from "./ParkLeadsMap";

const ParkLeadsMap = dynamic(() => import("./ParkLeadsMap"), { ssr: false });

/**
 * Everything the scouts have spotted, for the office to work.
 *
 * The newest first, because a sighting is freshest the day it is made --
 * the owner of a park with a new "for sale" sign is being called by
 * somebody else by Friday.
 */

type Spot = {
  id: string; by: string; lat: number; lon: number; accuracy_m: number | null; kind: string; tags: string[];
  note: string | null; photos: string[]; lookup: string; owner_name: string | null; mail_address: string | null;
  site_address: string | null; county: string | null; parcel_no: string | null; acres: number | null; assessed: number | null;
  stage: string; office_note: string | null; created_at: string; staff?: { full_name: string } | null;
};

const KIND = Object.fromEntries(SPOT_KINDS);
const TAG = Object.fromEntries(SPOT_TAGS);
const STAGE = Object.fromEntries(SPOT_STAGES);
const money = (n: number | null) => (n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);
const titleCase = (t: string | null) => t == null ? null :
  t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Llc|Lp|Inc|Mhp|Mhc|Ii|Iii|Nc|Po)\b/g, (w) => w.toUpperCase());
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function SpottedBoard() {
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [kind, setKind] = useState("");

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/scout", { cache: "no-store" });
      const t = await r.text();
      let j: Record<string, unknown> = {};
      try { j = JSON.parse(t); } catch { setErr(`The server answered ${r.status}.`); return; }
      if (!r.ok) { setErr(String(j.error)); return; }
      setSpots(j.spots as Spot[]); setUrls(j.urls as Record<string, string>);
    })().catch((e) => setErr(String(e)));
  }, []);

  const list = useMemo(() => (spots ?? []).filter((s) => (!stage || s.stage === stage) && (!kind || s.kind === kind)), [spots, stage, kind]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const s of spots ?? []) if (!kind || s.kind === kind) c[s.stage] = (c[s.stage] ?? 0) + 1; return c; }, [spots, kind]);
  const dots = useMemo(() => list.map((s) => ({ key: s.id, lat: s.lat, lon: s.lon, stage: s.stage === "pass" ? "dead" : s.stage, starred: false })), [list]);
  const current = sel ? spots?.find((s) => s.id === sel) ?? null : null;
  const put = (s: Spot) => setSpots((all) => (all ?? []).map((x) => (x.id === s.id ? { ...x, ...s } : x)));

  if (err) return <div className="pk-shell"><p className="pk-err">{err}</p></div>;

  return (
    <div className="pk-shell">
      <header className="pk-head">
        <div className="pk-title">
          <h1>Spotted</h1>
          <p>{spots ? `${list.length} ${list.length === 1 ? "property" : "properties"} logged from the road` : "Loading…"}</p>
        </div>
        <select id="sp-kind" className="pk-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">Every kind</option>{SPOT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <Link className="pk-export" href="/scout">Spot one yourself</Link>
      </header>

      <div className="pk-stages" role="group" aria-label="Stage">
        <button className={!stage ? "on" : ""} onClick={() => setStage(null)}><span>All</span><b>{(spots ?? []).filter((s) => !kind || s.kind === kind).length}</b></button>
        {SPOT_STAGES.map(([k, l]) => (
          <button key={k} className={stage === k ? "on" : ""} onClick={() => setStage(stage === k ? null : k)}>
            <i style={{ background: STAGE_COLOR[k === "pass" ? "dead" : k] }} /><span>{l}</span><b>{counts[k] ?? 0}</b>
          </button>
        ))}
      </div>

      <div className="pk-body">
        <ul className="pk-list" aria-label="Sightings">
          {!spots ? Array.from({ length: 5 }, (_, i) => <li key={i} className="pk-row pk-ghost" />) : null}
          {spots && !spots.length ? (
            <li className="pk-none">Nothing spotted yet. Scouts log properties at <b>Spot</b> in the menu, from their phone.</li>
          ) : null}
          {list.map((s) => (
            <li key={s.id}>
              <button className={`pk-row sp-row${sel === s.id ? " on" : ""}`} onClick={() => setSel(s.id)}>
                {s.photos[0] && urls[s.photos[0]] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="sp-thumb" src={urls[s.photos[0]]} alt="" />
                ) : <span className="sp-thumb sc-noimg" />}
                <span className="pk-main">
                  <span className="pk-name">{titleCase(s.owner_name) ?? (s.lookup === "outside" ? "Outside NC: look up by hand" : "Owner unknown")}</span>
                  <span className="pk-sub">{titleCase(s.site_address) ?? `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`}</span>
                  <span className="pk-meta">{KIND[s.kind]} · {s.staff?.full_name ?? "a scout"} · {when(s.created_at)}{s.photos.length ? ` · ${s.photos.length} 📷` : ""}</span>
                </span>
                <span className="pk-right">
                  <span className="pk-stage" style={{ color: STAGE_COLOR[s.stage === "pass" ? "dead" : s.stage] }}>{STAGE[s.stage]}</span>
                  <span className="pk-when">{s.tags.slice(0, 2).map((t) => TAG[t]).join(", ")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="pk-mapwrap">
          <ParkLeadsMap dots={dots} selected={sel} onSelect={setSel} frameKey="spots" />
          {current ? <SpotPanel key={current.id} s={current} urls={urls} onClose={() => setSel(null)} onSaved={put} /> : null}
        </div>
      </div>
    </div>
  );
}

function SpotPanel({ s, urls, onClose, onSaved }: { s: Spot; urls: Record<string, string>; onClose: () => void; onSaved: (s: Spot) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState(s.office_note ?? "");
  const [big, setBig] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, what: string) {
    setBusy(what); setErr(null);
    const r = await fetch("/api/scout", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: s.id, ...body }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setErr(j.error ?? `Not saved: the server answered ${r.status}.`); return; }
    onSaved(j.spot as Spot);
  }
  const maps = `https://www.google.com/maps/@?api=1&map_action=map&center=${s.lat},${s.lon}&zoom=19&basemap=satellite`;
  const street = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lon}`;

  return (
    <aside className="pk-panel" aria-label="Sighting">
      <div className="pk-panelhead">
        <div><h2>{titleCase(s.owner_name) ?? "Owner unknown"}</h2><p className="pk-o2">{titleCase(s.site_address) ?? `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`}</p></div>
        <button className="pk-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="pk-panelbody">
        {s.photos.length ? (
          <div className="sp-photos">
            {s.photos.map((p) => urls[p] ? (
              <button key={p} onClick={() => setBig(urls[p])} aria-label="Open photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={urls[p]} alt="" />
              </button>
            ) : null)}
          </div>
        ) : null}
        {big ? (
          <button className="sp-big" onClick={() => setBig(null)} aria-label="Close photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={big} alt="" />
          </button>
        ) : null}

        <p className="sp-who">{KIND[s.kind]} · spotted by {s.staff?.full_name ?? "a scout"} · {when(s.created_at)}{s.accuracy_m ? ` · within ${Math.round(s.accuracy_m)} m` : ""}</p>
        {s.tags.length ? <div className="sp-tags">{s.tags.map((t) => <span key={t}>{TAG[t] ?? t}</span>)}</div> : null}
        {s.note ? <p className="sp-note">&ldquo;{s.note}&rdquo;</p> : null}

        <section><h3>Owner</h3>
          {s.lookup === "found" ? (
            <div className="pk-stats">
              <div><b>{s.acres ?? "—"}</b><span>acres</span></div>
              <div><b>{money(s.assessed)}</b><span>assessed</span></div>
              <div><b>{s.county ?? "—"}</b><span>county</span></div>
              <div><b>{s.parcel_no ?? "—"}</b><span>parcel</span></div>
            </div>
          ) : (
            <p className="pk-faint">{s.lookup === "outside" ? "Outside North Carolina: the county lookup does not reach it."
              : s.lookup === "none" ? "The county has no parcel exactly there. The phone may have been standing in the road."
              : "The county did not answer when this was logged."}</p>
          )}
          {s.mail_address ? <p className="pk-mail"><span>Mails to {s.mail_address}</span></p> : null}
          {s.lookup !== "found" ? <button className="pk-ghostbtn" disabled={busy === "look"} onClick={() => patch({ relookup: true }, "look")}>{busy === "look" ? "Asking the county…" : "Ask the county again"}</button> : null}
          <p className="sp-links"><a href={maps} target="_blank" rel="noreferrer">Satellite ↗</a> <a href={street} target="_blank" rel="noreferrer">Street view ↗</a></p>
        </section>

        <section><h3>Stage</h3>
          <div className="pk-stagepick">
            {SPOT_STAGES.map(([k, l]) => (
              <button key={k} className={s.stage === k ? "on" : ""} disabled={busy === "stage"}
                style={s.stage === k ? { background: STAGE_COLOR[k === "pass" ? "dead" : k], borderColor: STAGE_COLOR[k === "pass" ? "dead" : k] } : undefined}
                onClick={() => s.stage !== k && patch({ stage: k }, "stage")}>{l}</button>
            ))}
          </div>
        </section>

        <section><h3>Office note</h3>
          <div className="pk-note">
            <textarea id="sp-onote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What we found out, what's next" />
            <button className="pk-primary" disabled={busy === "note" || note === (s.office_note ?? "")} onClick={() => patch({ office_note: note }, "note")}>{busy === "note" ? "Saving…" : "Save note"}</button>
          </div>
        </section>
        {err ? <p className="pk-err" role="alert">{err}</p> : null}
      </div>
    </aside>
  );
}
