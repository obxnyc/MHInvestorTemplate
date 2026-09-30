"use client";
import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/prices";
import { toLatLng, toPixels, type Frame } from "@/lib/sitemap";

type Job = {
  id: string; summary: string; status: string; urgency: number | null;
  scheduled_for: string | null; completed_at: string | null; cost_cents: number | null;
};
type Note = {
  id: string; body: string; pinned: boolean; created_at: string;
  staff: { full_name: string } | null;
};
export type Unit = {
  id: string; label: string;
  bedrooms: number | null; bathrooms: number | null; square_feet: number | null;
  monthly_rent: number | null; is_vacant: boolean;
  home_owner?: string; home_year?: number | null; home_make?: string | null;
  home_serial?: string | null; owner?: string | null;
  lat?: number | null; lng?: number | null;
  map_x?: number | null; map_y?: number | null;
  meter_water?: string | null; meter_electric?: string | null;
  jobs: Job[]; notes: Note[];
};
type Data = {
  property: { id: string; name: string; code: string | null; kind: string;
              color: string | null; map_kind?: string; map_note?: string | null };
  units: Unit[];
  map: { image: string | null; centre: { lat: number; lng: number } | null;
         zoom: number; placed: number; total: number };
  aerial: boolean;
  canEdit: boolean;
};

const SIZE = { width: 900, height: 620 };

/**
 * The park, from above, with every lot on it.
 *
 * The question a park raises all day is "which one is lot 34" -- asked by a
 * tech at the gate, by whoever is taking the call, and by anyone working out
 * which homes back onto the tree line. A list cannot answer it. This can, and
 * the same picture answers "which ones are empty" without being asked.
 *
 * Two kinds of backdrop, and the difference is not cosmetic. Over a real
 * aerial a pin is a latitude and longitude: it survives the picture being
 * replaced, and somebody can be given directions to it. Over an uploaded
 * plan it is a fraction of that image and means nothing without it -- which
 * is the right answer while 1140 and Pamalee are being built and every
 * aerial shows dirt where the lots are going.
 */
