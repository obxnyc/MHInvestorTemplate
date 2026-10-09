"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lot } from "./ParkPlan";
import ParkMap, { type LotFacts, type Owner, type RealPark } from "./ParkMap";
import LotCard from "./LotCard";
import { RETREAT, builtInFor, filedAs, layOut, countOf, fitTargets, fitFromTaps,
         boundaryOf, streetLines, placed as placedRow,
         type Plan, type Placed, type Tap } from "@/lib/parkplan";
import { sameStreet, placeFromRoads, parkAround, orientedBox, fitInside, inRing, placeOn,
         type Shape, type Road } from "@/lib/osm";
import { layRows, reachTo, backRoad, streetLine } from "@/lib/rows";
import { degreesPerMetre, middleOfRing, footprint } from "@/lib/footprint";

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
 * sits and which way it points. That is "Fit to aerial": drag the block
 * onto the pads in the photograph, turn it until the rows line up, done once.
 */
/**
 * A park before anybody has said what it is.
 *
 * The spacings off Cross Creek, because a single-wide is a single-wide
 * and 14 metres apart is a reasonable first guess anywhere. But no
 * rows: Cross Creek's fifty one lots belong to Cross Creek.
 *
 * This exists because the screen used to START as Cross Creek, and the
 * map reads the ground as soon as it loads -- before the database has
 * said which park this is. So a park in Pasquotank was harvested as
 * Cross Creek, and nothing afterwards threw that away: the plan
 * arrived, the heading and the lot count changed, and the fifty one
 * pads on screen stayed exactly where they were. "51 of 40 lots" was
 * the two of them disagreeing out loud.
 */
const EMPTY: Plan = { ...RETREAT, rows: [] };

/**
 * How far one press moves a home, in metres.
 *
 * A drag gets a pad to about the right place. Getting it level with its
 * neighbour is three or four pixels at the zoom that shows a whole park,
 * and three or four pixels with a mouse is luck -- which is what "not
 * able to move these easily" was about. Half a metre is small enough
 * that no keystroke can lose a home and large enough that squaring a pad
 * up is a press or two rather than twenty.
 */
const STEP = 0.5;

