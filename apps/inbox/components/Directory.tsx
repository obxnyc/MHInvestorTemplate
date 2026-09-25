"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Vendor = {
  id: string; name: string; company: string | null; phone: string;
  email: string | null; notes: string | null; preferred: boolean;
  trades: string[]; markets: string[];
};
type Trade = { id: string; label: string };
type Market = { id: string; name: string; state: string | null };

/**
 * Who does what, and where.
 *
 * "Our plumber" stops being a single answer the moment there is a second town,
 * so market is a filter alongside trade rather than a note in a description.
 * Filtering down to "plumbing in Elizabeth City" is the question this page
 * exists to answer at eight in the morning with a tenant waiting.
 *
 * Both filters are multi-valued on the vendor, because both genuinely are: a
 * handyman who also does light plumbing is one person with two trades, and
 * forcing one would drop him out of half the searches he belongs in.
 */
export default function Directory() {
  const router = useRouter();
  const [, start] = useTransition();
  const [data, setData] = useState<{ vendors: Vendor[]; trades: Trade[]; markets: Market[] } | null>(null);
  const [trade, setTrade] = useState("");
  const [market, setMarket] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);

  const load = () => fetch("/api/directory").then((r) => r.json()).then(setData);
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.vendors.filter((v) =>
      (!trade || v.trades.includes(trade))
      && (!market || v.markets.includes(market))
      && (!needle || `${v.name} ${v.company ?? ""} ${v.phone} ${v.notes ?? ""}`
            .toLowerCase().includes(needle)));
  }, [data, trade, market, q]);

  const tradeLabel = (id: string) =>
    data?.trades.find((t) => t.id === id)?.label ?? id;
  const marketLabel = (id: string) =>
    data?.markets.find((m) => m.id === id)?.name ?? "";

  if (!data) return <p className="pinmuted pad">Loading the directory…</p>;

  return (
    <>
      <div className="dirbar">
        <input className="pinsearch" value={q} placeholder="Search name, company, number…"
               onChange={(e) => setQ(e.target.value)} />
        <select value={trade} onChange={(e) => setTrade(e.target.value)}>
          <option value="">Every trade</option>
          {data.trades.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select value={market} onChange={(e) => setMarket(e.target.value)}>
          <option value="">Everywhere</option>
          {data.markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button className="btn pri" onClick={() => setEditing("new")}>Add a trade</button>
      </div>

      <ul className="people-list">
        {shown.map((v) => (
          <li key={v.id}>
            <span className="p-name">
              {v.preferred && <span className="star" title="Who we call first">★</span>}
              {v.name}
              {v.company && <span className="tag">{v.company}</span>}
            </span>
            <span className="p-sub">
              {v.trades.map(tradeLabel).join(" · ") || "No trade set"}
              {v.markets.length ? ` — ${v.markets.map(marketLabel).join(", ")}` : ""}
              {" · "}{v.phone}
              {v.notes ? ` · ${v.notes}` : ""}
            </span>
            <span className="p-acts">
              <button className="mini" onClick={() => setEditing(v)}>Edit</button>
            </span>
          </li>
        ))}
        {!shown.length && (
          <li className="none">
            {data.vendors.length
              ? "Nobody matches those filters."
              : "No trades yet. Add the people you already call."}
          </li>
        )}
      </ul>

      {editing && (
        <VendorSheet
          vendor={editing === "new" ? null : editing}
          trades={data.trades} markets={data.markets}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); start(() => router.refresh()); }}
        />
      )}
    </>
  );
}

function VendorSheet(
  { vendor, trades, markets, onClose, onSaved }:
  { vendor: Vendor | null; trades: Trade[]; markets: Market[];
    onClose: () => void; onSaved: () => void },
) {
  const [name, setName] = useState(vendor?.name ?? "");
  const [company, setCompany] = useState(vendor?.company ?? "");
  const [phone, setPhone] = useState(vendor?.phone ?? "");
  const [email, setEmail] = useState(vendor?.email ?? "");
  const [notes, setNotes] = useState(vendor?.notes ?? "");
  const [preferred, setPreferred] = useState(vendor?.preferred ?? false);
  const [picked, setPicked] = useState<string[]>(vendor?.trades ?? []);
  const [where, setWhere] = useState<string[]>(vendor?.markets ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch("/api/people/vendor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: name, company, phone, email, notes, preferred,
        trades: picked, markets: where,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "That didn't save.");
      return;
    }
    onSaved();
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sheet wide" onClick={(e) => e.stopPropagation()}>
        <h3>{vendor ? "Edit trade" : "Add a trade"}</h3>
        {error && <p className="err">{error}</p>}

        <label className="fieldlab" htmlFor="vn">Name</label>
        <input id="vn" value={name} onChange={(e) => setName(e.target.value)} autoFocus />

        <label className="fieldlab" htmlFor="vc">Company <span className="opt">— optional</span></label>
        <input id="vc" value={company} onChange={(e) => setCompany(e.target.value)} />

        <label className="fieldlab" htmlFor="vp">Mobile number</label>
        <input id="vp" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
               placeholder="(252) 555-0142" />

        <label className="fieldlab" htmlFor="ve">Email <span className="opt">— optional</span></label>
        <input id="ve" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

        <p className="fieldlab">What they do</p>
        <div className="chipset">
          {trades.map((t) => (
            <button key={t.id} type="button"
                    className={`chip${picked.includes(t.id) ? " on" : ""}`}
                    aria-pressed={picked.includes(t.id)}
                    onClick={() => toggle(picked, setPicked, t.id)}>{t.label}</button>
          ))}
        </div>

        <p className="fieldlab">Where they work</p>
        <div className="chipset">
          {markets.map((m) => (
            <button key={m.id} type="button"
                    className={`chip${where.includes(m.id) ? " on" : ""}`}
                    aria-pressed={where.includes(m.id)}
                    onClick={() => toggle(where, setWhere, m.id)}>{m.name}</button>
          ))}
        </div>

        <label className="fieldlab" htmlFor="vnote">
          Notes <span className="opt">— rates, hours, who to ask for</span>
        </label>
        <textarea id="vnote" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

        <label className="check">
          <input type="checkbox" checked={preferred}
                 onChange={(e) => setPreferred(e.target.checked)} />
          <span>Who we call first<small>Sorted to the top of their trade.</small></span>
        </label>

        <div className="acts">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn pri" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