export default function SiteMap({ propertyId }: { propertyId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const surface = useRef<HTMLDivElement>(null);

  async function load() {
    const res = await fetch(`/api/properties/${propertyId}/sitemap`);
    setData(await res.json());
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [propertyId]);

  if (!data) return <p className="pinmuted pad">Loading…</p>;

  const kind = data.property.map_kind ?? "none";
  const frame: Frame | null = data.map.centre
    ? { ...data.map.centre, zoom: data.map.zoom, ...SIZE } : null;

  /** Where a lot sits on the picture, in pixels, or nothing if unplaced. */
  function at(u: Unit): { x: number; y: number } | null {
    if (kind === "image" && u.map_x != null && u.map_y != null) {
      return { x: Number(u.map_x) * SIZE.width, y: Number(u.map_y) * SIZE.height };
    }
    if (kind === "aerial" && frame && u.lat != null && u.lng != null) {
      return toPixels(frame, Number(u.lat), Number(u.lng));
    }
    return null;
  }

  async function drop(e: React.MouseEvent) {
    if (!placing || !surface.current || !data?.canEdit) return;
    const box = surface.current.getBoundingClientRect();
    // Measured against the rendered box and scaled to the frame, so a map
    // squeezed onto a phone still drops the pin where the finger went.
    const px = ((e.clientX - box.left) / box.width) * SIZE.width;
    const py = ((e.clientY - box.top) / box.height) * SIZE.height;

    const body = kind === "aerial" && frame
      ? toLatLng(frame, px, py)
      : { mapX: px / SIZE.width, mapY: py / SIZE.height };

    setBusy(true);
    try {
      await fetch(`/api/units/${placing}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
      // Straight on to the next one: placing sixty lots is one long action,
      // not sixty separate ones.
      const rest = data.units.filter((u) => !at(u) && u.id !== placing);
      setPlacing(rest[0]?.id ?? null);
    } finally { setBusy(false); }
  }

  async function lift(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/units/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: null, lng: null, mapX: null, mapY: null }),
      });
      await load();
    } finally { setBusy(false); }
  }

  const unplaced = data.units.filter((u) => !at(u));
  const chosen = data.units.find((u) => u.id === open) ?? null;

  return (
    <div className="sitewrap">
      <div className="sitemain">
        <div className="siteheadrow">
          <span>
            <b>{data.map.total - unplaced.length}</b> of {data.map.total} placed
          </span>
          {placing && (
            <span className="placing">
              Click where <b>{data.units.find((u) => u.id === placing)?.label}</b> is
              <button className="mini" onClick={() => setPlacing(null)}>Stop</button>
            </span>
          )}
        </div>

        {kind === "none" ? (
          <p className="notice">
            No map set up for this property yet. {data.aerial
              ? "Choose an aerial, or upload a site plan, above."
              : "Upload a site plan above — an aerial needs a Google Maps key on the server."}
          </p>
        ) : (
          <div ref={surface}
               className={`surface${placing ? " placing" : ""}`}
               style={{ aspectRatio: `${SIZE.width} / ${SIZE.height}` }}
               onClick={drop}>
            {kind === "image" && data.map.image && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={data.map.image} alt="" className="sitebg" />
            )}
            {kind === "aerial" && frame && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="sitebg" alt=""
                   src={`/api/places/aerial?lat=${frame.lat}&lng=${frame.lng}`
                        + `&z=${frame.zoom}&w=${SIZE.width}&h=${SIZE.height}`} />
            )}

            {data.units.map((u) => {
              const p = at(u);
              if (!p) return null;
              return (
                <button key={u.id} type="button"
                        className={`pin${u.is_vacant ? " empty" : ""}`
                                   + `${open === u.id ? " on" : ""}`}
                        style={{ left: `${(p.x / SIZE.width) * 100}%`,
                                 top: `${(p.y / SIZE.height) * 100}%` }}
                        onClick={(e) => { e.stopPropagation(); setOpen(u.id); }}>
                  {u.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <aside className="siteside">
        {chosen ? (
          <UnitCard unit={chosen} canEdit={data.canEdit} busy={busy}
                    onClose={() => setOpen(null)}
                    onLift={() => lift(chosen.id)}
                    onSaved={load} />
        ) : (
          <>
            <h3>Still to place</h3>
            {unplaced.length === 0 ? (
              <p className="okmsg">Every one is on the map.</p>
            ) : (
              <ul className="toplace">
                {unplaced.map((u) => (
                  <li key={u.id}>
                    <button className={placing === u.id ? "on" : ""}
                            disabled={!data.canEdit || kind === "none"}
                            onClick={() => setPlacing(u.id)}>
                      {u.label}
                      {u.is_vacant && <span className="pill warn">empty</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="whosnote">
              Pick one, then click where it is. Click any pin to see what is on
              that lot.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}

/** One lot: what it is, who owns the home on it, and what is outstanding. */
function UnitCard(
  { unit, canEdit, busy, onClose, onLift, onSaved }:
  { unit: Unit; canEdit: boolean; busy: boolean;
    onClose: () => void; onLift: () => void; onSaved: () => void },
) {
  const [water, setWater] = useState(unit.meter_water ?? "");
  const [power, setPower] = useState(unit.meter_electric ?? "");
  const [note, setNote] = useState("");
  const open = unit.jobs.filter((j) => j.status !== "done");
  const done = unit.jobs.filter((j) => j.status === "done");

  async function save(patch: Record<string, unknown>) {
    await fetch(`/api/units/${unit.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    onSaved();
  }

  async function addNote() {
    if (!note.trim()) return;
    await fetch(`/api/units/${unit.id}/note`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: note }),
    });
    setNote("");
    onSaved();
  }

  return (
    <div className="unitcard">
      <div className="ucardtop">
        <h3>{unit.label}</h3>
        <button className="mini" onClick={onClose}>Close</button>
      </div>

      <p className="uline">
        {[unit.bedrooms ? `${unit.bedrooms} bed` : null,
          unit.bathrooms ? `${unit.bathrooms} bath` : null,
          unit.square_feet ? `${unit.square_feet.toLocaleString()} sq ft` : null]
          .filter(Boolean).join(" · ") || "No detail recorded"}
      </p>
      <p className="uline">
        <b>{unit.monthly_rent ? `${money(Number(unit.monthly_rent) * 100)}/mo` : "No rent set"}</b>
        <span className={`whose ${unit.is_vacant ? "none" : "ours"}`}>
          {unit.is_vacant ? "Empty" : "Let"}
        </span>
      </p>

      {/* Whose home stands on our dirt. The thing the whole park turns on. */}
      <p className="uline">
        {unit.owner
          ? <>Home owned by <b>{unit.owner}</b></>
          : unit.home_owner === "theirs" ? "Home owned by the resident"
          : unit.home_owner === "none" ? "Bare lot"
          : "Our home"}
        {unit.home_serial && <span className="serial">{unit.home_serial}</span>}
      </p>

      {canEdit && (
        <div className="umeters">
          <label>Water meter
            <input value={water} onChange={(e) => setWater(e.target.value)}
                   onBlur={() => save({ meterWater: water })} />
          </label>
          <label>Electric meter
            <input value={power} onChange={(e) => setPower(e.target.value)}
                   onBlur={() => save({ meterElectric: power })} />
          </label>
        </div>
      )}

      <h4>Maintenance</h4>
      {open.length === 0 && done.length === 0 && <p className="dashnone">Nothing on record.</p>}
      {open.map((j) => (
        <p key={j.id} className="ujob open">
          <b>Open</b> {j.summary}
        </p>
      ))}
      {done.slice(0, 5).map((j) => (
        <p key={j.id} className="ujob">
          {j.completed_at?.slice(0, 10)} {j.summary}
          {j.cost_cents ? ` · ${money(j.cost_cents)}` : ""}
        </p>
      ))}

      <h4>Notes about this lot</h4>
      {unit.notes.length === 0 && <p className="dashnone">Nothing written yet.</p>}
      {unit.notes.map((n) => (
        <div key={n.id} className="unote">
          <span className="nwho">{n.staff?.full_name ?? "Someone"}
            <span className="nwhen">{n.created_at.slice(0, 10)}</span></span>
          <p>{n.body}</p>
        </div>
      ))}
      {canEdit && (
        <div className="unitrow">
          <input value={note} placeholder="Gate code, dog, where the shut-off is…"
                 onChange={(e) => setNote(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} />
          <button className="btn" disabled={!note.trim()} onClick={addNote}>Add</button>
        </div>
      )}

      {canEdit && (
        <button className="mini danger" disabled={busy} onClick={onLift}>
          Take this pin off the map
        </button>
      )}
    </div>
  );
}
