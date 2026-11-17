"use client";

import { useEffect, useState } from "react";
import { ASSET_CLASSES, UNIT_WORD, describeBox, type BuyBox } from "@/lib/buybox";

/**
 * What we buy, one box per asset class and area.
 *
 * Each box saves the moment a field is left -- a list of criteria somebody
 * is tuning should not need a Save button they can forget. The line under
 * each box is exactly what a broker reads in a "what we buy" blast, so the
 * person typing sees the sentence their numbers make.
 */

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const t = await r.text();
  try { return { ok: r.ok, j: JSON.parse(t) as Record<string, unknown> }; }
  catch { return { ok: false, j: { error: `The server answered ${r.status} and not with data.` } as Record<string, unknown> }; }
}

const FIELDS: { k: keyof BuyBox; label: (u: string) => string; money?: boolean; pct?: boolean; wide?: boolean; text?: boolean; ph?: string }[] = [
  { k: "min_units", label: (u) => `Fewest ${u}` },
  { k: "max_units", label: (u) => `Most ${u}` },
  { k: "min_price", label: () => "Lowest price", money: true },
  { k: "max_price", label: () => "Highest price", money: true },
  { k: "max_price_per_unit", label: (u) => `Most per ${u.replace(/s$/, "")}`, money: true },
  { k: "min_occupancy", label: () => "Lowest occupancy %", pct: true },
  { k: "financing", label: () => "How we close", text: true, wide: true, ph: "Cash, bank, or seller finance; 30-day close" },
  { k: "wants", label: () => "Welcome (value-add)", text: true, wide: true, ph: "Park-owned homes, vacant lots, deferred maintenance, private utilities" },
  { k: "avoids", label: () => "Not for us", text: true, wide: true, ph: "Flood zone, master-metered electric with no plan, ground leases" },
];

export default function BuyBoxes() {
  const [boxes, setBoxes] = useState<BuyBox[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { ok, j } = await call("/api/buy-boxes", "GET");
      if (!ok) { setErr(String(j.error)); return; }
      setBoxes(j.boxes as BuyBox[]);
    })().catch((e) => setErr(String(e)));
  }, []);

  async function add(asset_class: string) {
    setBusy(true); setErr(null);
    const starter = asset_class === "mhp"
      ? { area: "Sanford and east", wants: "Park-owned homes, vacant lots, deferred maintenance, private utilities" }
      : { area: "" };
    const { ok, j } = await call("/api/buy-boxes", "POST", { asset_class, sort: (boxes?.length ?? 0) + 1, ...starter });
    setBusy(false);
    if (!ok) { setErr(String(j.error)); return; }
    setBoxes((b) => [...(b ?? []), j.box as BuyBox]);
  }

  if (err && !boxes) return <div className="pk-shell"><p className="pk-err">{err}</p></div>;

  return (
    <div className="pk-shell bb-shell">
      <header className="pk-head">
        <div className="pk-title">
          <h1>Buy boxes</h1>
          <p>What you buy, by asset class and area. These go into &ldquo;What we buy&rdquo; blasts, and listing alerts will be matched against them.</p>
        </div>
        <select id="bb-add" className="pk-select" value="" disabled={busy} onChange={(e) => e.target.value && add(e.target.value)} aria-label="Add a buy box">
          <option value="">+ Add a buy box…</option>
          {ASSET_CLASSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </header>
      {err ? <p className="pk-err">{err}</p> : null}
      <div className="bb-list">
        {!boxes ? <div className="pk-row pk-ghost" /> : null}
        {boxes && !boxes.length ? (
          <div className="bk-empty">
            <h2>No buy boxes yet</h2>
            <p>Start with your general one for each asset class, then add tighter ones for particular areas. Pick an asset class from <b>+ Add a buy box</b>.</p>
          </div>
        ) : null}
        {(boxes ?? []).map((b) => (
          <Box key={b.id} box={b} onSaved={(x) => setBoxes((all) => (all ?? []).map((y) => (y.id === x.id ? x : y)))} />
        ))}
      </div>
    </div>
  );
}

function Box({ box, onSaved }: { box: BuyBox; onSaved: (b: BuyBox) => void }) {
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(
    Object.entries(box).map(([k, v]) => [k, v == null ? "" : String(v)])));
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  const [err, setErr] = useState<string | null>(null);
  const u = UNIT_WORD[f.asset_class] ?? "units";

  // Nothing on screen claims "Saved" until the server has said so.
  async function save(patch: Record<string, unknown>) {
    setState("saving"); setErr(null);
    const { ok, j } = await call("/api/buy-boxes", "PATCH", { id: box.id, ...patch });
    if (!ok) { setState("error"); setErr(String(j.error)); return; }
    onSaved(j.box as BuyBox); setState("saved");
  }
  const blur = (k: string) => () => { if (f[k] !== (box[k as keyof BuyBox] == null ? "" : String(box[k as keyof BuyBox]))) save({ [k]: f[k] }); };

  const shown: BuyBox = { ...box, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k,
    ["min_units", "max_units", "min_price", "max_price", "max_price_per_unit", "min_occupancy", "sort"].includes(k)
      ? (v.trim() === "" ? null : Number(v.replace(/[$,%\s]/g, "")) || null) : k === "active" ? v === "true" : v])) } as BuyBox;

  return (
    <section className={`bb-box${box.active ? "" : " off"}`} aria-label={`Buy box ${box.asset_class} ${box.area}`}>
      <div className="bb-top">
        <select id={`bb-class-${box.id}`} className="pk-select" value={f.asset_class}
          onChange={(e) => { setF({ ...f, asset_class: e.target.value }); save({ asset_class: e.target.value }); }} aria-label="Asset class">
          {ASSET_CLASSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input id={`bb-area-${box.id}`} className="pk-search bb-area" placeholder="Area: Sanford and east, Wake County, all of SC…" value={f.area}
          onChange={(e) => setF({ ...f, area: e.target.value })} onBlur={blur("area")} />
        <label className="bb-active">
          <input id={`bb-on-${box.id}`} type="checkbox" checked={box.active} onChange={(e) => save({ active: e.target.checked })} />
          <span>In use</span>
        </label>
        <span className={`bb-state ${state}`}>{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved" : ""}</span>
      </div>
      <div className="bb-grid">
        {FIELDS.map((x) => (
          <label key={x.k} className={x.wide ? "wide" : ""}>
            <span>{x.label(u)}</span>
            <input id={`bb-${x.k}-${box.id}`} inputMode={x.text ? "text" : "decimal"} placeholder={x.ph ?? (x.money ? "$" : x.pct ? "%" : "")}
              value={f[x.k] ?? ""} onChange={(e) => setF({ ...f, [x.k]: e.target.value })} onBlur={blur(x.k)} />
          </label>
        ))}
      </div>
      {err ? <p className="pk-err">{err}</p> : null}
      <p className="bb-line">{describeBox(shown)}</p>
    </section>
  );
}
