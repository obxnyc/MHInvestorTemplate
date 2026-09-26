"use client";
import { useState } from "react";

type Call = {
  path: string; status: number; ok: boolean;
  count: number | null; shape: string[] | null; detail: string | null;
};
type Attempt = { base: string; status: number; ok: boolean; detail: string };
type EmbedTry = {
  embed: string; ok: boolean; status: number;
  added: string[]; within: Record<string, string[]>; detail: string | null;
};
type Found = { entity: string; base: string[]; tries: EmbedTry[] };
type Tally = { seen: number; written: number };
type Row = {
  code: string; name: string; kind: string; units: number;
  unitNames: string[]; vacant: number;
  owner: string | null; address: string | null; existing: boolean;
  groups: string[];
};
type Import = {
  ok: boolean; dryRun: boolean; error?: string;
  owners: Tally; properties: Tally; units: Tally; notes: string[];
  preview?: Row[];
};
type Result = {
  configured: boolean; company?: string; signedIn?: boolean;
  base?: string; header?: string; hint?: string;
  attempts?: Attempt[]; open?: number; tried?: number; calls?: Call[];
};

/**
 * The button that finds out.
 *
 * Everything it learns comes from the deployment talking to Rent Manager.
 * Nothing in the browser knows a password and nothing it prints contains
 * one -- the hostname and the field names are all that come back.
 */
