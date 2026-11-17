"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SANFORD_LON, STAGE_COLOR, type MapDot } from "./ParkLeadsMap";

const ParkLeadsMap = dynamic(() => import("./ParkLeadsMap"), { ssr: false });

/**
 * Every mobile home park owner in North Carolina, as an outreach pipeline.
 *
 * The list is the work: who to write to next, who was called, who is due.
 * The map is where they are. The panel is one owner -- their parks, where
 * they stand, and a one-tap log of every touch.
 *
 * Filtering happens here rather than on the server: the whole list is a few
 * hundred kilobytes and a chip that waits on a round trip is a chip nobody
 * presses twice.
 */

export type Owner = {
  key: string; owner: string; owner2: string | null;
  mail_address: string | null; mail_city: string | null; mail_state: string | null; mail_zip: string | null;
  parcels: number; acres: number; assessed_value: number;
  counties: string | null; sites: string | null;
  strong: boolean; by_use: boolean; by_owner: boolean; by_legal: boolean; by_subdiv: boolean;
  out_of_state: boolean; earliest_sale: string | null; lat: number | null; lon: number | null;
};
export type Lead = {
  owner_key: string; stage: string; starred: boolean; next_touch: string | null;
  phone: string | null; email: string | null; notes: string | null; updated_at: string;
};
type Parcel = {
  key: string; cnty: string; parno: string; siteadd: string | null; scity: string | null;
  acres: number | null; parval: number | null; landval: number | null; improvval: number | null;
  usedesc: string | null; subdivision: string | null; saledate: string | null; structyear: string | null;
  lat: number | null; lon: number | null; matched_on: string[];
};
type Touch = { id: number; kind: string; body: string | null; at: string; staff?: { full_name: string } | null };

export const STAGES: [string, string][] = [
  ["new", "New"], ["researching", "Researching"], ["contacted", "Contacted"], ["talking", "Talking"],
  ["offer", "Offer out"], ["contract", "Under contract"], ["closed", "Closed"], ["dead", "Dead"],
];
const STAGE_LABEL = Object.fromEntries(STAGES);
const TOUCHES: [string, string, string][] = [
  ["letter", "Letter sent", "✉"], ["call", "Called", "☎"], ["text", "Texted", "✆"],
  ["email", "Emailed", "@"], ["visit", "Drove by", "⌖"],
];
const TOUCH_LABEL: Record<string, string> = { ...Object.fromEntries(TOUCHES.map(([k, l]) => [k, l])), note: "Note" };

const money = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 30) return `${Math.floor(d)} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} yr ago`;
}
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Llc|Lp|Llp|Inc|Mhp|Mhc|Ii|Iii|Iv|Nc|Usa)\b/g, (w) => w.toUpperCase());
const siteList = (s: string | null) =>
  (s ?? "").split(" | ").map((x) => x.replace(/^, /, "").trim()).filter(Boolean);

type Region = "east" | "all";

