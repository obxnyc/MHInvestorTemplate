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
