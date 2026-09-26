"use client";
import { useEffect, useState } from "react";

type Role = "park" | "llc" | "investor" | "managed" | "ignore" | "unset";
type Group = {
  id: string; name: string; role: Role; properties: number; decided: boolean;
  localName: string; localAddress: string;
};

const ROLES: [Role, string, string][] = [
  ["unset", "Not said yet", "Nothing acts on it"],
  ["park", "A park", "Its properties become lots in one park here"],
  ["llc", "One of our companies", "Its properties sit on land we own"],
  // An investor group is a lens, not a structure: those homes stand on lots
  // in our parks and are already placed by the park group. This records that
  // there is a person behind the tag, which "a reporting filter" throws away.
  ["investor", "One investor's homes",
   "A lens over homes in our parks — where they sit is decided by the park"],
  ["managed", "Managed for other people",
   "Ours to run, somebody else's to own — kept out of occupancy and rent roll"],
  ["ignore", "A reporting filter", "Not a real thing — skipped"],
];

/**
 * Saying what each Rent Manager group is.
 *
 * This exists because the answer is not in the data and never will be. A
 * group called "Pines Mobile Home Park" is a park; "Musgrove Holdings" is a
 * company; "Dutch Doors" is a management book; "Non-Musgrove" is a filter
 * meaning everything that is not the other one. They are the same kind of
 * record in Rent Manager and only a person can tell them apart.
 *
 * Saved on change rather than behind a Save button: this is twelve dropdowns
 * set once, and a button at the bottom is how half of them end up unsaved.
 */
export default function RmGroups() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    try {
      const res = await fetch("/api/rentmanager/groups");
      const d = await res.json();
      setPending(d.pending ? d.hint : null);
      setGroups(d.groups ?? []);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function save(id: string, patch: Partial<Group>) {
    setGroups((gs) => (gs ?? []).map((g) =>
      g.id === id
        ? { ...g, ...patch, ...(patch.role ? { decided: patch.role !== "unset" } : {}) }
        : g));
    await fetch("/api/rentmanager/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    }).catch(() => {});
  }

  if (pending) return <p className="notice">{pending}</p>;
  if (!groups) return <p className="hint">{busy ? "Reading the groups…" : ""}</p>;
  if (!groups.length) {
    return (
      <>
        <button className="btn" disabled={busy} onClick={load}>
          {busy ? "Reading…" : "Read the groups from Rent Manager"}
        </button>
        <p className="hint">Sign in with the connection test first.</p>
      </>
    );
  }

  const undecided = groups.filter((g) => g.role === "unset").length;
  // A park with no name of its own would arrive called "The Retreat 2".
  const unnamed = groups.filter((g) => g.role === "park" && !g.localName).length;

  return (
    <>
      <p className={undecided ? "notice" : "okmsg"}>
        {undecided
          ? `${undecided} of ${groups.length} still to say. The import uses this,`
            + " so a park nobody has named stays a pile of separate addresses."
          : `All ${groups.length} accounted for.`}
      </p>

      {unnamed > 0 && (
        <p className="hint">
          {unnamed} park{unnamed === 1 ? "" : "s"} still named the way Rent
          Manager names {unnamed === 1 ? "it" : "them"}. Give{" "}
          {unnamed === 1 ? "it" : "them"} the name you would say on the phone.
        </p>
      )}

      <ul className="rmgroups">
        {groups.map((g) => (
          <li key={g.id} className={g.role === "unset" ? "undecided" : ""}>
            <span className="rgname">
              {g.name}
              <span className="rgcount">
                {g.properties} propert{g.properties === 1 ? "y" : "ies"}
              </span>
            </span>
            <select value={g.role} disabled={saving === g.id}
                    onChange={(e) => save(g.id, { role: e.target.value as Role })}>
              {ROLES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <span className="rgwhat">
              {ROLES.find(([v]) => v === g.role)?.[2]}
            </span>

            {/* Their name for a park is not the name anybody uses. "The
                Retreat 2" is 1148 Northside. A work order that says The
                Retreat 2 sends a tech nowhere, so the park is named here
                rather than inheriting a label from their reporting. */}
            {g.role !== "unset" && g.role !== "ignore" && (
              <div className="rgpark">
                <label>
                  What we call it
                  {g.role === "investor" && (
                    <span className="opt"> — their group is spelled RHMK; ours need not be</span>
                  )}
                  <input defaultValue={g.localName} placeholder={g.name}
                         onBlur={(e) => save(g.id, { localName: e.target.value })} />
                </label>
                {g.role === "park" && (
                  <label>
                    Address <span className="opt">— where the park gate is</span>
                    <input defaultValue={g.localAddress}
                           placeholder="1148 Northside Rd, Elizabeth City, NC"
                           onBlur={(e) => save(g.id, { localAddress: e.target.value })} />
                  </label>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <button className="btn" disabled={busy} onClick={load}>
        {busy ? "Re-reading…" : "Re-read from Rent Manager"}
      </button>
    </>
  );
}
