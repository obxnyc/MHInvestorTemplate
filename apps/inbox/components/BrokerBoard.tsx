"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BROKER_STAGES, STARTER_PITCH, composeEmail, gmailComposeUrl, parseCsv,
  type Broker, type Pitch,
} from "@/lib/brokers";

/**
 * Brokers and realtors: who they are, where each relationship stands, and
 * getting on every one of their buyer lists.
 *
 * Outreach is a walk, not a blast: the next broker nobody has written to,
 * their email already written with their name and the park they listed,
 * opened in Gmail for a person to read and send. One click logs it and
 * moves on. Nothing is sent from this screen -- a buyer's first email to a
 * broker is a relationship, and Gmail is where the reply will come back.
 */

type Touch = { id: number; kind: string; body: string | null; at: string; staff?: { full_name: string } | null };
type Listing = { id: number; title: string; location: string | null; price: number | null; lots: number | null; url: string | null; source: string | null; seen_at: string };

const STAGE_LABEL = Object.fromEntries(BROKER_STAGES);
const STAGE_COLOR: Record<string, string> = {
  new: "#8595AC", emailed: "#3E6BB0", replied: "#7B4FC2", on_list: "#2E8B68", sending_deals: "#0F4B36", cold: "#6B7280",
};
const TOUCH_LABEL: Record<string, string> = { email: "Emailed", call: "Called", text: "Texted", meeting: "Met", note: "Note", deal: "Sent a deal" };

