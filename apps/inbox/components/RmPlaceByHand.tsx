"use client";
import { useEffect, useState } from "react";

type Match = {
  id: number; code: string; name: string; address: string; groups: string[];
};
type Park = { id: string; name: string; role: string; localName: string };

/**
 * Putting properties into a park by hand, here only.
 *
 * The street-number rule handles the ordinary case -- a lot addressed 1140
 * sitting outside the park whose other lots are all 1140. It cannot handle a
 * park that does not exist yet, because there are no lots in it to learn the
 * number from, and it will never handle a park addressed by its own internal
 * streets. 1800 Pamalee is both at once: Lady Cheryl and Lady Viola, and no
 * group in Rent Manager.
 *
 * So: search, tick, choose the park, place. Rent Manager is not touched and
 * every placement is reversible from the panel above.
 */
export default function RmPlaceByHand() {
  const [parks, setParks] = useState<Park[]>([]);
  const [park, setPark] = useState("");
  const [newPark, setNewPark] = useState("");
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"" | "find" | "place" | "make">("");
  const [said, setSaid] = useState<string | null>(null);

  async function loadParks() {
    const d = await (await fetch("/api/rentmanager/groups")).json();
    const only = (d.groups ?? []).filter((g: Park) => g.role === "park");
    setParks(only);
    if (!park && only[0]) setPark(only[0].name);
  }
  useEffect(() => { loadParks(); }, []);

  async function makePark() {
    if (newPark.trim().length < 2) return;
    setBusy("make"); setSaid(null);
    try {
      const res = await fetch("/api/rentmanager/groups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createLocal: newPark.trim() }),
      });
      const d = await res.json();
      if (d.error) { setSaid(d.error); return; }
      setSaid(`"${d.name}" exists here. Nothing was added to Rent Manager.`);
      setNewPark("");
      await loadParks();
      setPark(d.name);
    } finally { setBusy(""); }
  }

  async function find() {
    setBusy("find"); setSaid(null);
    try {
      // The same search the group-maker uses. It reads and writes nothing.
      const res = await fetch("/api/rentmanager/groups/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search }),
      });
      const d = await res.json();
      setMatches(d.matches ?? []);
      setPicked(new Set((d.matches ?? []).map((m: Match) => m.id)));
    } finally { setBusy(""); }
  }

  async function place() {
    if (!park || !picked.size) return;
    setBusy("place"); setSaid(null);
    try {
      const chosen = (matches ?? []).filter((m) => picked.has(m.id));
      const res = await fetch("/api/rentmanager/filing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place: chosen.map((m) => ({
            property: m.id, intoName: park,
            why: "placed by hand",
            wasIn: m.groups.join(", ") || null,
          })),
        }),
      });
      const d = await res.json();
      setSaid(d.error
        ? d.error
        : `${d.placed} placed into ${park}. Rent Manager is unchanged.`);
      if (!d.error) { setMatches(null); setPicked(new Set()); }
    } finally { setBusy(""); }
  }

  return (
    <div className="rmmake">
      <label className="fieldlab" htmlFor="pbpark">Which park</label>
      <select id="pbpark" value={park} onChange={(e) => setPark(e.target.value)}>
        {parks.map((p) => (
          <option key={p.id} value={p.name}>{p.localName || p.name}</option>
        ))}
        {!parks.length && <option value="">No park has been named yet</option>}
      </select>

      <label className="fieldlab" htmlFor="pbnew">
        …or declare one that isn&rsquo;t in Rent Manager
      </label>
      <div className="unitrow">
        <input id="pbnew" value={newPark} placeholder="1142 Northside"
               onChange={(e) => setNewPark(e.target.value)} />
        <button className="btn" disabled={busy !== "" || newPark.trim().length < 2}
                onClick={makePark}>
          {busy === "make" ? "Adding…" : "Add it here"}
        </button>
      </div>

      <label className="fieldlab" htmlFor="pbq">
        Which properties <span className="opt">— by address, comma separated</span>
      </label>
      <div className="unitrow">
        <input id="pbq" value={search} placeholder="1142 Northside"
               onChange={(e) => setSearch(e.target.value)} />
        <button className="btn" disabled={busy !== "" || !search.trim()}
                onClick={find}>
          {busy === "find" ? "Looking…" : "Find them"}
        </button>
      </div>

      {said && <p className="notice">{said}</p>}

      {matches && (
        <>
          <ul className="rmpick">
            {matches.map((m) => (
              <li key={m.id}>
                <label>
                  <input type="checkbox" checked={picked.has(m.id)}
                         onChange={() => setPicked((s) => {
                           const next = new Set(s);
                           if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                           return next;
                         })} />
                  <span className="mono">{m.code}</span>
                  <span>{m.address || m.name}</span>
                  {m.groups.length > 0 && (
                    <span className="already">in {m.groups.join(", ")}</span>
                  )}
                </label>
              </li>
            ))}
            {!matches.length && <li className="none">Nothing matched that.</li>}
          </ul>
          {picked.size > 0 && park && (
            <button className="btn pri" disabled={busy !== ""} onClick={place}>
              {busy === "place"
                ? "Placing…"
                : `Place ${picked.size} into ${park} — Rent Manager untouched`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