export default function ParkLeads() {
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [leads, setLeads] = useState<Record<string, Lead>>({});
  const [last, setLast] = useState<Record<string, { kind: string; at: string }>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);

  const [region, setRegion] = useState<Region>("east");
  const [parksOnly, setParksOnly] = useState(true);
  const [outOfState, setOutOfState] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [dueOnly, setDueOnly] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [county, setCounty] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"acres" | "value" | "parcels" | "name" | "touched">("acres");
  const [shown, setShown] = useState(150);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/parks", { cache: "no-store" });
      const t = await r.text();
      let j: Record<string, unknown> = {};
      try { j = JSON.parse(t); } catch { setErr(`The server answered ${r.status} and not with a list.`); return; }
      if (!r.ok) { setErr(String(j.error ?? `The server answered ${r.status}.`)); return; }
      setOwners(j.owners as Owner[]);
      setLeads(Object.fromEntries((j.leads as Lead[]).map((l) => [l.owner_key, l])));
      setLast(j.last as Record<string, { kind: string; at: string }>);
      setCounts(j.counts as Record<string, number>);
    })().catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  const stageOf = useCallback((k: string) => leads[k]?.stage ?? "new", [leads]);

  // Everything except the stage filter, so the stage bar can count what
  // each stage would show.
  const base = useMemo(() => {
    if (!owners) return [];
    const needle = q.trim().toLowerCase();
    const t = today();
    return owners.filter((o) => {
      if (region === "east" && !(o.lon != null && o.lon >= SANFORD_LON)) return false;
      if (parksOnly && !o.strong) return false;
      if (outOfState && !o.out_of_state) return false;
      if (starredOnly && !leads[o.key]?.starred) return false;
      if (dueOnly) { const n = leads[o.key]?.next_touch; if (!n || n > t) return false; }
      if (county && !(o.counties ?? "").split(", ").includes(county)) return false;
      if (needle) {
        const hay = `${o.owner} ${o.owner2 ?? ""} ${o.sites ?? ""} ${o.mail_city ?? ""} ${o.counties ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [owners, region, parksOnly, outOfState, starredOnly, dueOnly, county, q, leads]);

  const stageCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of base) { const s = stageOf(o.key); c[s] = (c[s] ?? 0) + 1; }
    return c;
  }, [base, stageOf]);

  const list = useMemo(() => {
    const l = stage ? base.filter((o) => stageOf(o.key) === stage) : base.slice();
    const by: Record<typeof sort, (a: Owner, b: Owner) => number> = {
      acres: (a, b) => (b.acres ?? 0) - (a.acres ?? 0),
      value: (a, b) => (b.assessed_value ?? 0) - (a.assessed_value ?? 0),
      parcels: (a, b) => b.parcels - a.parcels,
      name: (a, b) => a.owner.localeCompare(b.owner),
      touched: (a, b) => (last[b.key]?.at ?? "").localeCompare(last[a.key]?.at ?? ""),
    };
    return l.sort(by[sort]);
  }, [base, stage, stageOf, sort, last]);

  const counties = useMemo(() => {
    const s = new Set<string>();
    for (const o of owners ?? []) {
      if (region === "east" && !(o.lon != null && o.lon >= SANFORD_LON)) continue;
      for (const c of (o.counties ?? "").split(", ")) if (c) s.add(c);
    }
    return [...s].sort();
  }, [owners, region]);

  const dots: MapDot[] = useMemo(() => list
    .filter((o) => o.lat != null && o.lon != null)
    .map((o) => ({ key: o.key, lat: o.lat!, lon: o.lon!, stage: stageOf(o.key), starred: Boolean(leads[o.key]?.starred) })),
  [list, stageOf, leads]);

  useEffect(() => { setShown(150); }, [region, parksOnly, outOfState, starredOnly, dueOnly, stage, county, q, sort]);

  const current = sel ? owners?.find((o) => o.key === sel) ?? null : null;
  const due = useMemo(() => {
    const t = today();
    return Object.values(leads).filter((l) => l.next_touch && l.next_touch <= t && l.stage !== "dead" && l.stage !== "closed").length;
  }, [leads]);

  function exportCsv() {
    const cols = ["Owner", "Owner 2", "Mailing address", "City", "State", "Zip", "Park sites", "Counties",
      "Parcels", "Acres", "Assessed value", "Stage", "Last touch", "Next contact", "Phone", "Email"];
    const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = list.map((o) => {
      const l = leads[o.key];
      return [titleCase(o.owner), o.owner2 ?? "", o.mail_address ?? "", o.mail_city ?? "", o.mail_state ?? "", o.mail_zip ?? "",
        siteList(o.sites).join("; "), o.counties ?? "", o.parcels, o.acres, o.assessed_value,
        STAGE_LABEL[stageOf(o.key)], last[o.key] ? `${TOUCH_LABEL[last[o.key].kind]} ${last[o.key].at.slice(0, 10)}` : "",
        l?.next_touch ?? "", l?.phone ?? "", l?.email ?? ""].map(esc).join(",");
    });
    const blob = new Blob([[cols.join(","), ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `park-owners-${region === "east" ? "east-of-sanford" : "nc"}-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (err) return <div className="pk-shell"><p className="pk-err">{err}</p></div>;

  return (
    <div className="pk-shell">
      <header className="pk-head">
        <div className="pk-title">
          <h1>Park leads</h1>
          <p>
            {owners ? <>{list.length.toLocaleString()} owners · {list.reduce((s, o) => s + o.parcels, 0).toLocaleString()} parcels · {Math.round(list.reduce((s, o) => s + (o.acres ?? 0), 0)).toLocaleString()} acres</> : "Reading every park owner in North Carolina…"}
            {due ? <> · <button className="pk-link" onClick={() => setDueOnly(true)}>{due} due today</button></> : null}
          </p>
        </div>
        <div className="pk-seg" role="group" aria-label="Region">
          <button className={region === "east" ? "on" : ""} onClick={() => { setRegion("east"); setCounty(""); }}>Sanford &amp; east</button>
          <button className={region === "all" ? "on" : ""} onClick={() => { setRegion("all"); setCounty(""); }}>All NC</button>
        </div>
        <button className="pk-export" onClick={exportCsv} disabled={!list.length}>Export {list.length ? list.length.toLocaleString() : ""} to CSV</button>
      </header>

      <div className="pk-filters">
        <input className="pk-search" type="search" placeholder="Search owner, park, town, county…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="pk-select" value={county} onChange={(e) => setCounty(e.target.value)} aria-label="County">
          <option value="">Every county</option>
          {counties.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className={`pk-chip${parksOnly ? " on" : ""}`} onClick={() => setParksOnly((v) => !v)}
          title="On: only owners whose parcel is coded as a park, or whose name says park. Off: also lots that sit in a park subdivision.">
          Confirmed parks
        </button>
        <button className={`pk-chip${outOfState ? " on" : ""}`} onClick={() => setOutOfState((v) => !v)}>Out-of-state owner</button>
        <button className={`pk-chip${starredOnly ? " on" : ""}`} onClick={() => setStarredOnly((v) => !v)}>★ Starred</button>
        <button className={`pk-chip${dueOnly ? " on" : ""}`} onClick={() => setDueOnly((v) => !v)}>Due</button>
        <select className="pk-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="acres">Largest first</option>
          <option value="value">Highest value</option>
          <option value="parcels">Most parcels</option>
          <option value="touched">Recently worked</option>
          <option value="name">A–Z</option>
        </select>
      </div>

      <div className="pk-stages" role="group" aria-label="Pipeline stage">
        <button className={!stage ? "on" : ""} onClick={() => setStage(null)}>
          <span>All</span><b>{base.length.toLocaleString()}</b>
        </button>
        {STAGES.map(([k, l]) => (
          <button key={k} className={stage === k ? "on" : ""} onClick={() => setStage(stage === k ? null : k)}>
            <i style={{ background: STAGE_COLOR[k] }} /><span>{l}</span><b>{(stageCounts[k] ?? 0).toLocaleString()}</b>
          </button>
        ))}
      </div>

      <div className={`pk-body${current ? " has-sel" : ""}`}>
        <ul className="pk-list" aria-label="Owners">
          {!owners ? Array.from({ length: 8 }, (_, i) => <li key={i} className="pk-row pk-ghost" />) : null}
          {owners && !list.length ? <li className="pk-none">No owners match. Loosen a filter above.</li> : null}
          {list.slice(0, shown).map((o) => {
            const s = stageOf(o.key);
            const lt = last[o.key];
            const sites = siteList(o.sites);
            return (
              <li key={o.key}>
                <button className={`pk-row${sel === o.key ? " on" : ""}`} onClick={() => setSel(o.key)}>
                  <span className="pk-dot" style={{ background: STAGE_COLOR[s] }} />
                  <span className="pk-main">
                    <span className="pk-name">{leads[o.key]?.starred ? <em>★ </em> : null}{titleCase(o.owner)}</span>
                    <span className="pk-sub">{sites[0] ? titleCase(sites[0]) : "No site address"}{sites.length > 1 ? ` +${sites.length - 1}` : ""}</span>
                    <span className="pk-meta">
                      {o.counties} · {o.acres ? `${o.acres} ac` : "— ac"} · {money(o.assessed_value)}
                      {o.parcels > 1 ? ` · ${o.parcels} parcels` : ""}
                      {o.out_of_state ? <span className="pk-tag">{o.mail_state}</span> : null}
                    </span>
                  </span>
                  <span className="pk-right">
                    <span className="pk-stage" style={{ color: STAGE_COLOR[s] }}>{STAGE_LABEL[s]}</span>
                    <span className="pk-when">{lt ? `${TOUCH_LABEL[lt.kind]} ${ago(lt.at)}` : "Not contacted"}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {list.length > shown ? (
            <li><button className="pk-more" onClick={() => setShown((n) => n + 300)}>Show more ({(list.length - shown).toLocaleString()} left)</button></li>
          ) : null}
        </ul>

        <div className="pk-mapwrap">
          <ParkLeadsMap dots={dots} selected={sel} onSelect={setSel} frameKey={region} />
          <div className="pk-legend">
            {STAGES.slice(0, 6).map(([k, l]) => <span key={k}><i style={{ background: STAGE_COLOR[k] }} />{l}</span>)}
            {region === "east" ? <span className="pk-sanford">┆ Sanford</span> : null}
          </div>
          {current ? (
            <OwnerPanel
              key={current.key} owner={current} lead={leads[current.key]} touches={counts[current.key] ?? 0}
              onClose={() => setSel(null)}
              onLead={(l) => setLeads((m) => ({ ...m, [l.owner_key]: l }))}
              onTouch={(t) => {
                setLast((m) => ({ ...m, [current.key]: { kind: t.kind, at: t.at } }));
                setCounts((m) => ({ ...m, [current.key]: (m[current.key] ?? 0) + 1 }));
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OwnerPanel({ owner, lead, onClose, onLead, onTouch }: {
  owner: Owner; lead: Lead | undefined; touches: number;
  onClose: () => void; onLead: (l: Lead) => void; onTouch: (t: Touch) => void;
}) {
  const [parcels, setParcels] = useState<Parcel[] | null>(null);
  const [history, setHistory] = useState<Touch[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [email, setEmail] = useState(lead?.email ?? "");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/parks/${owner.key}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? `The server answered ${r.status}.`); return; }
      setParcels(j.parcels); setHistory(j.touches);
    })().catch((e) => setErr(String(e?.message ?? e)));
  }, [owner.key]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // Nothing on screen changes until the server has said it took it: a save
  // that failed must not look like one that worked.
  async function patch(body: Partial<Lead>, what: string) {
    setSaving(what); setErr(null);
    const r = await fetch(`/api/parks/${owner.key}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    setSaving(null);
    if (!r.ok) { setErr(j.error ?? `Not saved: the server answered ${r.status}.`); return false; }
    onLead(j.lead);
    return true;
  }
  async function touch(kind: string, body?: string) {
    setSaving(kind); setErr(null);
    const r = await fetch(`/api/parks/${owner.key}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, body }),
    });
    const j = await r.json().catch(() => ({}));
    setSaving(null);
    if (!r.ok) { setErr(j.error ?? `Not logged: the server answered ${r.status}.`); return false; }
    setHistory((h) => [j.touch, ...h]);
    onTouch(j.touch);
    if (j.lead) onLead(j.lead);
    return true;
  }

  const stage = lead?.stage ?? "new";
  const mail = [owner.mail_address, [owner.mail_city, owner.mail_state].filter(Boolean).join(", "), owner.mail_zip].filter(Boolean).join(" ");
  const mailBlock = [titleCase(owner.owner), owner.owner2 ? titleCase(owner.owner2) : null, owner.mail_address,
    `${owner.mail_city ?? ""}${owner.mail_state ? `, ${owner.mail_state}` : ""} ${owner.mail_zip ?? ""}`.trim()].filter(Boolean).join("\n");
  const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); };

  return (
    <aside className="pk-panel" aria-label={`Owner ${owner.owner}`}>
      <div className="pk-panelhead">
        <div>
          <h2>{titleCase(owner.owner)}</h2>
          {owner.owner2 ? <p className="pk-o2">{titleCase(owner.owner2)}</p> : null}
        </div>
        <button className={`pk-star${lead?.starred ? " on" : ""}`} aria-label={lead?.starred ? "Unstar" : "Star"}
          onClick={() => patch({ starred: !lead?.starred }, "star")}>★</button>
        <button className="pk-x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="pk-panelbody">
        <div className="pk-stats">
          <div><b>{owner.acres || "—"}</b><span>acres</span></div>
          <div><b>{money(owner.assessed_value)}</b><span>assessed</span></div>
          <div><b>{owner.parcels}</b><span>{owner.parcels === 1 ? "parcel" : "parcels"}</span></div>
          <div><b>{owner.mail_state ?? "—"}</b><span>owner lives</span></div>
        </div>

        <section>
          <h3>Mail to</h3>
          <div className="pk-mail">
            <span>{mail || "No mailing address on the county record"}</span>
            {mail ? (
              <button className="pk-ghostbtn" onClick={async () => {
                try { await navigator.clipboard.writeText(mailBlock); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard refused */ }
              }}>{copied ? "Copied" : "Copy label"}</button>
            ) : null}
          </div>
        </section>

        <section>
          <h3>Stage</h3>
          <div className="pk-stagepick">
            {STAGES.map(([k, l]) => (
              <button key={k} className={stage === k ? "on" : ""} disabled={saving === "stage"}
                style={stage === k ? { background: STAGE_COLOR[k], borderColor: STAGE_COLOR[k] } : undefined}
                onClick={() => stage !== k && patch({ stage: k }, "stage")}>{l}</button>
            ))}
          </div>
        </section>

        <section>
          <h3>Log a touch</h3>
          <div className="pk-touches">
            {TOUCHES.map(([k, l, ic]) => (
              <button key={k} disabled={saving === k} onClick={() => touch(k)}><span aria-hidden>{ic}</span>{saving === k ? "Saving…" : l}</button>
            ))}
          </div>
          <form className="pk-note" onSubmit={async (e) => { e.preventDefault(); if (note.trim() && await touch("note", note.trim())) setNote(""); }}>
            <textarea rows={2} placeholder="Add a note — what was said, what's next…" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="pk-primary" disabled={!note.trim() || saving === "note"}>{saving === "note" ? "Saving…" : "Add note"}</button>
          </form>
        </section>

        <section>
          <h3>Next contact</h3>
          <div className="pk-next">
            <input type="date" value={lead?.next_touch ?? ""} onChange={(e) => patch({ next_touch: e.target.value || null }, "next")} />
            {[["1 wk", 7], ["30 days", 30], ["90 days", 90]].map(([l, n]) => (
              <button key={String(l)} className="pk-ghostbtn" onClick={() => patch({ next_touch: plusDays(Number(n)) }, "next")}>{l}</button>
            ))}
            {lead?.next_touch ? <button className="pk-ghostbtn" onClick={() => patch({ next_touch: null }, "next")}>Clear</button> : null}
          </div>
        </section>

        <section>
          <h3>Contact</h3>
          <div className="pk-contact">
            <input type="tel" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)}
              onBlur={() => phone !== (lead?.phone ?? "") && patch({ phone: phone || null }, "phone")} />
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
              onBlur={() => email !== (lead?.email ?? "") && patch({ email: email || null }, "email")} />
          </div>
          {lead?.phone ? <a className="pk-call" href={`tel:${lead.phone}`}>Call {lead.phone}</a> : null}
        </section>

        {err ? <p className="pk-err" role="alert">{err}</p> : null}

        <section>
          <h3>Parks and parcels</h3>
          {!parcels ? <p className="pk-faint">Loading…</p> : (
            <ul className="pk-parcels">
              {parcels.map((p) => (
                <li key={p.key}>
                  <div className="pk-ptop">
                    <b>{p.siteadd ? titleCase(p.siteadd) : "No site address"}{p.scity ? `, ${titleCase(p.scity)}` : ""}</b>
                    {p.lat != null && p.lon != null ? (
                      <a href={`https://www.google.com/maps/@?api=1&map_action=map&center=${p.lat},${p.lon}&zoom=18&basemap=satellite`} target="_blank" rel="noreferrer">Aerial ↗</a>
                    ) : null}
                  </div>
                  <span>{p.cnty} · parcel {p.parno} · {p.acres ?? "—"} ac · {money(p.parval)}</span>
                  <span className="pk-faint">
                    {[p.usedesc, p.subdivision, p.saledate ? `sold ${p.saledate}` : null, p.structyear ? `built ${p.structyear}` : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>History</h3>
          {!history.length ? <p className="pk-faint">Nothing logged yet. The first letter or call moves this owner to Contacted.</p> : (
            <ol className="pk-history">
              {history.map((t) => (
                <li key={t.id}>
                  <b>{TOUCH_LABEL[t.kind] ?? t.kind}</b>
                  <span className="pk-faint"> · {new Date(t.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{t.staff?.full_name ? ` · ${t.staff.full_name}` : ""}</span>
                  {t.body ? <p>{t.body}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </aside>
  );
}