function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return "today"; if (d < 2) return "yesterday";
  if (d < 30) return `${Math.floor(d)} days ago`; if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} yr ago`;
}
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); };

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const t = await r.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(t); } catch { return { ok: false, j: { error: `The server answered ${r.status} and not with data.` } }; }
  return { ok: r.ok, j };
}

export default function BrokerBoard() {
  const [brokers, setBrokers] = useState<Broker[] | null>(null);
  const [last, setLast] = useState<Record<string, { kind: string; at: string }>>({});
  const [pitch, setPitch] = useState<Pitch>({ pitch: null, pitch_residential: null, signature: null });
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<"all" | "commercial" | "residential">("all");
  const [stage, setStage] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [withEmail, setWithEmail] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<null | "pitch" | "add" | "import" | "walk">(null);

  async function load() {
    const { ok, j } = await call("/api/brokers", "GET");
    if (!ok) { setErr(String(j.error)); return; }
    setBrokers(j.brokers as Broker[]); setLast(j.last as typeof last); setPitch(j.pitch as Pitch);
  }
  useEffect(() => { load().catch((e) => setErr(String(e))); }, []);

  const put = (b: Broker) => setBrokers((all) => (all ?? []).map((x) => (x.id === b.id ? b : x)));

  const base = useMemo(() => (brokers ?? []).filter((b) => {
    if (kind !== "all" && b.kind !== kind) return false;
    if (state && (b.state ?? "") !== state) return false;
    if (withEmail && !b.email) return false;
    const n = q.trim().toLowerCase();
    if (n && !`${b.name} ${b.firm ?? ""} ${b.city ?? ""} ${b.covers ?? ""} ${b.evidence ?? ""}`.toLowerCase().includes(n)) return false;
    return true;
  }), [brokers, kind, state, withEmail, q]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const b of base) c[b.stage] = (c[b.stage] ?? 0) + 1; return c; }, [base]);
  const list = useMemo(() => (stage ? base.filter((b) => b.stage === stage) : base)
    .slice().sort((a, b) => Number(b.starred) - Number(a.starred) || (b.parks_listed ?? 0) - (a.parks_listed ?? 0) || a.name.localeCompare(b.name)), [base, stage]);
  const states = useMemo(() => [...new Set((brokers ?? []).map((b) => b.state).filter(Boolean) as string[])].sort(), [brokers]);
  const queue = useMemo(() => base.filter((b) => b.stage === "new" && b.email), [base]);
  const onList = (brokers ?? []).filter((b) => b.stage === "on_list" || b.stage === "sending_deals").length;
  const current = sel ? brokers?.find((b) => b.id === sel) ?? null : null;

  if (err) return <div className="pk-shell"><p className="pk-err">{err}</p></div>;

  return (
    <div className="pk-shell">
      <header className="pk-head">
        <div className="pk-title">
          <h1>Brokers &amp; agents</h1>
          <p>{brokers ? <>{list.length} shown · on {onList} buyer {onList === 1 ? "list" : "lists"} · {queue.length} with an email not yet contacted</> : "Loading…"}</p>
        </div>
        <button className="pk-primary pk-big" disabled={!queue.length} onClick={() => setMode("walk")}>
          Start outreach{queue.length ? ` (${queue.length})` : ""}
        </button>
        <button className="pk-export" onClick={() => setMode("pitch")}>Your pitch</button>
        <button className="pk-export" onClick={() => setMode("import")}>Import</button>
        <button className="pk-export" onClick={() => setMode("add")}>Add</button>
      </header>

      <div className="pk-filters">
        <div className="pk-seg" role="group" aria-label="Kind">
          {(["all", "commercial", "residential"] as const).map((k) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
              {k === "all" ? "All" : k === "commercial" ? "Commercial brokers" : "Realtors"}
            </button>
          ))}
        </div>
        <input className="pk-search" type="search" placeholder="Search name, firm, town, park…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="pk-select" value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
          <option value="">Every state</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className={`pk-chip${withEmail ? " on" : ""}`} onClick={() => setWithEmail((v) => !v)}>Has email</button>
      </div>

      <div className="pk-stages" role="group" aria-label="Stage">
        <button className={!stage ? "on" : ""} onClick={() => setStage(null)}><span>All</span><b>{base.length}</b></button>
        {BROKER_STAGES.map(([k, l]) => (
          <button key={k} className={stage === k ? "on" : ""} onClick={() => setStage(stage === k ? null : k)}>
            <i style={{ background: STAGE_COLOR[k] }} /><span>{l}</span><b>{counts[k] ?? 0}</b>
          </button>
        ))}
      </div>

      <div className="pk-body bk-body">
        <ul className="pk-list" aria-label="Brokers">
          {!brokers ? Array.from({ length: 6 }, (_, i) => <li key={i} className="pk-row pk-ghost" />) : null}
          {brokers && !brokers.length ? (
            <li className="pk-none">No brokers yet. Press <b>Import</b> to load a spreadsheet, or <b>Add</b> to type one in.</li>
          ) : brokers && !list.length ? <li className="pk-none">Nobody matches. Loosen a filter above.</li> : null}
          {list.map((b) => (
            <li key={b.id}>
              <button className={`pk-row${sel === b.id ? " on" : ""}`} onClick={() => setSel(b.id)}>
                <span className="pk-dot" style={{ background: STAGE_COLOR[b.stage] }} />
                <span className="pk-main">
                  <span className="pk-name">{b.starred ? <em>★ </em> : null}{b.name}</span>
                  <span className="pk-sub">{[b.firm, [b.city, b.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "—"}</span>
                  <span className="pk-meta">
                    <span className={`bk-kind ${b.kind}`}>{b.kind === "commercial" ? "Broker" : "Realtor"}</span>
                    {b.evidence ? <span className="bk-ev">{b.evidence.replace(/^residential[:;,\s-]*/i, "")}</span> : null}
                    {!b.email ? <span className="pk-tag">no email</span> : null}
                  </span>
                </span>
                <span className="pk-right">
                  <span className="pk-stage" style={{ color: STAGE_COLOR[b.stage] }}>{STAGE_LABEL[b.stage]}</span>
                  <span className="pk-when">{last[b.id] ? `${TOUCH_LABEL[last[b.id].kind]} ${ago(last[b.id].at)}` : ""}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="bk-side">
          {current ? (
            <BrokerPanel key={current.id} b={current} pitch={pitch} onClose={() => setSel(null)} onBroker={put}
              onTouch={(t) => setLast((m) => ({ ...m, [current.id]: { kind: t.kind, at: t.at } }))} />
          ) : (
            <div className="bk-empty">
              <h2>Get on every buyer list</h2>
              <ol>
                <li><b>Write your pitch once.</b> Who you are, what you buy, how you close. It goes into every email with the broker&rsquo;s name and the park they listed filled in.</li>
                <li><b>Start outreach.</b> Each broker you haven&rsquo;t written to opens in Gmail, ready to send. Read it, press Send, then <b>Sent</b> here.</li>
                <li><b>Mark who adds you.</b> On their list, then Sending deals. Set a next contact date so nobody goes cold.</li>
              </ol>
              <p className="pk-faint">Commercial brokers get the buyer-list email. Realtors get a shorter one asking them to call if a park ever crosses their desk.</p>
            </div>
          )}
        </div>
      </div>

      {mode === "pitch" ? <PitchEditor pitch={pitch} onClose={() => setMode(null)} onSaved={(p) => { setPitch(p); setMode(null); }} /> : null}
      {mode === "add" ? <AddBroker onClose={() => setMode(null)} onAdded={() => { setMode(null); load(); }} /> : null}
      {mode === "import" ? <ImportBrokers onClose={() => setMode(null)} onDone={() => load()} /> : null}
      {mode === "walk" ? (
        <OutreachWalk queue={queue} pitch={pitch} onClose={() => setMode(null)}
          onSent={(b, t) => { put(b); setLast((m) => ({ ...m, [b.id]: { kind: t.kind, at: t.at } })); }} />
      ) : null}
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="bk-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`bk-modal${wide ? " wide" : ""}`} role="dialog" aria-label={title}>
        <div className="pk-panelhead"><div><h2>{title}</h2></div><button className="pk-x" onClick={onClose} aria-label="Close">×</button></div>
        <div className="pk-panelbody">{children}</div>
      </div>
    </div>
  );
}

function PitchEditor({ pitch, onClose, onSaved }: { pitch: Pitch; onClose: () => void; onSaved: (p: Pitch) => void }) {
  const [a, setA] = useState(pitch.pitch ?? STARTER_PITCH.commercial);
  const [r, setR] = useState(pitch.pitch_residential ?? STARTER_PITCH.residential);
  const [sig, setSig] = useState(pitch.signature ?? "Cade Larabee\nLarabee Homes LLC\ncade@larabeehomesllc.com");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unfilled = /\[Add:|\[\d|\[cash/.test(a + r);
  return (
    <Modal title="Your pitch" onClose={onClose} wide>
      <p className="pk-faint">{"{first}"} becomes the broker&rsquo;s first name, {"{area}"} their town, and {"{evidence_line}"} a sentence naming the park they listed, when we know one. Fill in everything in [square brackets].</p>
      <section><h3>To commercial brokers</h3><textarea className="bk-text" rows={12} value={a} onChange={(e) => setA(e.target.value)} /></section>
      <section><h3>To realtors</h3><textarea className="bk-text" rows={9} value={r} onChange={(e) => setR(e.target.value)} /></section>
      <section><h3>Signature</h3><textarea className="bk-text" rows={4} value={sig} onChange={(e) => setSig(e.target.value)} /></section>
      {unfilled ? <p className="pk-err">There are still [square brackets] to fill in. Brokers will see them as written.</p> : null}
      {err ? <p className="pk-err">{err}</p> : null}
      <button className="pk-primary" disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        const { ok, j } = await call("/api/brokers/pitch", "PUT", { pitch: a, pitch_residential: r, signature: sig });
        setBusy(false);
        if (!ok) { setErr(String(j.error)); return; }
        onSaved(j as unknown as Pitch);
      }}>{busy ? "Saving…" : "Save pitch"}</button>
    </Modal>
  );
}

function AddBroker({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [f, setF] = useState({ name: "", firm: "", kind: "commercial", email: "", phone: "", city: "", state: "NC", evidence: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Add a broker or realtor" onClose={onClose}>
      <form className="bk-form" onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        const { ok, j } = await call("/api/brokers", "POST", { rows: [f] });
        if (!ok) { setErr(String(j.error)); return; }
        if (!j.added) { setErr(j.skipped ? "That person is already on the list." : "Not added: check the name and email."); return; }
        onAdded();
      }}>
        <label>Name<input id="bk-name" required value={f.name} onChange={set("name")} /></label>
        <label>Firm<input id="bk-firm" value={f.firm} onChange={set("firm")} /></label>
        <label>Kind<select id="bk-kind" value={f.kind} onChange={set("kind")}><option value="commercial">Commercial broker</option><option value="residential">Realtor</option></select></label>
        <label>Email<input id="bk-email" type="email" value={f.email} onChange={set("email")} /></label>
        <label>Phone<input id="bk-phone" type="tel" value={f.phone} onChange={set("phone")} /></label>
        <label>Town<input id="bk-city" value={f.city} onChange={set("city")} /></label>
        <label>State<input id="bk-state" value={f.state} onChange={set("state")} /></label>
        <label className="full">Park they listed or sold<input id="bk-ev" placeholder="e.g. Pine Acres MHP, 42 lots, Goldsboro (2025)" value={f.evidence} onChange={set("evidence")} /></label>
        {err ? <p className="pk-err full">{err}</p> : null}
        <button className="pk-primary full">Add</button>
      </form>
    </Modal>
  );
}

function ImportBrokers({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [res, setRes] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return (
    <Modal title="Import brokers" onClose={onClose}>
      <p className="pk-faint">A CSV from a spreadsheet, a roster or an export. Columns it understands: name, firm, kind (commercial or residential), email, phone, city, state, covers, evidence, source_url. Anyone already here, by email or by name and firm, is skipped and left as it is.</p>
      <input ref={file} id="bk-file" type="file" accept=".csv,text/csv" onChange={async (e) => {
        setRes(null); setErr(null);
        const fl = e.target.files?.[0]; if (!fl) return;
        const r = parseCsv(await fl.text());
        if (!r.length || !("name" in r[0])) { setErr("That file has no name column, so there is nobody to add."); setRows(null); return; }
        setRows(r);
      }} />
      {rows ? <p>{rows.length} rows read, {rows.filter((r) => r.email).length} with an email.</p> : null}
      {err ? <p className="pk-err">{err}</p> : null}
      {res ? <p className="bk-ok">{res}</p> : null}
      <button className="pk-primary" disabled={!rows || busy} onClick={async () => {
        setBusy(true); setErr(null);
        const { ok, j } = await call("/api/brokers", "POST", { rows });
        setBusy(false);
        if (!ok) { setErr(String(j.error)); return; }
        setRes(`Added ${j.added}. ${j.skipped} already here, ${j.bad} without a usable name or email.`);
        setRows(null); if (file.current) file.current.value = "";
        onDone();
      }}>{busy ? "Importing…" : "Import"}</button>
    </Modal>
  );
}

function OutreachWalk({ queue, pitch, onClose, onSent }: {
  queue: Broker[]; pitch: Pitch; onClose: () => void; onSent: (b: Broker, t: Touch) => void;
}) {
  // A snapshot: the queue shrinks as people are written to, and the walk
  // must not skip somebody because the list moved under it.
  const [order] = useState(() => queue.map((b) => b.id));
  const byId = useMemo(() => new Map(queue.map((b) => [b.id, b])), [queue]);
  const [i, setI] = useState(0);
  const [opened, setOpened] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const b = byId.get(order[i]) ?? null;
  const mail = b ? composeEmail(b, pitch) : null;
  const [body, setBody] = useState(mail?.body ?? "");
  useEffect(() => { setBody(mail?.body ?? ""); setOpened(false); setErr(null); }, [order[i]]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!b || !mail) return (
    <Modal title="Outreach" onClose={onClose}>
      <p className="bk-ok">{done ? `Done: ${done} ${done === 1 ? "email" : "emails"} logged.` : "Nobody left to write to."}</p>
      <button className="pk-primary" onClick={onClose}>Close</button>
    </Modal>
  );
  return (
    <Modal title={`Outreach · ${i + 1} of ${order.length}`} onClose={onClose} wide>
      <div className="bk-who">
        <b>{b.name}</b><span>{[b.firm, b.city, b.state].filter(Boolean).join(" · ")}</span>
        <span className="pk-faint">{b.email}{b.evidence ? ` · ${b.evidence.replace(/^residential[:;,\s-]*/i, "")}` : ""}</span>
      </div>
      <section><h3>Subject</h3><p className="bk-subject">{mail.subject}</p></section>
      <section><h3>Email</h3><textarea className="bk-text" rows={14} value={body} onChange={(e) => setBody(e.target.value)} /></section>
      {/\[Add:|\[\d|\[cash/.test(body) ? <p className="pk-err">This email still has [square brackets] in it. Fill them in under Your pitch first.</p> : null}
      {err ? <p className="pk-err">{err}</p> : null}
      <div className="bk-walkbar">
        <a className="pk-primary" href={gmailComposeUrl(b.email!, mail.subject, body)} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}>Open in Gmail</a>
        <button className="pk-export" disabled={busy || !opened} title={opened ? "" : "Open it in Gmail and send it first"} onClick={async () => {
          setBusy(true); setErr(null);
          const { ok, j } = await call(`/api/brokers/${b.id}`, "POST", { kind: "email", body: `${mail.subject}\n\n${body}` });
          setBusy(false);
          if (!ok) { setErr(String(j.error)); return; }
          onSent((j.broker as Broker) ?? { ...b, stage: "emailed" }, j.touch as Touch);
          setDone((n) => n + 1); setI((n) => n + 1);
        }}>{busy ? "Logging…" : "Sent, next"}</button>
        <button className="pk-ghostbtn" onClick={() => setI((n) => n + 1)}>Skip</button>
      </div>
      <p className="pk-faint">Gmail opens with this filled in. Nothing goes until you press Send there.</p>
    </Modal>
  );
}

function BrokerPanel({ b, pitch, onClose, onBroker, onTouch }: {
  b: Broker; pitch: Pitch; onClose: () => void; onBroker: (b: Broker) => void; onTouch: (t: Touch) => void;
}) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [history, setHistory] = useState<Touch[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [f, setF] = useState({ email: b.email ?? "", phone: b.phone ?? "" });
  const [lst, setLst] = useState({ title: "", location: "", url: "" });
  const mail = composeEmail(b, pitch);

  useEffect(() => {
    (async () => {
      const { ok, j } = await call(`/api/brokers/${b.id}`, "GET");
      if (!ok) { setErr(String(j.error)); return; }
      setListings(j.listings as Listing[]); setHistory(j.touches as Touch[]);
    })().catch((e) => setErr(String(e)));
  }, [b.id]);

  async function patch(body: Record<string, unknown>, what: string) {
    setSaving(what); setErr(null);
    const { ok, j } = await call(`/api/brokers/${b.id}`, "PATCH", body);
    setSaving(null);
    if (!ok) { setErr(String(j.error)); return; }
    onBroker(j.broker as Broker);
  }
  async function touch(kind: string, body?: string) {
    setSaving(kind); setErr(null);
    const { ok, j } = await call(`/api/brokers/${b.id}`, "POST", { kind, body });
    setSaving(null);
    if (!ok) { setErr(String(j.error)); return false; }
    setHistory((h) => [j.touch as Touch, ...h]); onTouch(j.touch as Touch);
    if (j.broker) onBroker(j.broker as Broker);
    return true;
  }

  return (
    <aside className="pk-panel bk-panel" aria-label={b.name}>
      <div className="pk-panelhead">
        <div><h2>{b.name}</h2><p className="pk-o2">{[b.firm, [b.city, b.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</p></div>
        <button className={`pk-star${b.starred ? " on" : ""}`} aria-label={b.starred ? "Unstar" : "Star"} onClick={() => patch({ starred: !b.starred }, "star")}>★</button>
        <button className="pk-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="pk-panelbody">
        <div className="pk-seg bk-kindseg" role="group" aria-label="Kind">
          <button className={b.kind === "commercial" ? "on" : ""} onClick={() => b.kind !== "commercial" && patch({ kind: "commercial" }, "kind")}>Commercial broker</button>
          <button className={b.kind === "residential" ? "on" : ""} onClick={() => b.kind !== "residential" && patch({ kind: "residential" }, "kind")}>Realtor</button>
        </div>

        {b.evidence || b.source_url ? (
          <section><h3>Why they&rsquo;re here</h3>
            <p className="bk-evp">{b.evidence?.replace(/^residential[:;,\s-]*/i, "")}{b.source_url ? <> <a href={b.source_url} target="_blank" rel="noreferrer">Source ↗</a></> : null}</p>
          </section>
        ) : null}

        <section><h3>Stage</h3>
          <div className="pk-stagepick">
            {BROKER_STAGES.map(([k, l]) => (
              <button key={k} className={b.stage === k ? "on" : ""} disabled={saving === "stage"}
                style={b.stage === k ? { background: STAGE_COLOR[k], borderColor: STAGE_COLOR[k] } : undefined}
                onClick={() => b.stage !== k && patch({ stage: k }, "stage")}>{l}</button>
            ))}
          </div>
        </section>

        <section><h3>Contact</h3>
          <div className="pk-contact">
            <input id="bp-email" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })}
              onBlur={() => f.email !== (b.email ?? "") && patch({ email: f.email || null }, "email")} />
            <input id="bp-phone" type="tel" placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })}
              onBlur={() => f.phone !== (b.phone ?? "") && patch({ phone: f.phone || null }, "phone")} />
          </div>
        </section>

        <section><h3>Reach out</h3>
          <div className="pk-touches">
            {b.email ? (
              <a className="bk-touchlink" href={gmailComposeUrl(b.email, mail.subject, mail.body)} target="_blank" rel="noreferrer">✉ Write in Gmail</a>
            ) : null}
            {[["email", "Log email"], ["call", "Called"], ["text", "Texted"], ["meeting", "Met"], ["deal", "Got a deal"]].map(([k, l]) => (
              <button key={k} disabled={saving === k} onClick={() => touch(k)}>{saving === k ? "Saving…" : l}</button>
            ))}
          </div>
          <form className="pk-note" onSubmit={async (e) => { e.preventDefault(); if (note.trim() && await touch("note", note.trim())) setNote(""); }}>
            <textarea id="bp-note" rows={2} placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="pk-primary" disabled={!note.trim() || saving === "note"}>Add note</button>
          </form>
        </section>

        <section><h3>Next contact</h3>
          <div className="pk-next">
            <input id="bp-next" type="date" value={b.next_touch ?? ""} onChange={(e) => patch({ next_touch: e.target.value || null }, "next")} />
            {([["2 wks", 14], ["90 days", 90], ["6 mo", 180]] as [string, number][]).map(([l, n]) => (
              <button key={l} className="pk-ghostbtn" onClick={() => patch({ next_touch: plusDays(n) }, "next")}>{l}</button>
            ))}
          </div>
          {b.next_touch && b.next_touch <= today() ? <p className="pk-err">Due now.</p> : null}
        </section>

        {err ? <p className="pk-err" role="alert">{err}</p> : null}

        <section><h3>Their listings</h3>
          {!listings ? <p className="pk-faint">Loading…</p> : !listings.length ? <p className="pk-faint">None recorded.</p> : (
            <ul className="pk-parcels">
              {listings.map((l) => (
                <li key={l.id}><div className="pk-ptop"><b>{l.title}</b>{l.url ? <a href={l.url} target="_blank" rel="noreferrer">Open ↗</a> : null}</div>
                  <span>{[l.location, l.lots ? `${l.lots} lots` : null, l.price ? `$${Math.round(l.price).toLocaleString()}` : null].filter(Boolean).join(" · ")}</span></li>
              ))}
            </ul>
          )}
          <form className="bk-addl" onSubmit={async (e) => {
            e.preventDefault(); if (!lst.title.trim()) return;
            const { ok, j } = await call(`/api/brokers/${b.id}`, "POST", { listing: lst });
            if (!ok) { setErr(String(j.error)); return; }
            setListings((x) => [j.listing as Listing, ...(x ?? [])]); setLst({ title: "", location: "", url: "" });
          }}>
            <input id="bp-lt" placeholder="Park name" value={lst.title} onChange={(e) => setLst({ ...lst, title: e.target.value })} />
            <input id="bp-ll" placeholder="Town" value={lst.location} onChange={(e) => setLst({ ...lst, location: e.target.value })} />
            <input id="bp-lu" placeholder="Link" value={lst.url} onChange={(e) => setLst({ ...lst, url: e.target.value })} />
            <button className="pk-ghostbtn" disabled={!lst.title.trim()}>Add listing</button>
          </form>
        </section>

        <section><h3>History</h3>
          {!history.length ? <p className="pk-faint">Nothing logged yet.</p> : (
            <ol className="pk-history">
              {history.map((t) => (
                <li key={t.id}><b>{TOUCH_LABEL[t.kind] ?? t.kind}</b>
                  <span className="pk-faint"> · {new Date(t.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{t.staff?.full_name ? ` · ${t.staff.full_name}` : ""}</span>
                  {t.body ? <p>{t.body.length > 280 ? t.body.slice(0, 280) + "…" : t.body}</p> : null}</li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </aside>
  );
}