export default function ParkScreen({ propertyId }: { propertyId: string }) {
  const [lots, setLots] = useState<Lot[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [fitting, setFitting] = useState(false);
  /**
   * Placing each row by tapping its two ends.
   *
   * The grid -- one bearing, one spacing -- draws a park somebody laid
   * out on paper. A park that grew is several groups at their own
   * angles, and no slider can turn one into the other. Two taps say
   * where a row begins and ends, and everything about that row follows
   * from them.
   */
  const [laying, setLaying] = useState(false);
  const [onRow, setOnRow] = useState(0);
  const [end, setEnd] = useState<Tap | null>(null);
  /**
   * The property line, drawn corner by corner.
   *
   * The county's own line is better where it can be had, and sometimes
   * it cannot: the parcel is keyed on a number nobody has, the service
   * wants a sign-in, or the deed line and the fence on the ground are
   * not the same thing. A line traced off the photograph is then the
   * best answer available, and waiting for a better one leaves the park
   * in a box drawn round wherever the homes happened to land.
   */
  const [fencing, setFencing] = useState(false);
  const [corners, setCorners] = useState<Tap[]>([]);
  /** The boundary as it is on file, so abandoning a redraw restores it. */
  const planSaved = useRef<number[][] | undefined>(undefined);

  /** The corners as a closed ring, or nothing while there are too few
   *  of them to be a shape. */
  const asRing = useCallback((pts: Tap[]) => (
    pts.length >= 3 ? [...pts, pts[0]].map((q) => [q[0], q[1]]) : undefined
  ), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * How this park is laid out.
   *
   * From the database where somebody has described it, from this browser
   * where they are mid-way through, and only then from the one park
   * written into the code. That last fallback is the reason a second
   * park opened showing the first one's streets, so it is kept only
   * until the park has a plan of its own and never written back over
   * one.
   */
  const [plan, setPlan] = useState<Plan>(EMPTY);
  /** Whether this park has a layout on file, or is still the default. */
  const [described, setDescribed] = useState<boolean | null>(null);
  /** Whether 035 has been run. Without it a layout cannot be saved at
   *  all, and the screen said nothing -- so laying out a park appeared
   *  to work and then came back empty. */
  const [canKeep, setCanKeep] = useState(true);
  /** What the tiles carried: buildings, named streets, a boundary. Null
   *  on a basemap that has nothing here, which is most rural counties. */
  const [harvested, setHarvested] = useState<RealPark | null>(null);
  const [taps, setTaps] = useState<Tap[]>([]);
  const [asking, setAsking] = useState(true);
  const [copied, setCopied] = useState(false);
  const [arranging, setArranging] = useState(false);
  /** Whether a press moves one home or the row it stands in. The same
   *  question Shift answers while dragging, asked once instead of held
   *  down -- a modifier you have to hold is a modifier you cannot use
   *  on a tablet in a driveway. */
  const [wholeRow, setWholeRow] = useState(false);
  /** The lot number being retyped. Empty when nothing is being renamed. */
  const [renaming, setRenaming] = useState("");
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
    rescued?: number;
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
        if (!mid) return was;
        const dx = at[0] - mid[0], dy = at[1] - mid[1];
        for (const h of now.homes) {
          if (h.street !== me.street || sideOf(h.id) !== sideOf(me.id)) continue;
          const c = middleOf(h.ring);
          if (!c) continue;
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
    // Only before the park's own plan has arrived. This cache was
    // written by the fitting that ran on load, which happened while the
    // screen still held the default park -- so it holds that park's
    // CENTRE, and applying it over a plan fetched from the database
    // moved a park in Pasquotank back to Fayetteville on every reload,
    // with the right streets named above the wrong ground.
    //
    // The database is the park. This is a convenience for the keystroke
    // after the last one, and it does not get a vote once the answer
    // is known.
    // Once, on the way in. Re-running this after the park's own plan
    // has loaded would put the stale centre straight back.
  }, [key]);

  /**
   * The layout, changed.
   *
   * Written to the browser for the next keystroke and to the park for
   * everything after that. The browser copy makes dragging feel instant;
   * the park copy is the one that survives a cleared cache, reaches a
   * second machine, and stops this park drawing some other park's
   * streets -- which is the whole reason the plan moved out of the code.
   *
   * Debounced, because this fires on every arrow key and every drag of a
   * slider, and a write per keystroke is a write per keystroke.
   */
  const saving = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (saving.current) clearTimeout(saving.current); }, []);
  /**
   * Whether this park has a layout of its own, for the saving path to
   * read without waiting for a render.
   *
   * A ref as well as state, because the fitting that runs when the map
   * loads happens before React has caught up, and it was that fitting
   * that wrote Cross Creek's streets onto a park nobody had described.
   */
  const own = useRef(false);
  const remember = useCallback((next: Plan, auto = false) => {
    setPlan(next);
    try {
      localStorage.setItem(key, JSON.stringify({
        centre: next.centre, bearing: next.bearing,
        padSpacing: next.padSpacing, pairGap: next.pairGap, streetGap: next.streetGap,
      }));
    } catch { /* unsaved is survivable; unmovable is not */ }

    // Only a deliberate change is this park's answer. Fitting the block
    // to whatever the map handed over runs by itself the moment the page
    // opens, and when that saved, opening a brand new park wrote the
    // other park's streets and numbers onto it and then reported it as
    // described -- so the form that would have asked never appeared.
    if (auto || !own.current) return;

    if (saving.current) clearTimeout(saving.current);
    saving.current = setTimeout(() => {
      void fetch(`/api/properties/${propertyId}/plan`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "plan", plan: next }),
      }).catch(() => null);
    }, 800);
  }, [key, propertyId]);


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

  /**
   * A dragged home written to the database.
   *
   * The lot is named by number AND street, because that is the label it
   * is on file under -- `3124 Lady Viola Dr`, not `3124`. Sending the
   * bare number updated no rows and said it had worked, which is how an
   * hour of dragging came to be held in one browser and nowhere else.
   *
   * A save that finds no such lot now says so, rather than failing in
   * silence until the browser is cleared.
   */
  const keep = useCallback((id: string, at: [number, number], whole?: boolean) => {
    const now = shownNow.current;
    const me = now?.homes.find((h) => h.id === id);
    const rows = whole && now && me
      ? now.homes.filter((h) => h.street === me.street && sideOf(h.id) === sideOf(me.id))
      : now?.homes.filter((h) => h.id === id) ?? [];
    void (async () => {
      let missed = 0;
      for (const h of rows) {
        const c = middleOf(h.ring);
        // A pad with no shape has no position to save, and sending one
        // anyway would write a home onto the equator.
        if (!c) { missed += 1; continue; }
        const res = await fetch(`/api/properties/${propertyId}/plan`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "place", label: h.filed, lng: c[0], lat: c[1],
          }),
        }).catch(() => null);
        if (!res?.ok) missed += 1;
      }
      if (missed) {
        setError(
          `Moved on screen, but ${missed === rows.length ? "not saved" : `${missed} not saved`}`
          + " — these lots are not on file yet. Press Add lots and move them again.",
        );
      } else {
        setError(null);
      }
    })();
  }, [propertyId]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/properties/${propertyId}/plan`, { cache: "no-store" });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setError(out.error ?? "Could not load the park."); return; }
    setName(out.property?.name ?? "");
    setLots(out.lots ?? []);
    setCanKeep(out.plans !== false);
    let mine = out.property?.plan as Plan | null | undefined;

    // A park with no plan of its own may still be one this code already
    // describes -- Cross Creek was laid out before a plan could be
    // stored, so it had fifty one lots, an hour of dragging saved
    // against them, and nothing to draw them with. It is recognised by
    // its lot labels and adopts the description once, after which it
    // owns it like any other park.
    if (!mine?.rows?.length) {
      const known = builtInFor((out.lots ?? []).map((l: Lot) => l.label));
      if (known) {
        mine = known;
        void fetch(`/api/properties/${propertyId}/plan`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "plan", plan: known }),
        }).catch(() => null);
      }
    }

    const has = Boolean(mine?.rows?.length);
    own.current = has;
    setDescribed(has);
    if (mine?.rows?.length) {
      setPlan(mine);
      planNow.current = mine;
      // Overwrite the browser's copy with what is on file, so a stale
      // centre cannot come back the next time this page opens.
      try {
        localStorage.setItem(key, JSON.stringify({
          centre: mine.centre, bearing: mine.bearing,
          padSpacing: mine.padSpacing, pairGap: mine.pairGap,
          streetGap: mine.streetGap,
        }));
      } catch { /* fine */ }
    }
  }, [propertyId, key]);
  useEffect(() => { void load(); }, [load]);

  /** A park described for the first time, or re-described. */
  const describeIt = useCallback(async (next: Plan) => {
    setError(null);

    // The park as harvested is the OLD park. The map reads the tiles
    // once and remembers that it has, so re-describing a property left
    // the previous park's pads on screen -- Cross Creek's numbers, over
    // Cross Creek's ground, under a sentence naming the new park's
    // streets. Throwing it away makes the map read the tiles again,
    // where the new plan now says to look.
    setHarvested(null);
    setOsm(null);
    setGave(null);
    took.current = false;

    setPlan(next);
    planNow.current = next;
    const res = await fetch(`/api/properties/${propertyId}/plan`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "plan", plan: next }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    if (!res?.ok) {
      // Drawn either way -- the work is not lost while this is sorted
      // out -- but not claimed as saved, because it was not.
      own.current = false;
      setDescribed(true);
      setError(out.error ?? "The layout is on screen but could not be saved.");
      return;
    }
    own.current = true;
    setDescribed(true);
    await load();
  }, [propertyId, load]);

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
    // The road the park's line runs out to, where the park names one.
    const edge = base.frontage?.trim();
    const frontage = edge
      ? found.roads.find((r) => sameStreet(edge, r.name))?.line ?? null
      : null;

    // The lots are laid along the streets rather than read off the map's
    // buildings. The map is good at streets and boundaries and bad at
    // this park's homes -- some are missing, some are the office or a
    // carport, some are two pads traced as one.
    const pads = layRows(fitted, mine, parcel?.ring ?? null, found.shapes);
    if (!pads.length) {
      setOsm({ error: "The map has the streets but nothing to lay a row along." });
      return;
    }

    // The line is the tightest rectangle that holds the homes, turned to
    // match them, and pushed out to the frontage road where the park
    // names one.
    //
    // Not the landuse polygon the map carries. That is somebody's tracing
    // of the back of a verge: it wandered, it left a field of empty land
    // behind the loop, and every odd corner in it had to be worked around
    // rather than drawn.
    //
    // The road across the back, where two streets are one road that
    // turns at the far end: the map traces that turn as an arc and on
    // the ground it is square.
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

    // Not when the county has given us the line. Fitting the block to
    // whatever the tiles happened to carry would walk it off a boundary
    // that is a statement about the deed.
    remember(base.fence?.length ? fitted : fitInside(fitted, boundary), true);
    setHarvested({
      homes: pads.map((h) => ({ ...h, filed: filedAs(base, h.label, h.street) })),
      streets: streetOrder.map((st, i) => ({ name: st, line: ways[i] ?? [] }))
        .filter((st) => st.line.length >= 2),
      boundary, lanes: back,
      parcel: base.fence?.length
        ? `the county's line${base.pin ? `, parcel ${base.pin}` : ""}`
        : edge ? `square to the homes, out to ${edge}`
        : "square to the homes",
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

  /**
   * The park drawn from its own plan, when the map had nothing to hand
   * over.
   *
   * `real` is what the tiles carried: buildings, named streets, a
   * boundary. Pasquotank's basemap carries none of that for Northside,
   * so `real` stayed null -- and everything that works ON a home hung
   * off it. The homes drew, because the map falls back to the plan for
   * drawing, and that is exactly what made it baffling: fifty-nine pads
   * on screen, no Move homes button, a drag that saved nothing and a
   * nudge that found no home to nudge.
   *
   * A park drawn from its own description is no less a park. It just was
   * not read off a photograph.
   */
  const asPlanned = useMemo<RealPark | null>(() => {
    if (!plan.rows.length) return null;
    return {
      homes: layOut(plan).map((h) => ({
        id: h.id, label: h.label, street: h.street, filed: h.filed,
        ring: footprint(h.lat, h.lng, h.bearing, plan.size),
      })),
      streets: streetLines(plan),
      boundary: plan.fence?.length ? plan.fence : boundaryOf(plan),
      lanes: [],
    };
  }, [plan]);

  /**
   * The park, however it came to be known.
   *
   * The map's reading of the ground when there is one, the plan's own
   * drawing otherwise. Everything downstream -- moving a home, saving
   * where it went, the lot cards -- works on this, so none of it
   * depends any more on whether a basemap happened to have the park.
   */
  const real = harvested ?? asPlanned;

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
        const at = onFile.get(norm(h.filed))
          ?? onFile.get(norm(h.label)) ?? moved[h.id];
        if (!at) return h;
        // The whole pad slid so its middle lands on the saved point.
        // Never turned: the ladder stays a ladder however much is moved.
        const mid = middleOf(h.ring);
        if (!mid) return h;
        const dx = at[0] - mid[0], dy = at[1] - mid[1];
        return {
          ...h, moved: true,
          ring: h.ring.map((p) => [p[0] + dx, p[1] + dy]),
          dot: h.dot ? [h.dot[0] + dx, h.dot[1] + dy] as [number, number] : undefined,
        };
      }),
    };
  }, [real, moved, lots]);

  /**
   * The plan as drawn.
   *
   * A park nobody has described has no homes, so none are drawn. It held
   * Cross Creek's plan as a starting point and drew Cross Creek's fifty
   * one lots on top of a park in another county -- with Lady Viola Dr
   * labelled across it -- which reads as this park being wrong rather
   * than as this park being unknown.
   */
  const blank = described !== true;
  const drawn = useMemo<Plan>(
    () => (blank ? { ...plan, rows: [] } : plan), [blank, plan]);

  const placed = useMemo<Placed[]>(() => (
    real
      ? real.homes.map((h) => ({
          id: h.id, label: h.label, filed: h.filed, street: h.street,
          side: "N" as const, lat: 0, lng: 0, bearing: 0,
        }))
      : layOut(drawn)
  ), [drawn, real]);
  const match = useMemo(() => pair(placed, lots), [placed, lots]);

  const facts: LotFacts = useMemo(() => {
    const out: LotFacts = {};
    for (const h of placed) {
      const lot = match.get(h.id);
      out[h.id] = lot
        ? {
            owner: ownerOf(lot), empty: emptyOf(lot),
            managed: Boolean(lot.manage), use: lot.use ?? null,
            who: lot.tenant ?? undefined,
          }
        : { owner: "none", empty: true, managed: false, use: null };
    }
    return out;
  }, [placed, match]);

  shownNow.current = shown;

  // Offsets saved under the old scheme, turned into positions and put
  // somewhere that survives.
  //
  // Carefully, because this is somebody's only remaining copy. The
  // original is kept under its own key before anything is touched; the
  // lots are put on file first, since a position cannot be saved against
  // a lot that does not exist; and the converted form only replaces the
  // original once the database has taken it. A conversion that overwrote
  // the offsets and then failed to save would destroy the last copy of
  // an hour's work, which is the mistake that got us here.
  const rescued = useRef(false);
  useEffect(() => {
    const was = oldShape.current;
    if (!was || rescued.current || !real?.homes?.length) return;
    rescued.current = true;

    void (async () => {
      try { localStorage.setItem(`${byHand}:asdragged`, JSON.stringify(was)); } catch { /* fine */ }

      const places: Record<string, [number, number]> = {};
      for (const h of real.homes) {
        const by = was[h.id];
        if (!by) continue;
        const mid = middleOf(h.ring);
        if (!mid) continue;
        places[h.id] = [mid[0] + by[0], mid[1] + by[1]];
      }
      if (!Object.keys(places).length) return;

      // Showing them is instant and costs nothing if the saving fails.
      setMoved((now) => ({ ...places, ...now }));

      // The lots have to exist before a position can be hung on one.
      await fetch(`/api/properties/${propertyId}/plan`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "seed",
          labels: real.homes.map((h) => h.filed),
        }),
      }).catch(() => null);

      let saved = 0;
      let why = "";
      for (const h of real.homes) {
        const at = places[h.id];
        if (!at) continue;
        const res = await fetch(`/api/properties/${propertyId}/plan`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "place", label: h.filed, lng: at[0], lat: at[1],
          }),
        }).catch(() => null);
        if (res?.ok) saved += 1;
        else if (!why) {
          const out = await res?.json().catch(() => ({})) ?? {};
          why = String(out.error ?? "");
        }
      }

      if (saved) {
        // Only now is the old form replaced, and only because there is
        // a copy of it in the database.
        try { localStorage.setItem(byHand, JSON.stringify(places)); } catch { /* fine */ }
        setOsm((o) => ({ ...(o ?? {}), rescued: saved }));
        await load();
      } else {
        setError(
          "Your moved homes are back on screen but could not be saved"
          + (why ? ` — ${why}` : "")
          + ". Don't clear this browser. Press Download, then Add lots.",
        );
      }
    })();
  }, [real, byHand, propertyId, load]);

  /**
   * Corrections held in this browser, written to the park.
   *
   * A home dragged before the lot existed had nowhere to be saved, and
   * a home dragged while the saving was sending the wrong label was not
   * saved either. Both leave the same state: the browser knows where
   * fifty one homes go and the database does not, and the first cleared
   * cache loses the lot of it.
   *
   * So the two are reconciled whenever the park draws. Every home this
   * browser has a position for, that the database has no position for
   * or a different one, is written. It runs once per load and settles
   * immediately, because after the write the two agree.
   */
  const [synced, setSynced] = useState<{ saved: number; of: number } | null>(null);
  const syncing = useRef(false);
  useEffect(() => {
    if (syncing.current || !real?.homes?.length || !lots.length) return;
    const mine = Object.keys(moved).length;
    if (!mine) return;

    const onFile = new Map<string, [number, number]>();
    for (const l of lots) {
      if (l.lat != null && l.lng != null) onFile.set(norm(l.label), [l.lng, l.lat]);
    }
    // A tenth of a metre. Below that the two copies agree and writing
    // again would only make the effect run forever.
    const same = (a: [number, number], b: [number, number]) =>
      Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

    const todo: { label: string; at: [number, number] }[] = [];
    for (const h of real.homes) {
      const at = moved[h.id];
      if (!at) continue;
      const label = h.filed;
      const have = onFile.get(norm(label));
      if (have && same(have, at)) continue;
      todo.push({ label, at });
    }
    if (!todo.length) { setSynced({ saved: mine, of: mine }); return; }

    syncing.current = true;
    void (async () => {
      let saved = 0;
      for (const { label, at } of todo) {
        const res = await fetch(`/api/properties/${propertyId}/plan`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "place", label, lng: at[0], lat: at[1] }),
        }).catch(() => null);
        if (res?.ok) saved += 1;
      }
      setSynced({ saved: saved + (mine - todo.length), of: mine });
      syncing.current = false;
      if (saved) await load();
    })();
  }, [real, lots, moved, propertyId, load]);

  /**
   * Put the lots on file, and the corrections on the lots.
   *
   * Adding the lots and saving where they sit have to be one button.
   * Before the lots exist there is nothing for a position to hang on,
   * so a park dragged into shape and then seeded had the shape in the
   * browser and the lots in the database and no join between them --
   * which lasted until the browser was cleared.
   */
  async function addThem() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/properties/${propertyId}/plan`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "seed", labels: missing.map((h) => h.filed),
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(false); setError(out.error ?? "That didn't save."); return; }

    // Every home that has been moved by hand, written against the lot
    // that now exists for it.
    let saved = 0, missed = 0;
    for (const h of shown?.homes ?? []) {
      if (!moved[h.id]) continue;
      const c = middleOf(h.ring);
      if (!c) { missed += 1; continue; }
      const r = await fetch(`/api/properties/${propertyId}/plan`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "place", label: h.filed, lng: c[0], lat: c[1],
        }),
      }).catch(() => null);
      if (r?.ok) saved += 1; else missed += 1;
    }
    setBusy(false);
    if (missed) {
      setError(`${saved} homes saved, ${missed} could not be. Press Download`
               + " and send me the file before closing this.");
    }
    await load();
  }

  /**
   * One home, moved by a stated distance rather than by hand.
   *
   * Takes the home where it is now and puts it half a metre on, which is
   * a thing a keystroke can do and a mouse cannot. `whole` means the
   * same here as it does while dragging -- the row goes with it -- so
   * there is one rule for the modifier rather than two.
   *
   * The database is written once the pressing stops. An arrow key held
   * down is thirty presses a second, and a POST for each of them is a
   * park's worth of writes to move one pad a metre.
   */
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (settling.current) clearTimeout(settling.current); }, []);
  const shift = useCallback((id: string, east: number, north: number, whole = false) => {
    const now = shownNow.current;
    const me = now?.homes.find((h) => h.id === id);
    if (!me) return;
    const mid = middleOf(me.ring);
    if (!mid) return;
    const per = degreesPerMetre(mid[1]);
    const at: [number, number] = [mid[0] + east * per.lng, mid[1] + north * per.lat];
    nudge(id, at, whole);
    if (settling.current) clearTimeout(settling.current);
    settling.current = setTimeout(() => { settling.current = null; keep(id, at, whole); }, 500);
  }, [nudge, keep]);

  /**
   * The arrow keys, while a home is chosen and the park is being moved.
   *
   * Taken from the window rather than from the map, because the thing
   * being aimed at is on the map but the focus is usually on the button
   * that was just pressed. Given back the moment a text box has the
   * focus -- an arrow key inside an input belongs to the input.
   */
  useEffect(() => {
    if (!arranging || !selected) return;
    const WAY: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
    };
    const press = (e: KeyboardEvent) => {
      const way = WAY[e.key];
      if (!way || e.metaKey || e.ctrlKey || e.altKey) return;
      const on = e.target as HTMLElement | null;
      const tag = on?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
          || on?.isContentEditable) return;
      e.preventDefault();
      shift(selected, way[0] * STEP, way[1] * STEP, e.shiftKey || wholeRow);
    };
    window.addEventListener("keydown", press);
    return () => window.removeEventListener("keydown", press);
  }, [arranging, selected, wholeRow, shift]);

  const here = placed.find((h) => h.id === selected) ?? null;
  const open = here ? match.get(here.id) ?? null : null;
  /** Where in the park the chosen home sits, so the next one along is a
   *  button rather than a hunt for a twelve-pixel rectangle. */
  const nth = here ? placed.findIndex((h) => h.id === here.id) : -1;
  /** While homes are being moved the panel of nudge buttons takes the
   *  card's place. A card opening over the park you are arranging is in
   *  the way, which is why choosing a home used to do nothing here at
   *  all -- and that left nothing for a key or a button to aim at. */
  /**
   * Pads standing outside the property line.
   *
   * A park drawn at the wrong spacing runs off its own deed, and on a
   * plain basemap that looks like a park -- two tidy rows of numbered
   * rectangles, over somebody else's field. It is only wrong if you
   * happen to notice the blue line. So it is counted and said.
   */
  const outside = useMemo(() => {
    const ring = plan.fence;
    if (!ring || ring.length < 4) return 0;
    const mids = shown?.homes?.length
      ? shown.homes.map((h) => middleOf(h.ring))
      : layOut(drawn).map((h) => [h.lng, h.lat] as [number, number]);
    return mids.filter((m) => m && !inRing(m, ring)).length;
  }, [plan.fence, shown, drawn]);

  const card = arranging ? null : open;
  const pad = arranging ? here : null;
  // The box starts as the number it is about to change, and belongs to
  // the home it was typed for. Starting it empty and falling back to the
  // label for display meant backspacing to nothing put the old number
  // straight back, so the box could not be cleared.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setRenaming(pad?.label ?? ""); }, [selected]);
  const missing = placed.filter((h) => !match.has(h.id));
  /** On file, but nobody has said whose home stands on it. */
  const unanswered = placed.filter((h) => {
    const lot = match.get(h.id);
    return lot && (!lot.kind || lot.kind === "none");
  });

  /**
   * A lot, renumbered.
   *
   * The number is kept twice -- on the unit, which is what a sale or a
   * lease hangs off, and in the plan, which is what the map draws -- so
   * both are written or neither is. A position already saved against
   * the lot travels with it: it is a column on that same row.
   */
  async function renumber(lot: Placed, to: string) {
    const was = lot.label;
    const want = to.trim();
    if (!want || want === was) return;
    // The number lives in two places. If the plan does not carry this
    // one, renaming the unit alone leaves the map drawing the old number
    // over a lot that is no longer on file under it -- which reads as
    // the lot having vanished.
    if (!plan.rows.some((r) => r.street === lot.street && r.numbers.includes(was))) {
      setError(`Lot ${was} is not in this park's plan, so renaming it here`
               + " would leave the map and the file disagreeing."
               + " Describe the park's rows first.");
      return;
    }
    const done = await post({
      action: "rename", from: lot.filed, to: filedAs(plan, want, lot.street),
    });
    if (!done) return;
    const rows = plan.rows.map((r) => (
      r.street === lot.street && r.numbers.includes(was)
        ? { ...r, numbers: r.numbers.map((x) => (x === was ? want : x)) }
        : r));
    remember({ ...plan, rows });
    // The browser's note of where this pad was put is keyed by the
    // number, so it follows the number.
    const now = `${lot.street}|${want}`;
    setMoved((had) => {
      if (!had[lot.id]) return had;
      const next = { ...had };
      next[now] = had[lot.id];
      delete next[lot.id];
      try { localStorage.setItem(byHand, JSON.stringify(next)); } catch { /* fine */ }
      return next;
    });
    setSelected(now);
    setRenaming("");
  }

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
              {arranging ? "Done" : "Move homes"}
            </button>
          )}
          {Object.keys(moved).length > 0 && (
            <button type="button" className="btn" onClick={() => {
              // Somebody's evening, in a file they keep. The browser is
              // not a safe place to hold the only copy of anything.
              const blob = new Blob([JSON.stringify(moved, null, 2)],
                                    { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `moved-homes-${propertyId}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}>
              Download
            </button>
          )}
          {real && arranging && Object.keys(moved).length > 0 && (
            <button type="button" className="btn" onClick={() => {
              const n = Object.keys(moved).length;
              if (!confirm(`Put all ${n} homes back where the layout wants them? `
                           + "Your moves are lost.")) return;
              setMoved({});
              try { localStorage.removeItem(byHand); } catch { /* fine */ }
              void fetch(`/api/properties/${propertyId}/plan`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "unplace" }),
              }).then(() => load());
            }}>
              Reset positions
            </button>
          )}
          {/* Placing rows one at a time is the answer for a park that
              grew rather than one that was drawn, so it is offered
              whether or not the map has handed anything over. */}
          {!fitting && !laying && (
            <button type="button" className={fencing ? "btn pri" : "btn"}
                    onClick={() => {
                      if (fencing) {
                        // Nothing was written while drawing, so putting
                        // the saved plan back is the whole of undoing it.
                        setFencing(false);
                        setPlan((was) => ({ ...was, fence: planSaved.current }));
                        return;
                      }
                      setFencing(true); setLaying(false); setFitting(false);
                      setSelected(null);
                      planSaved.current = plan.fence;
                      // Start from the line it already has, so this is
                      // adjusting rather than beginning again.
                      const had = plan.fence ?? [];
                      const open = had.length > 3
                        && had[0][0] === had[had.length - 1][0]
                        && had[0][1] === had[had.length - 1][1]
                        ? had.slice(0, -1) : had;
                      setCorners(open.map((q) => [q[0], q[1]] as Tap));
                    }}>
              {fencing ? "Done" : plan.fence?.length
                ? "Adjust the boundary" : "Draw the boundary"}
            </button>
          )}
          {/* One press to bring the whole park back inside its own deed
              line. It used to happen only on the way back from the
              county lookup, which is a path a park takes once -- so a
              park whose line arrived any other way had no way to ask. */}
          {!fitting && !laying && !fencing && plan.rows.length > 0
            && (plan.fence?.length ?? 0) > 3 && (
            <button type="button" className={outside ? "btn pri" : "btn"}
                    disabled={busy}
                    onClick={() => {
                      if (plan.rows.some(placedRow)) {
                        setError("These rows were put down by hand, so they are"
                          + " already exactly where you placed them. Use Place"
                          + " rows to move one.");
                        return;
                      }
                      setError(null);
                      remember(fitInside(plan, plan.fence ?? []));
                    }}>
              Fit inside the boundary
            </button>
          )}
          {plan.rows.length > 0 && (
            <button type="button" className={laying ? "btn pri" : "btn"}
                    onClick={() => {
                      setLaying((v) => !v); setFitting(false);
                      setSelected(null); setEnd(null); setOnRow(0);
                    }}>
              {laying ? "Done" : "Place rows"}
            </button>
          )}
          {!harvested && (
            <button type="button" className={fitting ? "btn pri" : "btn"}
                    onClick={() => {
                      setFitting((v) => !v); setLaying(false);
                      setSelected(null); setTaps([]);
                    }}>
              {fitting ? "Done" : "Fit to aerial"}
            </button>
          )}
        </div>
      </header>

      {error && <p className="err">{error}</p>}

      {osm?.rescued ? (
        <p className="parkhint">
          <strong>{osm.rescued} homes you had moved are back</strong>, and are
          now saved on the server rather than in this browser.
        </p>
      ) : null}

      {outside > 0 && !fencing && (
        <p className="parkhint">
          <strong>{outside} of {countOf(plan)} lots are drawn outside the
          property line.</strong>{" "}
          {plan.rows.some(placedRow)
            ? "These rows were put down by hand — use Place rows to move the"
              + " ones that are out."
            : "Press Fit inside the boundary above and they will all come in."}
        </p>
      )}

      {arranging && (
        <p className="parkhint">
          Tap a home to choose it, then nudge it with the arrows or the
          arrow keys. Dragging still works, and you no longer have to hit
          the pad exactly — the nearest home within a fingertip is the one
          that moves. Hold <kbd>Shift</kbd> while dragging, or tick{" "}
          <em>the whole row</em>, to take the row with you: four moves
          instead of fifty one. Nothing ever rotates, so the ladder stays
          a ladder, and what you move is saved as soon as you stop. To
          move the map itself rather than a home, drag from clear ground
          outside the rows, or press <em>Fit view</em>.
          {Object.keys(moved).length
            ? ` ${Object.keys(moved).length} moved so far, outlined in orange.`
            : ""}
        </p>
      )}

      {/* Where the outlines came from. Said once, plainly, because a park
          drawn from a description and a park drawn from the map look alike
          on screen and are not the same claim. */}
      {asking && !harvested && (
        <p className="parkhint">
          Reading the park off the map — the homes and the streets come down
          with the map itself, so give the tiles a moment.
        </p>
      )}
      {!asking && (osm?.error || harvested) && (
        <p className="parkhint">
          {harvested?.homes?.length ? (
            <>
              {/* Named from the park's own plan. This sentence used to
                  read "laid along Lady Viola and Lady Cheryl, numbered
                  down from the Pamalee entrance" on every park there
                  was, which on a park in another county is not a
                  description but a contradiction of what is on screen. */}
              <strong>All {harvested.homes.length} lots</strong>, laid along{" "}
              {[...new Set(plan.rows.map((r) => r.street))].join(" and ")}{" "}
              inside the property line. Every pad is the same rectangle,
              because every home here is the same model.
              {osm?.built
                ? ` ${osm.built} of them sit on a building the map has.`
                : " The map has no buildings here, so they are spread evenly — drag them onto the pads and they will stay."}
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
          {described && (
            <>
              {" "}
              <button type="button" className="aslink"
                      onClick={() => setDescribed(false)}>
                describe this park again
              </button>
            </>
          )}
          {synced ? (
            <>
              {" "}
              <strong className={synced.saved === synced.of ? "parkok" : "parkbad"}>
                {synced.saved === synced.of
                  ? `All ${synced.of} of your moved homes are saved to the park.`
                  : `Only ${synced.saved} of ${synced.of} moved homes saved — press Download and send me the file.`}
              </strong>
            </>
          ) : null}
        </p>
      )}

      {fencing && (
        <div className="parkfit">
          <p className="parkhint">
            Switch to <strong>Aerial</strong> and tap each corner of the
            property, going round one way. Straight runs need two corners,
            not twenty — a fence line is its ends. Press{" "}
            <strong>Done</strong> when the shape closes.
          </p>
          <p className={corners.length >= 3 ? "parkok" : "dim"}>
            {corners.length === 0 ? "No corners yet."
              : corners.length < 3
                ? `${corners.length} corner${corners.length > 1 ? "s" : ""} — `
                  + "three makes a shape."
                : `${corners.length} corners, numbered as you tapped them. `
                  + "A wrong one can go on its own."}
          </p>
          {/* Numbered, and each one removable on its own.
              Undo only takes the last, so a corner put down by mistake
              in the middle of a run meant unwinding everything after it
              and tapping it all again. The numbers match the ones on the
              map, so "the sixth one was a mistake" is one click. */}
          {corners.length > 0 && (
            <ol className="fencepts">
              {corners.map((q, i) => (
                <li key={`${q[0]},${q[1]},${i}`}>
                  <span className="n">{i + 1}</span>
                  <span className="dim">
                    {q[1].toFixed(5)}, {q[0].toFixed(5)}
                  </span>
                  <button type="button" className="aslink" onClick={() => {
                    const left = corners.filter((_, k) => k !== i);
                    setCorners(left);
                    setPlan((was) => ({ ...was, fence: asRing(left) }));
                  }}>
                    remove
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="invacts">
            <button type="button" className="btn" disabled={!corners.length}
                    onClick={() => {
                      const back = corners.slice(0, -1);
                      setCorners(back);
                      setPlan((was) => ({ ...was, fence: asRing(back) }));
                    }}>
              Undo the last corner
            </button>
            <button type="button" className="btn" disabled={!corners.length}
                    onClick={() => {
                      setCorners([]);
                      setPlan((was) => ({ ...was, fence: undefined }));
                    }}>
              Start again
            </button>
            <button type="button" className="btn pri" disabled={corners.length < 3}
                    onClick={() => {
                      remember({ ...plan, fence: asRing(corners) });
                      setFencing(false);
                    }}>
              Save this boundary
            </button>
          </div>
          <p className="dim">
            Leaving without saving puts the old line back. Saving replaces
            it — including a line that came from the county, so only do
            that where theirs is wrong or missing.
          </p>
        </div>
      )}

      {laying && (
        <div className="parkfit">
          <p className="parkhint">
            Switch to <strong>Aerial</strong>, then tap the <strong>middle of
            the first home</strong> in a row and the <strong>middle of the
            last</strong>. That places the whole row — its direction, its
            spacing and every home between. A park of four rows is eight taps.
          </p>
          <ol className="parktaps">
            {plan.rows.map((r, i) => {
              const done = Boolean(r.from && r.to);
              return (
                <li key={`${r.street}-${i}`}
                    className={i === onRow ? "now" : done ? "done" : ""}>
                  <strong>
                    {r.numbers[0]}–{r.numbers[r.numbers.length - 1]}
                  </strong>{" "}
                  {r.street}
                  <span className="dim">
                    {" — "}
                    {r.numbers.length} homes
                    {i === onRow
                      ? end ? " · now tap the last one" : " · tap the first one"
                      : done ? " · placed" : ""}
                  </span>
                  {done && (
                    <button type="button" className="aslink" onClick={() => {
                      setOnRow(i); setEnd(null);
                    }}>
                      do it again
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="dim">
            The homes all sit at the same angle to their row, which is the{" "}
            <strong>Angle of homes</strong> slider — set that once and it
            applies to every row.
          </p>
        </div>
      )}

      {fitting && (
        <div className="parkfit">
          <p className="parkhint">
            Switch to <strong>Aerial</strong>, then tap these{" "}
            {fitTargets(plan).length} homes in the photograph — a park with
            one road needs three, not four. Two along a row give the angle
            and the spacing, the third gives the width of the road, and a
            fourth, where there is a second road, gives the distance to it.
            That is the whole park placed: on a park of fifty nine lots it
            puts every one of them within a centimetre of where it stands.
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
            <button type="button" className="btn" onClick={() => {
              setTaps([]); setDescribed(false); remember(EMPTY);
            }}>
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
            {/* Chevroned parks. Reading the angle off an aerial gets it
                within ten degrees; the last ten are quicker to drag than
                to describe. */}
            <Slider label="Angle of homes" unit="°" min={-60} max={60} step={1}
                    value={plan.homeTurn ?? 0}
                    onChange={(v) => remember({ ...plan, homeTurn: v })} />
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

      {missing.length > 0 && !blank && !fitting && (
        <div className="parkseed">
          <p>
            <strong>{missing.length} of {countOf(drawn)}</strong> lots aren&rsquo;t
            on file yet, so there is nowhere to record who bought the home on
            them. Add them all and every pad on the map becomes clickable.
          </p>
          <button type="button" className="btn pri" disabled={busy}
                  onClick={() => void addThem()}>
            {busy ? "Adding…" : `Add ${missing.length} lots`}
          </button>
        </div>
      )}

      {/* Saying the same true thing fifty one times.
          Every lot arrives with no home recorded, and in this park nearly
          all of them are ours. Setting the common answer and correcting
          the handful that differ is six clicks instead of a hundred, and
          it only touches lots nobody has answered for, so it cannot undo
          a correction. */}
      {/* A park nobody has described is drawing another park's streets.
          Saying so beats letting somebody believe the numbers on screen
          are theirs -- which is exactly how a wrong lot gets an owner
          recorded against it. */}
      {/* The county's line, askable at any time.
          It was inside the describe form, which is reachable only
          before a park has been laid out -- so the one park that needed
          it had to be re-described to get at it, and the box fitted
          round the homes stayed on screen looking like the answer. */}
      {described && !fitting && (
        <Parcel propertyId={propertyId}
                pin={plan.pin ?? ""}
                where={plan.address ?? name}
                has={Boolean(plan.fence?.length)}
                onGot={(ring, centre, pin) => {
                  // Not just the line: the block goes inside it. A deed
                  // line drawn round homes that are somewhere else is
                  // two right answers making one wrong picture.
                  const moved = { ...plan, fence: ring, pin, centre };
                  remember(fitInside(moved, ring));
                }} />
      )}

      {described === false && !fitting && (
        <Describe
          propertyId={propertyId}
          // The boundary counts as the park knowing something about
          // itself, even with no rows yet. Keyed on rows alone, a park
          // whose line had been drawn but whose homes had not been
          // described would lose the line the moment it was.
          from={plan.rows.length || plan.fence?.length ? plan : null}
          canKeep={canKeep}
          onAt={(at) => setPlan((was) => ({ ...was, centre: at }))}
          onLay={(next) => void describeIt(next)} />
      )}

      {unanswered.length > 0 && !missing.length && !fitting && (
        <div className="parkseed">
          <p>
            <strong>{unanswered.length} of {placed.length}</strong> lots have no
            home recorded, so none of them count towards what is left to sell.
            Mark them all as yours, then click the few that belong to a tenant
            or an investor.
          </p>
          <button type="button" className="btn pri" disabled={busy}
                  onClick={() => void post({
                    action: "kinds", kind: "poh", use: "to_sell",
                  })}>
            {busy
              ? "Marking…"
              : `Mark ${unanswered.length} park owned`}
          </button>
        </div>
      )}

      <div className={`parkmain${card || pad ? " withcard" : ""}`}>
        <ParkMap
          plan={drawn} real={blank ? null : shown} facts={facts}
          onHarvest={blank ? undefined : onHarvest}
          arranging={arranging} onNudge={nudge} onDropped={keep}
          selected={selected} onSelect={setSelected}
          fitting={fitting || laying || fencing} drawing={fencing}
          taps={fencing ? corners : laying ? (end ? [end] : []) : taps}
          onTap={(at) => {
            if (fencing) {
              // Shown at once, saved only on Done. A boundary half drawn
              // is not a boundary, and writing each corner as it lands
              // would leave a three-sided park on file the moment
              // somebody was called away from the screen.
              const next = [...corners, at];
              setCorners(next);
              setPlan((was) => ({ ...was, fence: asRing(next) }));
              return;
            }
            if (laying) {
              // First tap is where the row starts, second where it
              // ends. On the second the row is placed and the next one
              // is asked for, so a park of four rows is eight taps and
              // no typing.
              if (!end) { setEnd(at); return; }
              const rows = plan.rows.map((r, i) =>
                (i === onRow ? { ...r, from: end, to: at } : r));
              remember({ ...plan, rows });
              setEnd(null);
              setOnRow((i) => Math.min(i + 1, plan.rows.length - 1));
              return;
            }
            const next = [...taps, at].slice(0, fitTargets(plan).length);
            setTaps(next);
            if (next.length >= 2) remember(fitFromTaps(plan, next));
          }}
          onMove={(lng, lat) => remember({ ...plan, centre: [lng, lat] })}
        />
        {card && <LotCard lot={card} onClose={() => setSelected(null)} onChanged={load} />}
        {pad && (
          <aside className="lotcard movecard">
            <header>
              <h2>Lot {pad.label}</h2>
              <button type="button" className="x" onClick={() => setSelected(null)}
                      aria-label="Close">×</button>
            </header>
            {/* Four arrows round the number they move, so what is being
                moved and which way are the same picture. */}
            <div className="movepad">
              <button type="button" className="up" aria-label="Move north"
                      onClick={() => shift(pad.id, 0, STEP, wholeRow)}>↑</button>
              <button type="button" className="left" aria-label="Move west"
                      onClick={() => shift(pad.id, -STEP, 0, wholeRow)}>←</button>
              <span className="movenum">{pad.label}</span>
              <button type="button" className="right" aria-label="Move east"
                      onClick={() => shift(pad.id, STEP, 0, wholeRow)}>→</button>
              <button type="button" className="down" aria-label="Move south"
                      onClick={() => shift(pad.id, 0, -STEP, wholeRow)}>↓</button>
            </div>
            <label className="movewhole">
              <input type="checkbox" checked={wholeRow}
                     onChange={(e) => setWholeRow(e.target.checked)} />
              <span>Move the whole row</span>
            </label>
            <p className="movesay">
              Half a metre a press. The arrow keys do the same thing.
            </p>
            <form className="movenumber"
                  onSubmit={(e) => { e.preventDefault(); void renumber(pad, renaming); }}>
              <label htmlFor="lotno">Lot number</label>
              <input id="lotno" value={renaming}
                     onChange={(e) => setRenaming(e.target.value)} />
              <button type="submit" className="btn" disabled={
                busy || !renaming.trim() || renaming.trim() === pad.label
              }>
                Rename
              </button>
            </form>
            <p className="movesay">
              {pad.filed} — what a sale or a lease is filed under.
            </p>
            <div className="movestep">
              <button type="button" className="btn" disabled={nth <= 0}
                      onClick={() => setSelected(placed[nth - 1]?.id ?? null)}>
                ‹ Previous
              </button>
              <button type="button" className="btn"
                      disabled={nth < 0 || nth >= placed.length - 1}
                      onClick={() => setSelected(placed[nth + 1]?.id ?? null)}>
                Next ›
              </button>
            </div>
          </aside>
        )}
        {here && !open && !arranging && (
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
              {busy ? "Adding…" : "Add lot"}
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
          const ours = all.filter((f) => f.owner === "poh");
          // Owning it is not the same as being able to sell it. A home we
          // are letting and mean to keep is ours; so is the laundry. Only
          // what is marked `ours to sell` is stock.
          const stock = ours.filter((f) => f.use === "to_sell");
          const keeping = ours.filter((f) => f.use === "we_rent").length;
          const notHomes = ours.filter((f) => f.use === "not_home").length;
          const unsaid = ours.filter((f) => !f.use).length;
          const empty = stock.filter((f) => f.empty).length;
          return (
            <>
              <strong>{stock.length} of {all.length} are ours to sell</strong>
              {empty ? `, ${empty} of them standing empty` : ""}.{" "}
              {keeping ? `${keeping} we own and let. ` : ""}
              {notHomes ? `${notHomes} not homes. ` : ""}
              {n("toh")} tenant owned, {n("ioh")} investor owned,{" "}
              {n("none")} bare lots.
              {unsaid ? (
                <>
                  {" "}
                  <span className="parkbad">
                    {unsaid} we own {unsaid === 1 ? "has" : "have"} not been
                    marked as stock or kept, so {unsaid === 1 ? "it is" : "they are"} not
                    counted either way.
                  </span>
                </>
              ) : null}
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

/**
 * The middle of a closed ring.
 *
 * One definition, in lib/footprint, because two of these drifting apart
 * moves every home by a metre and a half and nothing says why. Null when
 * the ring is not a shape, and every caller here says what it does about
 * that -- a silent fallback of [0, 0] would put a home in the Gulf of
 * Guinea and save it there.
 */
function middleOf(ring: number[][]): [number, number] | null {
  return middleOfRing(ring);
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

/**
 * A park, described from nothing.
 *
 * Six fields, because six is what it takes and no more. Everything else
 * about a park -- where exactly each home sits, which pads are empty,
 * what is actually on them -- is quicker to drag and type than to
 * specify, and this form exists to get the block onto the right piece
 * of ground pointing the right way so that dragging is possible at all.
 *
 * The two numbering schemes are here because they are the difference
 * between a lot being filed as "3124 Lady Viola Dr" and as "1140
 * Northside Rd Lot 1", and nothing can guess which a park uses. A park
 * whose drive has no name -- which is most of them -- is the second.
 */
function Describe(
  { propertyId, from, canKeep, onAt, onLay }:
  {
    propertyId: string;
    /** What the park already says about itself, where it says anything.
     *  Re-describing a park to change one number should not mean typing
     *  the other five again. */
    from: Plan | null;
    canKeep: boolean;
    onAt: (at: [number, number]) => void;
    onLay: (plan: Plan) => void;
  },
) {
  const rows = from?.rows ?? [];
  const streets = [...new Set(rows.map((r) => r.street))];
  const hadName = Boolean(from && from.naming !== "lot");

  const [address, setAddress] = useState(from?.address ?? "");
  const [at, setAt] = useState<[number, number] | null>(
    rows.length && from ? from.centre : null);
  const [hits, setHits] = useState<{ id: string; label: string }[]>([]);
  const [named, setNamed] = useState(hadName);
  const [street, setStreet] = useState(hadName ? streets[0] ?? "" : "");
  // How many homes in each row, in order, as one line: "8, 9, 21, 21".
  // Two fields could only ever say two rows, and a park that grew is
  // however many groups it grew into.
  const [shape, setShape] = useState(
    rows.length ? rows.map((r) => r.numbers.length).join(", ") : "20, 20");
  const counts = shape.split(/[^0-9]+/).map(Number).filter((n) => n > 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const [first, setFirst] = useState(() => {
    const n = Number(rows[0]?.numbers[0]);
    return Number.isFinite(n) ? n : 1;
  });
  const [turn, setTurn] = useState(from?.homeTurn ?? 30);
  // Measured off an aerial, these three are the difference between a
  // park that lands on its pads and one that needs dragging. There was
  // nowhere to type them: they existed only as sliders, which appear
  // after a park has been laid out, by which time it is in the wrong
  // place and the wrong shape.
  const [rowRun, setRowRun] = useState(from?.bearing ?? 8);
  const [along, setAlong] = useState(from?.padSpacing ?? 14);
  const [across, setAcross] = useState(from?.pairGap ?? 34);
  const [looking, setLooking] = useState(false);
  /** The address lookup is not configured on this deployment. */
  const [off, setOff] = useState(false);
  /** The county's parcel viewer, and the number on the tax card. */
  const [gis, setGis] = useState("");
  const [parcel, setParcel] = useState(from?.pin ?? "");
  const [fence, setFence] = useState<number[][] | null>(from?.fence ?? null);
  const [said, setSaid] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [paste, setPaste] = useState("");
  const [bad, setBad] = useState<string | null>(null);

  async function askCounty() {
    setProbing(true); setSaid(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/parcel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: gis, pin: parcel, address }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setSaid(out.error ?? "The county did not answer."); setProbing(false); return; }
      if (out.ring?.length) {
        setFence(out.ring);
        setSaid(`Property line from ${out.layer} — ${out.ring.length} corners.`);
      } else {
        setSaid(out.note ?? "Found the place, but no property line.");
      }
      if (out.centre) {
        const where: [number, number] = [Number(out.centre[0]), Number(out.centre[1])];
        setAt(where);
        onAt(where);
      }
    } catch { setSaid("The county did not answer."); }
    setProbing(false);
  }

  // The address lookup is already proxied, so the key stays on the
  // server. Without it this still works -- the block lands near nothing
  // and gets dragged -- which is worse but not broken.
  /**
   * Coordinates, pasted.
   *
   * "36.3339, -76.2486" or a Google Maps link with @lat,lng in it. The
   * address lookup needs a key that may not be set, and a form whose
   * only way to say where a park is depends on somebody else's billing
   * is a form that cannot be used. Right-click on Google Maps, copy the
   * coordinates, paste them here.
   */
  function asPoint(text: string): [number, number] | null {
    const at = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const pair = at ?? text.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
    if (!pair) return null;
    const lat = Number(pair[1]), lng = Number(pair[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return [lng, lat];
  }

  async function find(q: string) {
    const point = asPoint(q);
    if (point) { setHits([]); setAt(point); onAt(point); setOff(false); return; }
    setLooking(true);
    try {
      const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`);
      const out = await res.json().catch(() => ({}));
      // A lookup that is switched off returns nothing and used to say
      // nothing, which reads as "no such address".
      setOff(out.configured === false);
      setHits((out.suggestions ?? []).slice(0, 5));
    } catch { setHits([]); setOff(false); }
    setLooking(false);
  }

  async function pin(id: string, text: string) {
    setAddress(text);
    setHits([]);
    try {
      const res = await fetch(`/api/places?id=${encodeURIComponent(id)}`);
      const out = await res.json().catch(() => ({}));
      if (out.lat != null && out.lng != null) {
        const where: [number, number] = [Number(out.lng), Number(out.lat)];
        setAt(where);
        // Move the map now rather than when something is laid out, so
        // the ground underneath is this park's before any decision is
        // made about what sits on it.
        onAt(where);
        if (out.address) setAddress(String(out.address));
      }
    } catch { /* dragging still works */ }
  }

  function lay() {
    // No location, no layout. Falling back to the one park written into
    // the code put a correctly described park in Fayetteville, three
    // hundred miles from the ground it was describing, and said nothing
    // -- which is indistinguishable from the form not working.
    if (!at) return;
    const run = (n: number, from: number) =>
      Array.from({ length: Math.max(0, n) }, (_, i) => String(from + i));
    const name = named && street.trim() ? street.trim() : "The drive";
    // Numbered straight through, in the order the rows were given --
    // which is the order somebody walks them. Lot 1 is the first home
    // of the first row.
    let next = first;
    const made = counts.map((n, i) => {
      const r = {
        street: counts.length > 2 ? `${name} ${i + 1}` : name,
        side: (i % 2 ? "S" : "N") as "N" | "S",
        numbers: run(n, next),
        // Kept where a row of the same size was already placed, so
        // changing a count elsewhere does not throw away the taps.
        from: rows[i]?.numbers.length === n ? rows[i]?.from : undefined,
        to: rows[i]?.numbers.length === n ? rows[i]?.to : undefined,
      };
      next += n;
      return r;
    });
    onLay({
      ...EMPTY,
      centre: at,
      // Rows running roughly north, which is what a strip park off a
      // road usually is. It is a starting point for the Turn slider,
      // not a measurement.
      bearing: rowRun,
      homeTurn: turn,
      padSpacing: along,
      pairGap: across,
      streetGap: Math.max(60, across + 20),
      naming: named ? "street" : "lot",
      address: named ? undefined : address.trim() || undefined,
      fence: fence ?? undefined,
      pin: parcel.trim() || undefined,
      // Kept rather than re-asked: which road the line runs out to is
      // not something the six questions cover, and losing it on a
      // re-describe would quietly shrink the park by a verge.
      frontage: from?.frontage,
      countFrom: "west",
      rows: made,
    });
  }

  return (
    <div className="parkseed">
      <p>
        <strong>This park has not been described yet.</strong> What is drawn
        below belongs to another park. Say roughly what this one is and I
        will lay it out — then drag the homes where they really are.
      </p>

      <form className="rowform" onSubmit={(e) => { e.preventDefault(); lay(); }}>
        {!canKeep && (
          <p className="parkbad">
            <strong>Migration 035 hasn&rsquo;t been run</strong>, so there is
            nowhere to keep this park&rsquo;s layout. Laying it out will draw
            it and then lose it on the next reload. Run the SQL first.
          </p>
        )}
        <label>The park&rsquo;s address
          <input value={address}
                 placeholder="1140 Northside Rd, Elizabeth City NC — or 36.3339, -76.2486"
                 onChange={(e) => {
                   setAddress(e.target.value);
                   if (e.target.value.trim().length > 6) void find(e.target.value);
                 }} />
        </label>
        {looking && <p className="dim">Looking…</p>}
        {hits.length > 0 && (
          <ul className="ownerhits" style={{ position: "static" }}>
            {hits.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => void pin(h.id, h.label)}>
                  {h.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className={at ? "parkok" : off ? "parkbad" : "dim"}>
          {at
            ? "Found it — the map has moved there."
            : off
              ? "Address lookup is switched off on this site. Open the park in "
                + "Google Maps, right-click the middle of it, click the "
                + "coordinates to copy them, and paste them above."
              : looking
                ? "Looking…"
                : "Pick it from the list, or paste coordinates. The map moves "
                  + "as soon as it knows where the park is."}
        </p>

        {/* The property line, from the county rather than from a
            tracing of it. Their parcel viewer is already showing the
            deed line; asking for it by the number on the tax card is
            one field and an exact answer. */}
        <label>The county&rsquo;s parcel viewer
          <input value={gis} placeholder="paste the whole address bar from their map"
                 onChange={(e) => setGis(e.target.value)} />
        </label>
        <div className="two">
          <label>Parcel number
            <input value={parcel} placeholder="P139-50A"
                   onChange={(e) => setParcel(e.target.value)} /></label>
          <button type="button" className="btn" disabled={!gis || !parcel || probing}
                  onClick={() => void askCounty()}>
            {probing ? "Asking…" : "Get the property line"}
          </button>
        </div>
        {said && <p className={fence ? "parkok" : "parkbad"}>{said}</p>}

        <label className="check">
          <input type="checkbox" checked={named}
                 onChange={(e) => setNamed(e.target.checked)} />
          The drive inside the park has a street name
        </label>
        {named ? (
          <label>Its name
            <input value={street} placeholder="e.g. Maple Dr"
                   onChange={(e) => setStreet(e.target.value)} />
          </label>
        ) : (
          <p className="dim">
            So a lot is filed as{" "}
            <strong>{(address.trim() || "the address")} Lot {first}</strong>.
          </p>
        )}

        <div className="two">
          <label>Homes in each row, in order
            <input value={shape} placeholder="8, 9, 21, 21"
                   onChange={(e) => setShape(e.target.value)} /></label>
          <label>First number
            <input inputMode="numeric" value={first}
                   onChange={(e) => setFirst(Number(e.target.value) || 1)} /></label>
        </div>
        <p className="dim">
          One number per row, in the order you would walk them. Two rows
          either side of one road is <strong>30, 29</strong>; a park in four
          groups is <strong>8, 9, 21, 21</strong>.
        </p>
        <p className="dim">
          <strong>{counts.length} rows, {total} lots in all</strong>
          {counts.length ? `, numbered ${first} to ${first + total - 1}` : ""}.
          {" "}Rough is fine — lots can
          be added and renumbered afterwards, and nothing here is saved against
          a home until you say so.
        </p>

        {/* Measured off an aerial these place a park exactly; guessed,
            they are what makes one land in the wrong shape. Either way
            they are quicker to type once than to drag afterwards. */}
        <div className="three">
          <label>Way the rows run
            <input inputMode="decimal" value={rowRun}
                   onChange={(e) => setRowRun(Number(e.target.value) || 0)} /></label>
          <label>Angle of homes
            <input inputMode="decimal" value={turn}
                   onChange={(e) => setTurn(Number(e.target.value) || 0)} /></label>
          <label>Along the row
            <input inputMode="decimal" value={along}
                   onChange={(e) => setAlong(Number(e.target.value) || 0)} /></label>
        </div>
        <div className="two">
          <label>Across the road
            <input inputMode="decimal" value={across}
                   onChange={(e) => setAcross(Number(e.target.value) || 0)} /></label>
          <p className="dim">
            Degrees, degrees, metres, metres. {rowRun}° is{" "}
            {rowRun < 23 || rowRun > 337 ? "north" : rowRun < 68 ? "north-east"
              : rowRun < 113 ? "east" : rowRun < 158 ? "south-east"
              : rowRun < 203 ? "south" : rowRun < 248 ? "south-west"
              : rowRun < 293 ? "west" : "north-west"}.
            {counts[0] ? ` A row of ${counts[0]} at ${along} m is `
              + `${Math.round((counts[0] - 1) * along)} m long.` : ""}
          </p>
        </div>

        <button type="submit" className="btn pri" disabled={!at || !counts.length}>
          Lay it out
        </button>
        {!at && (
          <p className="dim">
            Waiting on where the park is. Typing the address is not enough —
            pick it from the list, or paste coordinates.
          </p>
        )}
      </form>

      {/* A park measured off an aerial is six numbers and a list of row
          ends, and typing six numbers correctly is not the work -- it is
          the part where one of them comes out wrong and the whole park
          lands in a field. A description pasted whole cannot be
          mistyped. */}
      <details className="parkmanual">
        <summary>Or paste a description</summary>
        <p className="parkhint">
          Everything about the park in one go: where it is, which way the
          rows run, how many homes in each, and where any already-placed
          row begins and ends.
        </p>
        <textarea className="parkpaste" rows={4} value={paste}
                  placeholder='{"centre":[-76.28638,36.37140],"bearing":178,…}'
                  onChange={(e) => { setPaste(e.target.value); setBad(null); }} />
        {bad && <p className="parkbad">{bad}</p>}
        <button type="button" className="btn" disabled={!paste.trim()}
                onClick={() => {
                  try {
                    const got = JSON.parse(paste) as Partial<Plan>;
                    if (!got || typeof got !== "object" || Array.isArray(got)) {
                      setBad("That is not a park description."); return;
                    }
                    if (!Array.isArray(got.rows) || !got.rows.length) {
                      setBad("It has no rows in it."); return;
                    }
                    if (!Array.isArray(got.centre) || got.centre.length !== 2) {
                      setBad("It does not say where the park is."); return;
                    }
                    onLay({ ...EMPTY, ...got } as Plan);
                  } catch {
                    setBad("That did not read as a description — it should "
                         + "start with { and end with }.");
                  }
                }}>
          Use this description
        </button>
      </details>
    </div>
  );
}

/**
 * The property line, asked of the county.
 *
 * Separate from describing a park because it is a different question
 * with a different answer rate: the shape of the park is something the
 * owner knows, and the deed line is something only the county has. One
 * can be done today and the other when the county's field names have
 * been worked out.
 *
 * Every step comes back and every step is shown. None of this can be
 * exercised from the machine it was written on -- arcgis.com is blocked
 * there by policy -- so the only way it gets debugged is somebody
 * reading what it tried and saying so.
 */
function Parcel(
  { propertyId, pin, where, has, onGot }:
  {
    propertyId: string; pin: string;
    /** The park's address, as a second way of finding the parcel. */
    where: string;
    has: boolean;
    onGot: (ring: number[][], centre: [number, number], pin: string) => void;
  },
) {
  const [open, setOpen] = useState(false);
  const [gis, setGis] = useState("");
  const [no, setNo] = useState(pin);
  const [addr, setAddr] = useState(where);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [steps, setSteps] = useState<{ did: string; ok: boolean; say: string }[]>([]);
  const [copied, setCopied] = useState(false);

  async function ask() {
    setBusy(true); setSaid(null); setSteps([]);
    try {
      const res = await fetch(`/api/properties/${propertyId}/parcel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: gis, pin: no, address: addr }),
      });
      const out = await res.json().catch(() => ({}));
      setSteps(out.steps ?? []);
      if (out.ring?.length) {
        onGot(out.ring, [Number(out.centre[0]), Number(out.centre[1])], no.trim());
        setSaid(`The property line is from ${out.layer} — ${out.ring.length} corners.`);
      } else {
        setSaid(out.error ?? out.note ?? "The county did not answer.");
      }
    } catch {
      setSaid("The county did not answer at all.");
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <p className="parkhint">
        {has
          ? `The property line is the county's, from parcel ${pin || "on file"}.`
          : "The property line drawn is a box around the homes, not the deed line."}
        {" "}
        <button type="button" className="aslink" onClick={() => setOpen(true)}>
          {has ? "get it again" : "get it from the county"}
        </button>
        {" — or draw it yourself with "}
        <strong>{has ? "Adjust the boundary" : "Draw the boundary"}</strong>
        {" above."}
      </p>
    );
  }

  return (
    <div className="parkseed">
      <p>
        The number off the tax card is usually enough — North Carolina
        publishes every county&rsquo;s parcels as one layer. The county&rsquo;s
        own viewer is the fallback if theirs is not in it.
      </p>
      <form className="rowform" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <label>The park&rsquo;s address
          <input value={addr} placeholder="1140 Northside Rd, Elizabeth City NC"
                 onChange={(e) => setAddr(e.target.value)} /></label>
        <div className="two">
          <label>Parcel number
            <input value={no} placeholder="P139-50A"
                   onChange={(e) => setNo(e.target.value)} /></label>
          <button type="submit" className="btn pri" disabled={(!no && !addr) || busy}>
            {busy ? "Asking…" : "Get the property line"}
          </button>
        </div>
        <p className="dim">
          Either will do. A parcel number can be written three ways and
          indexed on a fourth, so the address is tried as well.
        </p>
      </form>
      {said && <p className={has ? "parkok" : "parkbad"}>{said}</p>}
      <details className="parkmanual">
        <summary>Or name the county&rsquo;s own parcel viewer</summary>
        <label className="parkhint">Paste the whole address bar from their map
          <input value={gis} placeholder="…/index.html?appid=38fc8f…"
                 onChange={(e) => setGis(e.target.value)} /></label>
      </details>
      {steps.length > 0 && (
        <>
          <ul className="lotlist">
            {steps.map((st, i) => (
              <li key={i}>
                <strong>{st.ok ? "\u2713" : "\u2717"} {st.did}</strong>
                <span className="dim"> — {st.say}</span>
              </li>
            ))}
          </ul>
          {/* So the failure can be handed over whole rather than
              described from memory. */}
          <button type="button" className="aslink" onClick={() => {
            void navigator.clipboard.writeText(
              steps.map((st) => `${st.ok ? "ok" : "no"}: ${st.did} — ${st.say}`).join("\n"),
            ).then(() => setCopied(true), () => setCopied(false));
          }}>
            {copied ? "copied — paste it to me" : "copy this and send it to me"}
          </button>
        </>
      )}
      <p className="dim">
        <button type="button" className="aslink" onClick={() => setOpen(false)}>
          close
        </button>
      </p>
    </div>
  );
}
