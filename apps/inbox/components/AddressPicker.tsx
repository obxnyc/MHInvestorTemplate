"use client";
import { useEffect, useRef, useState } from "react";

export type Place = {
  address: string;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
  confirmed: boolean;
};

/**
 * Find the address, then look at it from above and say that is the one.
 *
 * The confirmation is the point. An address that geocodes to the middle of a
 * road, to the next park along, or to a lot on the other side of the highway
 * is not obviously wrong in text -- it is obviously wrong in a photograph. And
 * the cost of it being wrong is not discovered now: it is discovered months
 * later, by a contractor at the wrong gate at seven in the morning.
 *
 * Typing it by hand is always allowed and always has been. If the lookup is
 * not configured, or is down, or simply does not know a lot number in a park
 * -- which is common, parks are one address to the post office -- the box is
 * still a box.
 */
export default function AddressPicker(
  { value, onChange }: { value: Place; onChange: (p: Place) => void },
) {
  const [q, setQ] = useState(value.address);
  const [list, setList] = useState<{ id: string; label: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const seq = useRef(0);
  const chosen = useRef(false);

  useEffect(() => {
    // Nothing to look up until it stops changing, and nothing at all if the
    // person just picked something -- otherwise choosing an address
    // immediately searches for the address that was chosen.
    if (chosen.current) { chosen.current = false; return; }
    if (q.trim().length < 3) { setList([]); return; }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setLooking(true);
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        if (mine !== seq.current) return;
        setNote(data.error ?? null);
        setList(data.suggestions ?? []);
        setOpen((data.suggestions ?? []).length > 0);
      } finally {
        if (mine === seq.current) setLooking(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  async function pick(id: string, label: string) {
    chosen.current = true;
    setQ(label);
    setOpen(false);
    setNote(null);
    const res = await fetch(`/api/places?id=${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.lat === null || data.lat === undefined) {
      setNote(data.error ?? "Couldn't place that one on the map. The address is saved anyway.");
      onChange({ address: label, lat: null, lng: null, placeId: id, confirmed: false });
      return;
    }
    onChange({
      address: data.address ?? label,
      lat: Number(data.lat), lng: Number(data.lng),
      placeId: id,
      // Not confirmed yet. A coordinate arriving is not a person having looked.
      confirmed: false,
    });
  }

  const hasPoint = value.lat !== null && value.lng !== null;

  return (
    <div className="addrpick">
      <label htmlFor="addr">Address</label>
      <div className="addrbox">
        <input id="addr" value={q} autoComplete="off"
               onChange={(e) => {
                 setQ(e.target.value);
                 // Typing over a confirmed address un-confirms it. The picture
                 // they agreed to was of somewhere else.
                 onChange({ address: e.target.value, lat: null, lng: null,
                            placeId: null, confirmed: false });
               }}
               onFocus={() => setOpen(list.length > 0)}
               placeholder="Start typing — 118 Rosebud Ave, Elizabeth City" />
        {looking && <span className="addrspin" aria-hidden="true">…</span>}
        {open && list.length > 0 && (
          <ul className="addrlist">
            {list.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => pick(s.id, s.label)}>{s.label}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {note && <p className="addrnote">{note}</p>}

      {hasPoint && (
        <div className={`aerial${value.confirmed ? " ok" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/places/aerial?lat=${value.lat}&lng=${value.lng}`}
               alt={`Aerial view of ${value.address}`} width={640} height={360} />
          <div className="aerialbar">
            {value.confirmed ? (
              <>
                <span className="aerialok">✓ Confirmed</span>
                <button type="button" className="mini"
                        onClick={() => onChange({ ...value, confirmed: false })}>
                  Not this one
                </button>
              </>
            ) : (
              <>
                <span className="aerialask">Is this the right spot?</span>
                <button type="button" className="btn pri mini"
                        onClick={() => onChange({ ...value, confirmed: true })}>
                  Yes, that&rsquo;s it
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
