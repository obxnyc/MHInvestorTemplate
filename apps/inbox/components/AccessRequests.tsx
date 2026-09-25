"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Request = {
  id: string; name: string; email: string; phone: string | null;
  requested: string; reason: string | null; on: string;
};

const ROLES: [string, string][] = [
  ["office", "Office"], ["tech", "Maintenance"],
  ["shower", "Showings"], ["admin", "Admin"],
];

/**
 * People asking to be let in.
 *
 * What they asked for and what they get are two separate things, and the
 * dropdown is set to their request rather than locked to it -- somebody asking
 * for admin because it sounded like the general option should be given office
 * without a second conversation.
 *
 * Approving creates the account. Until then nothing exists: no sign-in, no
 * staff row, nothing any policy in the database will recognise.
 */
export default function AccessRequests() {
  const router = useRouter();
  const [, start] = useTransition();
  const [rows, setRows] = useState<Request[] | null>(null);
  const [role, setRole] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetch("/api/join").then((r) => r.json())
    .then((d) => setRows(d.requests ?? [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  async function decide(r: Request, decision: "approved" | "declined") {
    if (decision === "approved" && !window.confirm(
      `Give ${r.name} ${labelFor(role[r.id] ?? r.requested)} access?`
      + ` They'll be able to sign in with ${r.email}.`)) return;
    setBusy(r.id); setError(null);
    const res = await fetch(`/api/join/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, role: role[r.id] ?? r.requested }),
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "That didn't go through.");
      return;
    }
    load();
    start(() => router.refresh());
  }

  if (!rows) return <p className="pinmuted pad">Loading…</p>;

  return (
    <>
      <p className="muted" style={{ marginTop: ".8rem" }}>
        Send people to <strong>/join</strong> to ask for access. Nothing is open
        to them until you approve it here.
      </p>
      {error && <p className="err">{error}</p>}

      <ul className="people-list">
        {rows.map((r) => (
          <li key={r.id}>
            <span className="p-name">
              {r.name}
              <span className="tag">asked for {labelFor(r.requested)}</span>
            </span>
            <span className="p-sub">
              {r.email}{r.phone ? ` · ${r.phone}` : ""}
              {r.reason ? ` · ${r.reason}` : ""}
            </span>
            <span className="p-acts">
              <select value={role[r.id] ?? r.requested}
                      onChange={(e) => setRole({ ...role, [r.id]: e.target.value })}>
                {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button className="mini" disabled={busy === r.id}
                      onClick={() => decide(r, "declined")}>Decline</button>
              <button className="mini primary" disabled={busy === r.id}
                      onClick={() => decide(r, "approved")}>Approve</button>
            </span>
          </li>
        ))}
        {!rows.length && <li className="none">Nobody is waiting.</li>}
      </ul>
    </>
  );
}

function labelFor(role: string) {
  return ROLES.find(([v]) => v === role)?.[1] ?? role;
}
