"use client";
import { useState } from "react";

type Match = {
  id: number; code: string; name: string; address: string; groups: string[];
};
type Made = {
  created: boolean; id: number | null; name: string; count: number;
  tried: { shape: string; status: number; ok: boolean; body: string }[];
};

/**
 * Make a park's group in Rent Manager, with its lots in it.
 *
 * Rent Manager will not create an empty group -- which is a good rule, and
 * the reason this screen exists as one step rather than two. There is no
 * half-made state to recover from: either the group appears with its
 * members, or nothing happened.
 *
 * Searching is by address text on purpose. The lots of a park under
 * redevelopment are "the ones on Lady Cheryl and Lady Viola"; that is how
 * somebody holds it in their head, and matching it literally beats inferring
 * a park from a naming convention that does not exist.
 */
export default function RmMakeGroup() {
  const [search, setSearch] = useState("Lady Cheryl, Lady Viola");
  const [name, setName] = useState("The Retreat at Cross Creek");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"" | "find" | "make">("");
  const [made, setMade] = useState<Made | null>(null);
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function find() {
    setBusy("find"); setErr(null); setMade(null); setSure(false);
    try {
      const res = await fetch("/api/rentmanager/groups/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search }),
      });
      const d = await res.json();
      if (d.error) { setErr(d.error); return; }
      setMatches(d.matches ?? []);
      // Everything found is picked to begin with: the search IS the
      // selection, and unticking two is easier than ticking eight.
      setPicked(new Set((d.matches ?? []).map((m: Match) => m.id)));
    } finally { setBusy(""); }
  }

  async function make() {
    setBusy("make"); setErr(null);
    try {
      const res = await fetch("/api/rentmanager/groups/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, propertyIds: [...picked], go: true }),
      });
      const d = await res.json();
      if (d.error) { setErr(d.error); return; }
      setMade(d as Made);
    } finally { setBusy(""); setSure(false); }
  }

  const toggle = (id: number) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="rmmake">
      <label className="fieldlab" htmlFor="rmq">
        Which properties <span className="opt">— by street, comma separated</span>
      </label>
      <input id="rmq" value={search} onChange={(e) => setSearch(e.target.value)} />

      <label className="fieldlab" htmlFor="rmn">What the group is called in Rent Manager</label>
      <input id="rmn" value={name} onChange={(e) => setName(e.target.value)} />

      <div className="acts" style={{ justifyContent: "flex-start" }}>
        <button className="btn" disabled={busy !== ""} onClick={find}>
          {busy === "find" ? "Looking…" : "Find them"}
        </button>
      </div>

      {err && <p className="err">{err}</p>}

      {matches && (
        <>
          <p className="hint">
            {matches.length} match{matches.length === 1 ? "" : "es"}, {picked.size} picked.
          </p>
          <ul className="rmpick">
            {matches.map((m) => (
              <li key={m.id}>
                <label>
                  <input type="checkbox" checked={picked.has(m.id)}
                         onChange={() => toggle(m.id)} />
                  <span className="mono">{m.code}</span>
                  <span>{m.address || m.name}</span>
                  {m.groups.length > 0 && (
                    <span className="already">already in {m.groups.join(", ")}</span>
                  )}
                </label>
              </li>
            ))}
            {!matches.length && <li className="none">Nothing matched that.</li>}
          </ul>

          {picked.size > 0 && !made && (
            sure ? (
              <div className="rmsure">
                <p>
                  This writes to Rent Manager — the first thing here ever has.
                  It creates a group called <b>{name}</b> with{" "}
                  <b>{picked.size}</b> propert{picked.size === 1 ? "y" : "ies"}{" "}
                  in it. It changes nothing about the properties themselves.
                </p>
                <div className="acts">
                  <button className="btn" autoFocus onClick={() => setSure(false)}>
                    Not yet
                  </button>
                  <button className="btn danger" disabled={busy !== ""}
                          onClick={make}>
                    {busy === "make" ? "Creating…" : "Create it in Rent Manager"}
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn pri" onClick={() => setSure(true)}>
                Create this group in Rent Manager
              </button>
            )
          )}
        </>
      )}

      {made && (
        <div className="rmresult">
          {made.created
            ? <p className="okmsg">
                Created &ldquo;{made.name}&rdquo; with {made.count}{" "}
                propert{made.count === 1 ? "y" : "ies"}
                {made.id ? ` (group ${made.id})` : ""}. Re-read the groups above
                and mark it as a park.
              </p>
            : <p className="err">
                Rent Manager would not create it. Nothing was made — it refuses
                a group it will not accept whole. Its replies are below.
              </p>}
          <ul className="rmlist">
            {made.tried.map((t, i) => (
              <li key={i} className={t.ok ? "ok" : "no"}>
                <span className="rmpath">{t.shape}</span>
                <span className="rmstatus">HTTP {t.status || "—"}</span>
                {t.body && <pre className="rmraw">{t.body}</pre>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