export default function RentManagerProbe() {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Result | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deep, setDeep] = useState<{ found?: Found[]; hint?: string } | null>(null);
  const [digging, setDigging] = useState(false);
  const [pulled, setPulled] = useState<Import | null>(null);
  const [pulling, setPulling] = useState<"" | "dry" | "real">("");

  async function run() {
    setBusy(true); setFailed(null); setOut(null); setCopied(false);
    try {
      const res = await fetch("/api/rentmanager/probe", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setFailed(data.error ?? "That didn't run."); return; }
      setOut(data as Result);
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Where the rent, the balances and the lease dates actually live. */
  async function dig() {
    setDigging(true); setDeep(null);
    try {
      const res = await fetch("/api/rentmanager/probe/deep", { method: "POST" });
      setDeep(await res.json());
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setDigging(false);
    }
  }

  /** The rehearsal, then the thing itself. Nothing writes without `go`. */
  async function pull(go: boolean) {
    setPulling(go ? "real" : "dry"); setPulled(null); setFailed(null);
    try {
      const res = await fetch("/api/rentmanager/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ go }),
      });
      setPulled(await res.json());
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setPulling("");
    }
  }

  /** So the result can be pasted as text rather than photographed. A
   *  screenshot of forty field names is a screenshot nobody can read. */
  async function copy() {
    if (!out && !deep) return;
    await navigator.clipboard.writeText(JSON.stringify(deep ?? out, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div className="acts" style={{ justifyContent: "flex-start" }}>
        <button className="btn pri" disabled={busy} onClick={run}>
          {busy ? "Asking Rent Manager…" : "Test the connection"}
        </button>
        {out?.signedIn && (
          <button className="btn" disabled={digging} onClick={dig}>
            {digging ? "Digging…" : "Find the detail"}
          </button>
        )}
        {(out || deep) && (
          <button className="btn" onClick={copy}>
            {copied ? "Copied" : "Copy the result"}
          </button>
        )}
      </div>
      {busy && (
        <p className="hint">
          Trying each address in turn. Up to a minute if some of them do not
          answer at all.
        </p>
      )}

      {failed && <p className="err">{failed}</p>}

      {out && !out.configured && <p className="notice">{out.hint}</p>}

      {out?.configured && out.signedIn === false && (
        <div className="rmresult">
          <p className="err">Could not sign in to Rent Manager as &ldquo;{out.company}&rdquo;.</p>
          <ul className="rmlist">
            {(out.attempts ?? []).map((a) => (
              <li key={a.base} className="no">
                <span className="rmpath">{a.base}</span>
                <span className="rmstatus">{a.status ? `HTTP ${a.status}` : "no answer"}</span>
                <span className="rmwhy">{a.detail}</span>
              </li>
            ))}
          </ul>
          <p className="hint">{out.hint}</p>
        </div>
      )}

      {out?.signedIn && (
        <div className="rmresult">
          <p className="okmsg">
            Signed in at {out.base} — token accepted as {out.header}.{" "}
            {out.open} of {out.tried} endpoints answered.
          </p>
          <ul className="rmlist">
            {(out.calls ?? []).map((c) => (
              <li key={c.path} className={c.ok ? "ok" : "no"}>
                <span className="rmpath">{c.path.split("?")[0]}</span>
                <span className="rmstatus">
                  {c.ok ? (c.count === null ? "answered" : `${c.count} record`)
                        : `HTTP ${c.status || "—"}`}
                </span>
                {c.shape && (
                  <details className="rmshape">
                    <summary>{c.shape.length} fields</summary>
                    <p>{c.shape.join(", ")}</p>
                  </details>
                )}
                {c.detail && <span className="rmwhy">{c.detail}</span>}
              </li>
            ))}
          </ul>
          <p className="whosnote">
            One record per endpoint, and only the field names left Rent
            Manager. No resident data was fetched.
          </p>
        </div>
      )}

      {digging && (
        <p className="hint">
          Around sixty requests, one at a time. Two or three minutes.
        </p>
      )}

      {out?.signedIn && (
        <div className="rmpull">
          <h3>Bring the portfolio across</h3>
          <div className="acts" style={{ justifyContent: "flex-start" }}>
            <button className="btn" disabled={pulling !== ""}
                    onClick={() => pull(false)}>
              {pulling === "dry" ? "Counting…" : "Rehearse it"}
            </button>
            {pulled?.dryRun && pulled.ok && (
              <button className="btn pri" disabled={pulling !== ""}
                      onClick={() => pull(true)}>
                {pulling === "real" ? "Importing…" : "Do it for real"}
              </button>
            )}
          </div>
          <p className="hint">
            A rehearsal reads everything and writes nothing. Read-only either
            way — nothing is ever sent back to Rent Manager.
          </p>

          {pulled && !pulled.ok && <p className="err">{pulled.error}</p>}

          {pulled?.ok && (
            <>
              <p className={pulled.dryRun ? "notice" : "okmsg"}>
                {pulled.dryRun ? "Rehearsal — nothing was written. " : "Imported. "}
                {pulled.properties.seen} properties ({pulled.properties.written}{" "}
                {pulled.dryRun ? "would be new" : "new"}),{" "}
                {pulled.units.seen} units ({pulled.units.written}{" "}
                {pulled.dryRun ? "would be new" : "new"}),{" "}
                {pulled.owners.seen} owner LLCs ({pulled.owners.written}{" "}
                {pulled.dryRun ? "would be new" : "new"}).
              </p>
              {pulled.preview && <Rehearsal rows={pulled.preview} />}

              {pulled.notes.length > 0 && (
                <>
                  <p className="hint">
                    {pulled.notes.length} thing{pulled.notes.length === 1 ? "" : "s"}{" "}
                    that did not fit. These are jobs in Rent Manager, not errors here:
                  </p>
                  <ul className="rmnotes">
                    {pulled.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}

      {deep?.found && (
        <div className="rmresult">
          <p className="okmsg">
            {deep.found.reduce((n, f) => n + f.tries.filter((t) => t.ok && t.added.length).length, 0)}
            {" "}useful embeds found.
          </p>
          {deep.found.map((f) => (
            <div key={f.entity} className="rmentity">
              <h3>{f.entity}</h3>
              <ul className="rmlist">
                {f.tries.map((t) => (
                  <li key={t.embed} className={t.ok && t.added.length ? "ok" : "no"}>
                    <span className="rmpath">{t.embed}</span>
                    <span className="rmstatus">
                      {t.ok ? (t.added.length ? `+${t.added.length}` : "empty")
                            : `HTTP ${t.status || "—"}`}
                    </span>
                    {t.added.length > 0 && (
                      <details className="rmshape">
                        <summary>{t.added.join(", ")}</summary>
                        {Object.entries(t.within).map(([k, keys]) => (
                          <p key={k}><strong>{k}</strong>: {keys.join(", ") || "—"}</p>
                        ))}
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  );
}


/**
 * What the import would actually make, listed.
 *
 * A total is not a check. "259 properties" reads identically whether the
 * mapping is right or has flattened every park into two hundred separate
 * addresses -- and the only way to tell is to look at the rows and see
 * whether you recognise your own portfolio in them.
 *
 * So: the counts that would give it away first, then every row.
 */
function Rehearsal({ rows }: { rows: Row[] }) {
  const [all, setAll] = useState(false);

  const byKind = new Map<string, number>();
  for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);

  const noUnits = rows.filter((r) => r.units === 0);
  const noAddress = rows.filter((r) => !r.address);
  const noOwner = rows.filter((r) => !r.owner);
  const multi = rows.filter((r) => r.units > 1);
  const shown = all ? rows : rows.slice(0, 25);

  const groupCount = new Map<string, number>();
  for (const r of rows) {
    for (const g of r.groups ?? []) groupCount.set(g, (groupCount.get(g) ?? 0) + 1);
  }
  const groupNames = [...groupCount.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="rehearsal">
      <ul className="rehstats">
        <li><b>{rows.length}</b> properties</li>
        <li><b>{multi.length}</b> with more than one unit</li>
        <li className={noUnits.length ? "warn" : ""}>
          <b>{noUnits.length}</b> with no units at all
        </li>
        <li className={noAddress.length ? "warn" : ""}>
          <b>{noAddress.length}</b> with no address
        </li>
        <li className={noOwner.length ? "warn" : ""}>
          <b>{noOwner.length}</b> with no owner LLC
        </li>
      </ul>
      <p className="hint">
        Guessed as: {[...byKind.entries()].map(([k, n]) => `${n} ${k}`).join(", ")}.
        {" "}If a park you own is not in that list as <code>mhp</code>, the shape
        did not come across and this should not be run for real yet.
      </p>

      {/* The two sets that decide whether this is safe, pulled out by name.
          A count of twenty-six tells you nothing; twenty-six names tell you
          immediately whether they are the parks. */}
      {noUnits.length > 0 && (
        <details className="rehodd" open>
          <summary>{noUnits.length} with no units — are these your parks?</summary>
          <p className="mono">{noUnits.map((r) => r.name).join(" · ")}</p>
        </details>
      )}
      {multi.length > 0 && (
        <details className="rehodd" open>
          <summary>{multi.length} with more than one unit</summary>
          <ul className="rehmulti">
            {multi.map((r) => (
              <li key={r.code}>
                <b>{r.name}</b> — {r.units} units
                <span className="unames">{r.unitNames.join(", ")}…</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {groupNames.length > 0 && (
        <details className="rehodd" open>
          <summary>
            {groupNames.length} property group{groupNames.length === 1 ? "" : "s"} in
            Rent Manager
          </summary>
          <p className="mono">
            {groupNames.map(([g, n]) => `${g} (${n})`).join(" · ")}
          </p>
        </details>
      )}

      <table className="rehtable">
        <thead>
          <tr><th>Code</th><th>Name</th><th>Type</th><th>Units</th>
              <th>Group</th><th>Owner</th><th>Address</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.code} className={r.units === 0 ? "warn" : ""}>
              <td className="mono">{r.code}</td>
              <td>{r.name}{r.existing && <span className="already">already here</span>}</td>
              <td className="mono">{r.kind}</td>
              <td>
                {r.units}
                {r.unitNames.length > 0 && (
                  <span className="unames">{r.unitNames.join(", ")}</span>
                )}
              </td>
              <td className="mono">{(r.groups ?? []).join(", ") || "—"}</td>
              <td>{r.owner ?? "—"}</td>
              <td>{r.address ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 25 && (
        <button type="button" className="btn" onClick={() => setAll((v) => !v)}>
          {all ? "Show the first 25" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
