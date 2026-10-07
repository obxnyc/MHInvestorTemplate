"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Lot } from "./ParkPlan";
import ParkMap, { type LotFacts, type LotState } from "./ParkMap";
import LotCard from "./LotCard";
import { RETREAT, layOut, countOf, type Plan, type Placed } from "@/lib/parkplan";

/**
 * The park screen.
 *
 * The map is drawn from the park's own description rather than fetched from
 * anywhere, so it is on screen the moment the page opens and is never empty.
 * What the database adds is who owns each home and who lives in it -- colour
 * and a card, not position. A park with nothing on file still draws correctly;
 * it is just all one colour.
 *
 * The one thing a description cannot know is where on the earth the block
 * sits and which way it points. That is "Fit to the aerial": drag the block
 * onto the pads in the photograph, turn it until the rows line up, done once.
 */
export default function ParkScreen({ propertyId }: { propertyId: string }) {
  const [lots, setLots] = useState<Lot[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [fitting, setFitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>(RETREAT);

  // Where the block was dragged to last time. Kept in the browser rather
  // than the database so fitting works before the layout migrations have
  // been run -- the alternative is a map that cannot be corrected until
  // somebody opens a SQL editor.
  const key = `parkfit:${propertyId}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) setPlan((p) => ({ ...p, ...JSON.parse(saved) }));
    } catch { /* a browser with storage switched off still gets a map */ }
  }, [key]);

  const remember = useCallback((next: Plan) => {
    setPlan(next);
    try {
      localStorage.setItem(key, JSON.stringify({
        centre: next.centre, bearing: next.bearing,
        padSpacing: next.padSpacing, pairGap: next.pairGap, streetGap: next.streetGap,
      }));
    } catch { /* unsaved is survivable; unmovable is not */ }
  }, [key]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/properties/${propertyId}/plan`, { cache: "no-store" });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setError(out.error ?? "Could not load the park."); return; }
    setName(out.property?.name ?? "");
    setLots(out.lots ?? []);
  }, [propertyId]);
  useEffect(() => { void load(); }, [load]);

  const placed = useMemo(() => layOut(plan), [plan]);
  const match = useMemo(() => pair(placed, lots), [placed, lots]);

  const facts: LotFacts = useMemo(() => {
    const out: LotFacts = {};
    for (const h of placed) {
      const lot = match.get(h.id);
      out[h.id] = { state: lot ? stateOf(lot) : "bare", who: lot?.tenant ?? undefined };
    }
    return out;
  }, [placed, match]);

  const here = placed.find((h) => h.id === selected) ?? null;
  const open = here ? match.get(here.id) ?? null : null;
  const missing = placed.filter((h) => !match.has(h.id));

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/properties/${propertyId}/plan`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(out.error ?? "That didn't save."); return false; }
    await load();
    return true;
  }

  return (
    <div className="parkpage">
      <header className="parkhead">
        <h1>{name || "The park"}</h1>
        <div className="parkacts">
          <button type="button" className={fitting ? "btn pri" : "btn"}
                  onClick={() => { setFitting((v) => !v); setSelected(null); }}>
            {fitting ? "Done fitting" : "Fit to the aerial"}
          </button>
        </div>
      </header>

      {error && <p className="err">{error}</p>}

      {fitting && (
        <div className="parkfit">
          <p className="parkhint">
            Switch to <strong>Aerial</strong>, then drag anywhere on the map to
            slide the block onto the pads. Turn it until the rows line up and
            stretch it until the homes sit on the concrete. Nothing else on the
            page changes while you do this.
          </p>
          <Slider label="Turn" unit="°" min={0} max={359} step={1}
                  value={plan.bearing}
                  onChange={(v) => remember({ ...plan, bearing: v })} />
          <Slider label="Along the row" unit=" m" min={6} max={20} step={0.25}
                  value={plan.padSpacing}
                  onChange={(v) => remember({ ...plan, padSpacing: v })} />
          <Slider label="Across the street" unit=" m" min={18} max={55} step={0.5}
                  value={plan.pairGap}
                  onChange={(v) => remember({ ...plan, pairGap: v })} />
          <Slider label="Street to street" unit=" m" min={30} max={110} step={0.5}
                  value={plan.streetGap}
                  onChange={(v) => remember({ ...plan, streetGap: v })} />
          <div className="invacts">
            <button type="button" className="btn" onClick={() => remember(RETREAT)}>
              Start over
            </button>
          </div>
        </div>
      )}

      {missing.length > 0 && !fitting && (
        <div className="parkseed">
          <p>
            <strong>{missing.length} of {countOf(plan)}</strong> lots aren&rsquo;t
            on file yet, so there is nowhere to record who bought the home on
            them. Add them all and every pad on the map becomes clickable.
          </p>
          <button type="button" className="btn pri" disabled={busy}
                  onClick={() => void post({
                    action: "seed",
                    labels: missing.map((h) => `${h.label} ${h.street}`),
                  })}>
            {busy ? "Adding…" : `Add these ${missing.length} lots`}
          </button>
        </div>
      )}

      <div className={`parkmain${open ? " withcard" : ""}`}>
        <ParkMap
          plan={plan} facts={facts} selected={selected} onSelect={setSelected}
          fitting={fitting}
          onMove={(lng, lat) => remember({ ...plan, centre: [lng, lat] })}
        />
        {open && <LotCard lot={open} onClose={() => setSelected(null)} onChanged={load} />}
        {here && !open && (
          <aside className="lotcard">
            <header>
              <h2>Lot {here.label}</h2>
              <button type="button" className="x" onClick={() => setSelected(null)}
                      aria-label="Close">×</button>
            </header>
            <p className="dim">{here.label} {here.street}</p>
            <p>
              This pad isn&rsquo;t on file, so nothing can be recorded against
              it yet.
            </p>
            <button type="button" className="btn pri" disabled={busy}
                    onClick={() => void post({
                      action: "seed", labels: [`${here.label} ${here.street}`],
                    })}>
              {busy ? "Adding…" : "Add this lot"}
            </button>
          </aside>
        )}
      </div>

      <ul className="parkkey">
        <li><i className="sw sw-let" /> Owned and let</li>
        <li><i className="sw sw-empty" /> Owned, nobody in it</li>
        <li><i className="sw sw-ours" /> Our home, let</li>
        <li><i className="sw sw-bare" /> Bare pad</li>
      </ul>
    </div>
  );
}

/** A pad, at a glance. Four states and not more: the two that cost money --
 *  an empty home and a bare pad -- are the ones worth seeing from across the
 *  office without reading anything. */
function stateOf(lot: Lot): LotState {
  if (!lot.sale) return lot.tenant ? "ours" : "bare";
  return lot.tenant ? "let" : "empty";
}

/**
 * Which unit on file is which pad on the drawing.
 *
 * Both streets number from 3100, so a bare number matches two pads and
 * matching on it alone would put Lady Cheryl's owner on Lady Viola's home.
 * The full label wins; a bare number is only accepted when no other pad has
 * already claimed it, and in street order, so the answer does not depend on
 * what the database felt like returning first.
 */
export function pair(placed: Placed[], lots: Lot[]): Map<string, Lot> {
  const out = new Map<string, Lot>();
  const left = new Map<string, Lot>();
  for (const l of lots) left.set(norm(l.label), l);

  for (const h of placed) {
    const full = norm(`${h.label} ${h.street}`);
    const hit = left.get(full);
    if (hit) { out.set(h.id, hit); left.delete(full); }
  }
  for (const h of placed) {
    if (out.has(h.id)) continue;
    const bare = norm(h.label);
    const hit = left.get(bare);
    if (hit) { out.set(h.id, hit); left.delete(bare); }
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function Slider(
  { label, unit, min, max, step, value, onChange }:
  {
    label: string; unit: string; min: number; max: number; step: number;
    value: number; onChange: (v: number) => void;
  },
) {
  return (
    <label className="parkslider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange(Number(e.target.value))} />
      <output>{Math.round(value * 10) / 10}{unit}</output>
    </label>
  );
}
