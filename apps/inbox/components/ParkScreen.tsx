"use client";
import { useCallback, useEffect, useState } from "react";
import ParkPlan, { type Lot } from "./ParkPlan";
import ParkMap, { type MapLot } from "./ParkMap";
import LotCard from "./LotCard";

/**
 * The park screen: the plan, a pad, and the tool that draws a street.
 *
 * Laying out fifty homes by dragging fifty rectangles is an afternoon nobody
 * has. Saying "Lady Cheryl, fourteen pads, 3101 upwards in twos, from here to
 * here" is a minute, and dragging afterwards is for the three that are not
 * where the maths put them.
 */
export default function ParkScreen({ propertyId }: { propertyId: string }) {
  const [lots, setLots] = useState<Lot[]>([]);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [laying, setLaying] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pull, setPull] = useState<{
    steps: { did: string; ok: boolean; say: string }[];
    lots?: { label: string; lat: number; lng: number; street: string | null }[];
    others?: { title: string; count: number }[];
    layers?: { title: string; url: string }[];
    error?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** In a preview, which of the found homes are actually ours. Everything
   *  starts in; the aerial makes the ones that are not obvious. */
  const [keep, setKeep] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch(`/api/properties/${propertyId}/plan`, { cache: "no-store" });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setError(out.error ?? "Could not load the plan."); return; }
    setName(out.property?.name ?? "");
    setPending(Boolean(out.pending));
    setLots(out.lots ?? []);
  }, [propertyId]);
  useEffect(() => { void load(); }, [load]);

  async function post(payload: Record<string, unknown>) {
    const res = await fetch(`/api/properties/${propertyId}/plan`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setError(out.error ?? "That didn't save."); return false; }
    setError(null);
    await load();
    return true;
  }

  // Moved on screen first, saved after. A rectangle that waits for a round
  // trip before it follows your finger does not feel like dragging, it feels
  // like the page is broken.
  const move = useCallback((id: string, x: number, y: number) => {
    setLots((prev) => prev.map((l) => (l.id === id ? { ...l, x, y } : l)));
  }, []);
  const settle = useCallback(async (id: string) => {
    const lot = lots.find((l) => l.id === id);
    if (!lot || lot.x === null) return;
    await post({ action: "move", unitId: id, x: lot.x, y: lot.y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lots]);

  // What a preview looks like ON the plan. A count tells you nothing about
  // whether the right homes came back; the shape tells you immediately.
  /** The streets the pull found, biggest first. A park is one or two of
   *  them and the neighbourhood is the rest, so ticking a street is the
   *  filter that matches how anybody actually thinks about their park. */
  const streets = (() => {
    const by = new Map<string, number>();
    for (const l of pull?.lots ?? []) {
      const k = l.street ?? "No street given";
      by.set(k, (by.get(k) ?? 0) + 1);
    }
    return [...by].sort((a, b) => b[1] - a[1]);
  })();

  function toggleStreet(name: string, on: boolean) {
    const labels = (pull?.lots ?? [])
      .filter((l) => (l.street ?? "No street given") === name)
      .map((l) => l.label);
    setKeep((prev) => {
      const next = new Set(prev);
      for (const l of labels) { if (on) next.add(l); else next.delete(l); }
      return next;
    });
  }

  /** Homes with real coordinates go on the aerial. The drawn plan stays for
   *  a park somebody arranged by hand, where there are no coordinates to
   *  put on a map. */
  const onMap: MapLot[] = pull?.lots?.length
    ? pull.lots.map((l) => ({
        id: l.label, label: l.label, lat: l.lat, lng: l.lng, street: l.street,
        // In a pull, the only question is in or out. Everything else about a
        // home is unknown until it has been kept.
        state: (keep.has(l.label) ? "bare" : "out") as MapLot["state"],
      }))
    : lots.filter((l) => l.lat !== null && l.lng !== null).map((l) => ({
        id: l.id, label: l.label, lat: l.lat as number, lng: l.lng as number,
        street: null,
        state: (!l.sale ? (l.tenant ? "ours" : "bare")
          : l.tenant ? "let" : "empty") as MapLot["state"],
      }));
  const drawn = lots.filter((l) => l.x !== null && l.lat === null);

  const open = lots.find((l) => l.id === selected) ?? null;
  const unplaced = lots.filter((l) => l.x === null);
  const placed = lots.filter((l) => l.x !== null);

  /** Ask the county. Preview first, always: forty lots appearing with the
   *  neighbours' numbers among them and no way to tell which is which is
   *  worse than no lots at all. */
  async function askCounty(
    url: string, commit: boolean, layerUrl?: string, keepLabels?: string[],
  ) {
    setPulling(true); setError(null);
    const res = await fetch(`/api/properties/${propertyId}/plan/pull`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, commit, layerUrl, keep: keepLabels }),
    });
    const out = await res.json().catch(() => ({}));
    setPulling(false);
    setPull(out);
    setKeep(new Set((out.lots ?? []).map((l: { label: string }) => l.label)));
    if (out.ok) { setPull(null); setKeep(new Set()); await load(); }
  }

  if (pending) {
    return (
      <div className="dash">
        <h1>{name || "Park plan"}</h1>
        <p className="dashnone">
          Migrations 024 and 030 haven&rsquo;t been run, so there is nowhere to
          store where a home sits. Run them and this page draws itself.
        </p>
      </div>
    );
  }

  return (
    <div className="parkpage">
      <header className="parkhead">
        <h1>{name}</h1>
        <div className="parkacts">
          <button type="button" className={editing ? "btn pri" : "btn"}
                  onClick={() => { setEditing((v) => !v); setLaying(false); }}>
            {editing ? "Done arranging" : "Arrange"}
          </button>
          {editing && (
            <button type="button" className="btn" onClick={() => setLaying((v) => !v)}>
              Lay out a street
            </button>
          )}
        </div>
      </header>

      {editing && !laying && (
        <p className="parkhint">
          Drag a home to move it. Click an empty spot to add one.
        </p>
      )}

      {laying && (
        <form className="rowform" onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const ok = await post({
            action: "row",
            count: f.get("count"), startAt: f.get("startAt"), step: f.get("step"),
            fromX: Number(f.get("fromX")) / 100, fromY: Number(f.get("fromY")) / 100,
            toX: Number(f.get("toX")) / 100, toY: Number(f.get("toY")) / 100,
          });
          if (ok) setLaying(false);
        }}>
          <p className="parkhint">
            Positions are percentages across and down the plan. The homes
            spread evenly between the two ends and turn to face the street.
          </p>
          <div className="three">
            <label>How many<input name="count" inputMode="numeric" defaultValue="14" required /></label>
            <label>First number<input name="startAt" inputMode="numeric" defaultValue="3101" required /></label>
            <label>Counting by<input name="step" inputMode="numeric" defaultValue="2" required /></label>
          </div>
          <div className="three">
            <label>Start across %<input name="fromX" inputMode="numeric" defaultValue="15" /></label>
            <label>Start down %<input name="fromY" inputMode="numeric" defaultValue="60" /></label>
            <label />
          </div>
          <div className="three">
            <label>End across %<input name="toX" inputMode="numeric" defaultValue="80" /></label>
            <label>End down %<input name="toY" inputMode="numeric" defaultValue="45" /></label>
            <label />
          </div>
          <div className="invacts">
            <button type="button" className="btn" onClick={() => setLaying(false)}>Cancel</button>
            <button type="submit" className="btn pri">Draw the street</button>
          </div>
        </form>
      )}

      {error && <p className="err">{error}</p>}

      {/* A grey rectangle with nothing in it is indistinguishable from a
          broken page, which is exactly how it was read. */}
      {lots.length === 0 && !laying && !pull?.lots?.length && (
        <div className="parkempty">
          <h2>No lots on the plan yet</h2>
          <p>
            The county already knows where every home in this park is and what
            number is on it. Paste the link to their map site and we&rsquo;ll
            ask — nothing is saved until you have seen what came back.
          </p>
          <form onSubmit={(e) => {
            e.preventDefault();
            const url = String(new FormData(e.currentTarget).get("url") ?? "");
            if (url.trim()) void askCounty(url.trim(), false);
          }}>
            <input name="url" placeholder="https://www.arcgis.com/apps/…?id=…"
                   defaultValue="https://www.arcgis.com/apps/webappviewer/index.html?id=a6ea68995c2349e9a177366288589be7" />
            <button type="submit" className="btn pri" disabled={pulling}>
              {pulling ? "Asking…" : "Pull from the county"}
            </button>
          </form>
          <p className="dim">
            Or press <strong>Arrange</strong> above and lay the streets out by
            hand.
          </p>
        </div>
      )}

      {pull && (
        <div className="pullout">
          <ol>
            {pull.steps.map((s, i) => (
              <li key={i} className={s.ok ? "ok" : "no"}>
                <strong>{s.did}</strong> — {s.say}
              </li>
            ))}
          </ol>
          {pull.error && <p className="err">{pull.error}</p>}
          {pull.layers?.length ? (
            <div className="pulllayers">
              <p>Everything this map publishes — pick one to try on its own:</p>
              <ul>
                {pull.layers.map((l) => (
                  <li key={l.url}>
                    <button type="button" disabled={pulling} onClick={() => void askCounty(
                      (document.querySelector('input[name="url"]') as HTMLInputElement)?.value ?? "",
                      false, l.url)}>{l.title}</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {pull.lots?.length ? (
            <>
              <p>
                <strong>{keep.size} of {pull.lots.length}</strong> on the aerial
                below. Tap any home to take it out or put it back — the
                photograph makes it obvious which are yours.
              </p>
              {streets.length > 1 && (
                <div className="streetpick">
                  <p>By street — tick the ones that are yours:</p>
                  <ul>
                    {streets.map(([name, n]) => {
                      const all = (pull.lots ?? [])
                        .filter((l) => (l.street ?? "No street given") === name);
                      const on = all.every((l) => keep.has(l.label));
                      return (
                        <li key={name}>
                          <label>
                            <input type="checkbox" checked={on}
                                   onChange={(e) => toggleStreet(name, e.target.checked)} />
                            {name} <span className="dim">{n}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {pull.others?.length ? (
                <p className="dim">
                  Other layers found: {pull.others.map((o) => `${o.title} (${o.count})`).join(", ")}.
                  Pick one from the list below if this is the wrong set.
                </p>
              ) : null}
              <div className="invacts">
                <button type="button" className="btn" onClick={() => setPull(null)}>
                  Not these
                </button>
                <button type="button" className="btn pri"
                        disabled={pulling || keep.size === 0}
                        onClick={() => void askCounty(
                          (document.querySelector('input[name="url"]') as HTMLInputElement)?.value ?? "",
                          true, undefined, [...keep])}>
                  {pulling ? "Saving…" : `Keep these ${keep.size}`}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      <div className={`parkmain${open ? " withcard" : ""}`} onPointerUp={() => selected && editing && void settle(selected)}>
        {onMap.length ? (
          <ParkMap
            lots={onMap} selected={selected} onSelect={setSelected}
            picking={Boolean(pull?.lots?.length)}
            onToggle={(label) => setKeep((prev) => {
              const next = new Set(prev);
              if (next.has(label)) next.delete(label); else next.add(label);
              return next;
            })}
          />
        ) : (
          <ParkPlan
            lots={drawn} selected={selected} editing={editing}
            onSelect={setSelected}
            onMove={(id, x, y) => { setSelected(id); move(id, x, y); }}
            onAdd={(label, x, y) => void post({ action: "add", label, x, y })}
          />
        )}
        {open && (
          <LotCard lot={open} onClose={() => setSelected(null)} onChanged={load} />
        )}
      </div>

      {unplaced.length > 0 && (
        <p className="parkhint">
          {unplaced.length} lot{unplaced.length === 1 ? "" : "s"} on file with no
          place on the plan yet: {unplaced.map((l) => l.label).join(", ")}.
          Turn on <strong>Arrange</strong> and lay out the street they are on.
        </p>
      )}
    </div>
  );
}
