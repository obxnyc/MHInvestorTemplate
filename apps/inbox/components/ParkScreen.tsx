"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lot } from "./ParkPlan";
import ParkMap, { type LotFacts, type Owner, type RealPark } from "./ParkMap";
import LotCard from "./LotCard";
import { RETREAT, layOut, countOf, fitTargets, fitFromTaps,
         type Plan, type Placed, type Tap } from "@/lib/parkplan";
import { sameStreet, placeFromRoads, parkAround, orientedBox, fitInside, inRing, placeOn,
         type Shape, type Road } from "@/lib/osm";
import { layRows, reachTo, backRoad, streetLine } from "@/lib/rows";
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
  const [copied, setCopied] = useState(false);
  const [arranging, setArranging] = useState(false);
  /** Homes moved by hand, as an offset from where the layout put them.
   *  Kept as an offset rather than a position so that a better layout --
   *  or a corrected street -- still carries the corrections with it. */
  const [moved, setMoved] = useState<Record<string, [number, number]>>({});
  const [osm, setOsm] = useState<{
    error?: string;
    fit?: Plan;
    parcel?: string | null;
    built?: number;
    buildings?: number;
    missing?: { street: string; side: string; short: number }[];
  } | null>(null);

  // Where the block was dragged to last time. Kept in the browser rather
  // than the database so fitting works before the layout migrations have
  // been run -- the alternative is a map that cannot be corrected until
  // somebody opens a SQL editor.
  const key = `parkfit:${propertyId}`;
  const byHand = `parkmoved:${propertyId}`;
  /**
   * Corrections this browser is holding, in either of the two shapes
   * they have been stored in.
   *
   * They used to be offsets from wherever the layout had put the pad --
   * a few ten-thousandths of a degree -- and they are now the pad's own
   * position, which near Fayetteville is about -78.9 and 35.1. The two
   * are impossible to confuse: no lot on earth sits at a longitude of
   * 0.0004. Anything that small is an offset from the old scheme and is
   * converted the first time the park draws, rather than thrown away.
   */
  const oldShape = useRef<Record<string, [number, number]> | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(byHand);
      if (!saved) return;
      const was = JSON.parse(saved) as Record<string, [number, number]>;
      const nudges: Record<string, [number, number]> = {};
      const places: Record<string, [number, number]> = {};
      for (const [id, at] of Object.entries(was)) {
        if (!Array.isArray(at) || at.length !== 2) continue;
        if (Math.abs(at[0]) < 1 && Math.abs(at[1]) < 1) nudges[id] = at;
        else places[id] = at;
      }
      if (Object.keys(places).length) setMoved(places);
      if (Object.keys(nudges).length) oldShape.current = nudges;
    } catch { /* a park that forgets its corrections still draws */ }
  }, [byHand]);

  /**
   * A home dragged to a new spot.
   *
   * Kept as the pad's own position rather than as an offset from where
   * the layout put it, so that improving the layout cannot move a home
   * somebody has already corrected -- a correction is a statement about
   * the ground, not about the drawing.
   *
   * Written to the database as well as to the browser. Fifty one pads
   * dragged into place is an hour of somebody's evening, and keeping
   * that in local storage meant it lived on one machine in one browser
   * until something cleared it. The browser copy stays as the thing that
   * makes dragging feel instant, and as the fallback before the lots
   * exist on file.
   */
  const shownNow = useRef<RealPark | null>(null);
  const nudge = useCallback((id: string, at: [number, number], whole?: boolean) => {
    setMoved((was) => {
      const next = { ...was };
      const now = shownNow.current;
      const me = now?.homes.find((h) => h.id === id);
      if (whole && now && me) {
        // Everything in the same row moves by the same amount, so the
        // row stays straight, evenly spaced and parallel. Dragging a row
        // is the common correction; dragging one pad is the exception.
        const mid = middleOf(me.ring);
        const dx = at[0] - mid[0], dy = at[1] - mid[1];
        for (const h of now.homes) {
          if (h.street !== me.street || sideOf(h.id) !== sideOf(me.id)) continue;
          const c = middleOf(h.ring);
          next[h.id] = [c[0] + dx, c[1] + dy];
        }
      } else {
        next[id] = at;
      }
      try { localStorage.setItem(byHand, JSON.stringify(next)); } catch { /* fine */ }
      return next;
    });
  }, [byHand]);

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

  // Dragging the whole block gets it within a few feet. Arrow keys get
  // it onto the concrete: a mouse cannot reliably move a map one metre,
  // and one metre is the difference between a home on its pad and a home
  // in the road.
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

  /** The latest plan, for the one-shot effects that must not re-run every
   *  time a slider moves. */
  const planNow = useRef(plan);
  planNow.current = plan;

  const keep = useCallback((id: string, at: [number, number], whole?: boolean) => {
    const now = shownNow.current;
    const me = now?.homes.find((h) => h.id === id);
    const rows = whole && now && me
      ? now.homes.filter((h) => h.street === me.street && sideOf(h.id) === sideOf(me.id))
      : now?.homes.filter((h) => h.id === id) ?? [];
    for (const h of rows) {
      const label = h.id.split("|")[1] ?? "";
      if (!label) continue;
      const c = middleOf(h.ring);
      void fetch(`/api/properties/${propertyId}/plan`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "place", label, lng: c[0], lat: c[1] }),
      });
    }
  }, [propertyId]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/properties/${propertyId}/plan`, { cache: "no-store" });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setError(out.error ?? "Could not load the park."); return; }
    setName(out.property?.name ?? "");
    setLots(out.lots ?? []);
  }, [propertyId]);
  useEffect(() => { void load(); }, [load]);

  /**
   * What the map is carrying, as soon as it has loaded.
   *
   * Nothing is fetched here. The base map's own vector tiles bring the
   * buildings down as polygons and the streets as named lines, so the park
   * is lifted out of what is already on screen rather than drawn over it.
   * That is the whole difference: a picture laid over a map can be at the
   * wrong angle, and a thing taken out of the map cannot.
   */
  // What the map actually handed over, kept so it can be copied out.
  //
  // Every round of this has been: ship it, look at a screenshot, guess.
  // The streets and the boundary are a few kilobytes; pasted back once,
  // they can be tested against here before anything ships, which is the
  // difference between fixing this and guessing at it again.
  const [gave, setGave] = useState<string | null>(null);
  const took = useRef(false);
  const onHarvest = useCallback((found: {
    shapes: Shape[]; roads: Road[];
    areas: { name: string; ring: number[][] }[];
    lanes: number[][][];
  }) => {
    const base = planNow.current;
    setAsking(false);
    const mine = found.roads.filter((r) =>
      base.rows.some((row) => sameStreet(row.street, r.name)));
    if (!mine.length) {
      if (!took.current) {
        setOsm({
          error: `The map here has no ${[...new Set(base.rows.map((r) => r.street))].join(" or ")}. Nearest streets on it: ${nearby(found.roads).join(", ") || "none"}.`,
        });
      }
      return;
    }

    // Where the park is, and how far it reaches, taken from its own
    // streets and the property line around them.
    const fitted = placeFromRoads(base, mine) ?? base;
    const parcel = parkAround(found.areas, mine);
    const frontage = found.roads.find((r) => /pamalee/i.test(r.name))?.line ?? null;

    // The lots are laid along the streets rather than read off the map's
    // buildings. The map is good at streets and boundaries and bad at
    // this park's homes -- some are missing, some are the office or a
    // carport, some are two pads traced as one.
    const pads = layRows(fitted, mine, parcel?.ring ?? null, found.shapes);
    if (!pads.length) {
      setOsm({ error: "The map has the streets but nothing to lay a row along." });
      return;
    }

    // The property line is square, and its western perimeter is Pamalee
    // Drive. So it is the tightest rectangle that holds the homes, turned
    // to match them, with the Pamalee side pushed out to the road.
    //
    // Not the landuse polygon the map carries. That is somebody's tracing
    // of the back of a verge: it wandered, it left a field of empty land
    // behind the loop, and every odd corner in it had to be worked around
    // rather than drawn.
    // The road across the back, behind 3100 and 3101. The two streets are
    // one road that turns at the east end; the map traces that turn as an
    // arc, and on the ground it is square.
    const streetOrder = [...new Set(base.rows.map((r) => r.street))];
    let back = backRoad(pads, streetOrder, fitted.bearing);
    // Only drawn if the map has not got it. The park's roads are the
    // map's to draw -- a line of our own over a styled map looks like
    // what it is -- so this is the one stretch that is missing, and if
    // the map turns out to have it after all, nothing is added.
    const joinAt = back[1]?.[0];
    if (joinAt) {
      const mapHasIt = [...mine.map((r) => r.line), ...found.lanes]
        .flat()
        .some((q) => Math.hypot(
          (q[0] - joinAt[0]) / 0.0000110, (q[1] - joinAt[1]) / 0.0000090) < 18);
      if (mapHasIt) back = [];
    }
    // The carriageways, drawn down the middle of their own rows. Drawing
    // the traced geometry instead put a volunteer's wobble through a park
    // whose rows are dead straight, and brought the arc at the east end
    // with it, which reads as an oval where the ground is square.
    const ways = streetOrder
      .map((st) => streetLine(pads, st, fitted.bearing))
      .filter((line) => line.length >= 2);

    // Drawn round the homes AND the tarmac they stand on: the turning
    // circle at the east end reaches past the last home, and a box drawn
    // on the homes alone cut it off. Road points far from any home are
    // left out, so the streets running on past the park do not drag the
    // line out with them.
    const corners = pads.flatMap((p) => p.ring);
    // Both carriageways and the road across the back, all of them drawn
    // from the park itself, so every point of them belongs inside it.
    const tarmac = [...ways, ...back].flat();
    const boundary = reachTo(orientedBox([...corners, ...tarmac], 8), frontage);

    const fence = boundary.length ? boundary : null;

    remember(fitInside(fitted, boundary));
    setReal({
      homes: pads,
      streets: streetOrder.map((st, i) => ({ name: st, line: ways[i] ?? [] }))
        .filter((st) => st.line.length >= 2),
      boundary, lanes: back,
      parcel: "square to the homes, out to Pamalee Dr",
    });
    // How much of this is the map's doing and how much is arithmetic.
    // A row laid on real buildings sits on the pads; a row spread evenly
    // because the tiles had no buildings in them does not, and saying
    // which is which beats letting somebody work it out from the screen.
    const near = found.shapes.filter((sh) =>
      mine.some((r) => placeOn(r, sh.centre).metres <= 45)).length;
    setOsm({ built: near, buildings: found.shapes.length });
    const r = (v: number) => Number(v.toFixed(6));
    setGave(JSON.stringify({
      roads: mine.map((x) => ({ name: x.name, line: x.line.map((p) => [r(p[0]), r(p[1])]) })),
      parcel: boundary.map((p) => [r(p[0]), r(p[1])]),
      lanes: back.map((line) => line.map((p) => [r(p[0]), r(p[1])])),
      buildings: found.shapes.length,
    }));
    took.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remember]);

  /** The park as drawn, with the corrections applied. */
  const shown = useMemo<RealPark | null>(() => {
    if (!real) return null;
    // Where each lot has been put by hand: from the database where it is
    // on file, from this browser otherwise. The database wins, because
    // it is the copy that survives a cleared cache and reaches a second
    // machine.
    const onFile = new Map<string, [number, number]>();
    for (const l of lots) {
      if (l.lat != null && l.lng != null) onFile.set(norm(l.label), [l.lng, l.lat]);
    }
    if (!onFile.size && !Object.keys(moved).length) return real;

    return {
      ...real,
      homes: real.homes.map((h) => {
        const at = onFile.get(norm(`${h.label} ${h.street}`))
          ?? onFile.get(norm(h.label)) ?? moved[h.id];
        if (!at) return h;
        // The whole pad slid so its middle lands on the saved point.
        // Never turned: the ladder stays a ladder however much is moved.
        const mid = middleOf(h.ring);
        const dx = at[0] - mid[0], dy = at[1] - mid[1];
        return {
          ...h, moved: true,
          ring: h.ring.map((p) => [p[0] + dx, p[1] + dy]),
          dot: h.dot ? [h.dot[0] + dx, h.dot[1] + dy] as [number, number] : undefined,
        };
      }),
    };
  }, [real, moved, lots]);

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
      out[h.id] = lot
        ? { owner: ownerOf(lot), empty: emptyOf(lot), managed: Boolean(lot.manage), who: lot.tenant ?? undefined }
        : { owner: "none", empty: true, managed: false };
    }
    return out;
  }, [placed, match]);

  shownNow.current = shown;

  // Offsets saved under the old scheme, turned into positions the first
  // time there is a layout to measure them against -- and written
  // straight to the database, so an hour of dragging is not one cleared
  // cache away from gone a second time.
  const rescued = useRef(false);
  useEffect(() => {
    const was = oldShape.current;
    if (!was || rescued.current || !real?.homes?.length) return;
    rescued.current = true;
    const places: Record<string, [number, number]> = {};
    for (const h of real.homes) {
      const by = was[h.id];
      if (!by) continue;
      const mid = middleOf(h.ring);
      places[h.id] = [mid[0] + by[0], mid[1] + by[1]];
    }
    if (!Object.keys(places).length) return;
    setMoved((now) => {
      const next = { ...places, ...now };
      try { localStorage.setItem(byHand, JSON.stringify(next)); } catch { /* fine */ }
      return next;
    });
    for (const [id, at] of Object.entries(places)) {
      const label = id.split("|")[1] ?? "";
      if (!label) continue;
      void fetch(`/api/properties/${propertyId}/plan`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "place", label, lng: at[0], lat: at[1] }),
      });
    }
  }, [real, byHand, propertyId]);

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
          {real && (
            <button type="button" className={arranging ? "btn pri" : "btn"}
                    onClick={() => { setArranging((v) => !v); setSelected(null); }}>
              {arranging ? "Done moving" : "Move homes"}
            </button>
          )}
          {real && arranging && Object.keys(moved).length > 0 && (
            <button type="button" className="btn" onClick={() => {
              setMoved({});
              try { localStorage.removeItem(byHand); } catch { /* fine */ }
              void fetch(`/api/properties/${propertyId}/plan`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "unplace" }),
              }).then(() => load());
            }}>
              Put them all back
            </button>
          )}
          {!real && (
            <button type="button" className={fitting ? "btn pri" : "btn"}
                    onClick={() => { setFitting((v) => !v); setSelected(null); setTaps([]); }}>
              {fitting ? "Done fitting" : "Fit to the aerial"}
            </button>
          )}
        </div>
      </header>

      {error && <p className="err">{error}</p>}

      {arranging && (
        <p className="parkhint">
          Drag any home to move it, or hold <kbd>Shift</kbd> and drag to
          take the whole row with you — four drags instead of fifty one.
          A drag only ever slides a pad, so the ladder stays a ladder, and
          what you move is saved the moment you let go.
          {Object.keys(moved).length
            ? ` ${Object.keys(moved).length} moved so far, outlined in orange.`
            : ""}
        </p>
      )}

      {/* Where the outlines came from. Said once, plainly, because a park
          drawn from a description and a park drawn from the map look alike
          on screen and are not the same claim. */}
      {asking && !real && (
        <p className="parkhint">
          Reading the park off the map — the homes and the streets come down
          with the map itself, so give the tiles a moment.
        </p>
      )}
      {!asking && (osm?.error || real) && (
        <p className="parkhint">
          {real?.homes?.length ? (
            <>
              <strong>All {real.homes.length} lots</strong>, laid along Lady
              Viola and Lady Cheryl inside the property line, numbered down
              from the Pamalee entrance. Every pad is the same rectangle,
              because every home here is the same model.
              {osm?.built
                ? ` ${osm.built} of them sit on a building the map has.`
                : " The map has no buildings here, so they are spread evenly along the streets — drag them onto the pads and they will stay."}
            </>
          ) : osm?.error ?? "Drawn from the park's own layout."}
          {gave ? (
            <>
              {" "}
              <button type="button" className="aslink" onClick={() => {
                void navigator.clipboard.writeText(gave).then(
                  () => setCopied(true), () => setCopied(false),
                );
              }}>
                {copied ? "copied — paste it to me" : "copy the map data"}
              </button>
            </>
          ) : null}
        </p>
      )}

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
          plan={plan} real={shown} facts={facts} onHarvest={onHarvest}
          arranging={arranging} onNudge={nudge} onDropped={keep}
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
        <li><i className="sw sw-poh" /> Park owned</li>
        <li><i className="sw sw-toh" /> Tenant owned</li>
        <li><i className="sw sw-ioh" /> Investor owned</li>
        <li><i className="sw sw-pale" /> Pale = home empty</li>
        <li><i className="sw sw-bare" /> Dashed = bare lot</li>
        <li><i className="dotkey" /> We manage it</li>
      </ul>

      {/* What is left to sell, which is the question the owner opened
          this screen to answer. A park-owned home is one we can sell; a
          tenant's or an investor's is not ours to sell. */}
      <p className="parktally">
        {(() => {
          const all = Object.values(facts);
          const n = (o: Owner) => all.filter((f) => f.owner === o).length;
          const sellable = all.filter((f) => f.owner === "poh").length;
          const empty = all.filter((f) => f.owner === "poh" && f.empty).length;
          return (
            <>
              <strong>{sellable} of {all.length} are ours to sell</strong>
              {empty ? `, ${empty} of them standing empty` : ""}.{" "}
              {n("toh")} tenant owned, {n("ioh")} investor owned,{" "}
              {n("none")} bare lots.
            </>
          );
        })()}
      </p>

    </div>
  );
}

/**
 * Who owns the home on the pad.
 *
 * Taken from the unit where somebody has said, and worked out from the
 * sale record where they have not -- a live sale to an investor is an
 * investor-owned home whatever anybody has ticked, and a pad with
 * neither a sale nor a flag has no home on it.
 */
function ownerOf(lot: Lot): Owner {
  if (lot.kind && lot.kind !== "none") return lot.kind;
  if (lot.sale) return "ioh";
  return lot.kind === "none" ? "none" : lot.tenant ? "poh" : "none";
}

/** A home with nobody in it. A bare pad is not empty -- there is nothing
 *  there to be empty. */
function emptyOf(lot: Lot): boolean {
  return !lot.tenant;
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

/** Which side of its street a lot is on, from the row it was laid in.
 *  Carried on the home rather than looked up, because the id is all the
 *  map hands back when something is dragged. */
function sideOf(id: string): string {
  return id.split("|")[0] ?? "";
}

/** The middle of a closed ring. */
function middleOf(ring: number[][]): [number, number] {
  const n = Math.max(1, ring.length - 1);
  return [
    ring.slice(0, n).reduce((a, p) => a + p[0], 0) / n,
    ring.slice(0, n).reduce((a, p) => a + p[1], 0) / n,
  ];
}

/** The street names the map does have here. An error that names the
 *  neighbours is a fixable error; "not found" is another week of guessing. */
function nearby(roads: Road[], howMany = 6): string[] {
  return [...new Set(roads.map((r) => r.name))].slice(0, howMany);
}

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
