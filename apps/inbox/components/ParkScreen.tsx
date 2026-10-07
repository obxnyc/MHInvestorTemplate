"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lot } from "./ParkPlan";
import ParkMap, { type LotFacts, type LotState, type RealPark } from "./ParkMap";
import LotCard from "./LotCard";
import { RETREAT, layOut, countOf, fitTargets, fitFromTaps,
         type Plan, type Placed, type Tap } from "@/lib/parkplan";
import { degreesPerMetre } from "@/lib/footprint";

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
  const [real, setReal] = useState<RealPark | null>(null);
  const [taps, setTaps] = useState<Tap[]>([]);
  const [asking, setAsking] = useState(true);
  const [showSteps, setShowSteps] = useState(false);
  const [osm, setOsm] = useState<{
    steps?: { did: string; ok: boolean; say: string }[];
    error?: string;
    fit?: Plan;
    parcel?: string | null;
    missing?: { street: string; side: string; short: number }[];
  } | null>(null);

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

  // Dragging gets the block within a few feet. Arrow keys get it onto the
  // concrete: a mouse cannot reliably move a map one metre, and one metre is
  // the difference between a home sitting on its pad and sitting on the road.
  useEffect(() => {
    if (!fitting) return;
    const on = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 5 : 1;
      const per = degreesPerMetre(plan.centre[1]);
      const go = (east: number, north: number) => {
        e.preventDefault();
        remember({ ...plan, centre: [
          plan.centre[0] + east * step * per.lng,
          plan.centre[1] + north * step * per.lat,
        ] });
      };
      if (e.key === "ArrowLeft") go(-1, 0);
      else if (e.key === "ArrowRight") go(1, 0);
      else if (e.key === "ArrowUp") go(0, 1);
      else if (e.key === "ArrowDown") go(0, -1);
      else if (e.key === "[") remember({ ...plan, bearing: (plan.bearing + 359.5) % 360 });
      else if (e.key === "]") remember({ ...plan, bearing: (plan.bearing + 0.5) % 360 });
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [fitting, plan, remember]);

  // The latest plan, for the one-shot effects that must not re-run every
  // time a slider moves.
  const planNow = useRef(plan);
  planNow.current = plan;

  const load = useCallback(async () => {
    const res = await fetch(`/api/properties/${propertyId}/plan`, { cache: "no-store" });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setError(out.error ?? "Could not load the park."); return; }
    setName(out.property?.name ?? "");
    setLots(out.lots ?? []);
  }, [propertyId]);
  useEffect(() => { void load(); }, [load]);

  // The outlines OpenStreetMap already has.
  //
  // Asked for once, in the background: the drawn block is on screen the
  // whole time, so this arriving late replaces a working map rather than
  // filling an empty one, and this failing leaves a working map rather than
  // nothing.
  //
  // Kept in the browser afterwards. Overpass is volunteer-run and takes ten
  // or twenty seconds on a good day; waiting that out every time the page
  // opens would make the real outlines feel worse than the drawn ones.
  const cache = `parkosm:${propertyId}`;
  useEffect(() => {
    let gone = false;
    try {
      const saved = localStorage.getItem(cache);
      if (saved) {
        const was = JSON.parse(saved) as RealPark & { at?: number };
        if (was?.homes?.length) { setReal(was); setAsking(false); }
      }
    } catch { /* a stale cache is not worth a broken page */ }

    (async () => {
      const res = await fetch(
        `/api/properties/${propertyId}/plan/osm?lng=${RETREAT.centre[0]}&lat=${RETREAT.centre[1]}`,
        { cache: "no-store" },
      ).catch(() => null);
      const out = await res?.json().catch(() => null);
      if (gone) return;
      setAsking(false);
      if (!out) { setOsm({ error: "No answer from OpenStreetMap." }); return; }
      setOsm(out);
      // Even a partial answer settles where the park sits: the roads alone
      // give the angle, the position and which street is which. Applied
      // before the outlines, so a map with no buildings in it still stops
      // being crooked.
      if (out.fit?.centre) {
        remember({
          ...planNow.current, centre: out.fit.centre, bearing: out.fit.bearing,
          streetGap: out.fit.streetGap, mirror: Boolean(out.fit.mirror),
        });
      }
      // The property line and the outlines are two different questions and
      // one can answer without the other, so whatever came back is used.
      if (out.boundary?.length || out.homes?.length) {
        const got: RealPark = {
          homes: out.homes ?? [], streets: out.streets ?? [],
          boundary: out.boundary ?? [], spare: out.spare ?? [],
          parcel: out.parcel ?? null,
        };
        setReal(got);
        try { localStorage.setItem(cache, JSON.stringify(got)); } catch { /* fine */ }
      }
    })();
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, cache]);

  const placed = useMemo<Placed[]>(() => (
    real
      ? real.homes.map((h) => ({
          id: h.id, label: h.label, street: h.street,
          side: "N" as const, lat: 0, lng: 0, bearing: 0,
        }))
      : layOut(plan)
  ), [plan, real]);
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
          {!real && (
            <button type="button" className={fitting ? "btn pri" : "btn"}
                    onClick={() => { setFitting((v) => !v); setSelected(null); setTaps([]); }}>
              {fitting ? "Done fitting" : "Fit to the aerial"}
            </button>
          )}
        </div>
      </header>

      {error && <p className="err">{error}</p>}

      {/* Where the outlines came from. Said once, plainly, because a park
          drawn from a description and a park drawn from the map look alike
          on screen and are not the same claim. */}
      {asking && !real && (
        <p className="parkhint">
          These are drawn from the park&rsquo;s own layout. Asking
          OpenStreetMap for the real streets and property line — it can take
          half a minute.
        </p>
      )}
      {!asking && (osm?.error || real) && (
        <p className="parkhint">
          {real?.homes?.length
            ? "Real outlines, from OpenStreetMap."
            : real?.boundary?.length && osm?.error
            ? "Showing the property line found earlier; this attempt did not get that far."
            : osm?.error ?? "Drawn from the park's own layout."}
          {real?.parcel && ` Property line: ${real.parcel}.`}
          {osm?.error && real?.boundary?.length ? ` ${osm.error}` : null}
          {osm?.missing?.length
            ? ` ${osm.missing.map((m) => `${m.street} is ${m.short} short`).join(", ")} — those lots aren't mapped there yet.`
            : null}
          {osm?.steps?.length ? (
            <> <button type="button" className="aslink"
                       onClick={() => setShowSteps((v) => !v)}>
              {showSteps ? "hide the steps" : "what it did"}
            </button></>
          ) : null}
        </p>
      )}
      {showSteps && osm?.steps?.length ? (
        <div className="pullout">
          <ol>
            {osm.steps.map((st, i) => (
              <li key={i} className={st.ok ? "ok" : "no"}>
                <strong>{st.did}</strong> — {st.say}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {fitting && (
        <div className="parkfit">
          <p className="parkhint">
            Switch to <strong>Aerial</strong>, then tap four homes in the
            photograph. That is enough to pin the whole park: two along one
            row give the angle and the spacing, and the other two give the
            width of the street and the distance to the next one.
          </p>
          <ol className="parktaps">
            {fitTargets(plan).map((want, i) => (
              <li key={want.id} className={taps[i] ? "done" : i === taps.length ? "now" : ""}>
                <strong>{want.label}</strong> {want.street}
                <span className="dim"> — {want.say}</span>
              </li>
            ))}
          </ol>
          <div className="invacts">
            <button type="button" className="btn" disabled={!taps.length}
                    onClick={() => setTaps((p) => p.slice(0, -1))}>
              Undo that tap
            </button>
            <button type="button" className="btn" onClick={() => { setTaps([]); remember(RETREAT); }}>
              Start over
            </button>
          </div>
          <details className="parkmanual">
            <summary>Or move it by hand</summary>
            <p className="parkhint">
              Drag anywhere on the map to slide the block. Arrow keys move it
              a metre at a time, Shift five, <kbd>[</kbd> and <kbd>]</kbd>
              turn it half a degree.
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
          </details>
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
          plan={plan} real={real} facts={facts}
          selected={selected} onSelect={setSelected}
          fitting={fitting} taps={taps}
          onTap={(at) => {
            const next = [...taps, at].slice(0, fitTargets(plan).length);
            setTaps(next);
            if (next.length >= 2) remember(fitFromTaps(plan, next));
          }}
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
