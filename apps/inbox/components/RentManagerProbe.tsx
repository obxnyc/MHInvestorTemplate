"use client";
import { useState } from "react";

type Call = {
  path: string; status: number; ok: boolean;
  count: number | null; shape: string[] | null; detail: string | null;
};
type Result = {
  configured: boolean; base?: string; signedIn?: boolean;
  status?: number; detail?: string; hint?: string;
  open?: number; tried?: number; calls?: Call[];
};

/** The button that finds out. Everything it learns comes from the deployment
 *  talking to Rent Manager -- nothing here knows a password, and nothing it
 *  prints contains one. */
export default function RentManagerProbe() {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Result | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function run() {
    setBusy(true); setFailed(null); setOut(null);
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

  return (
    <>
      <button className="btn pri" disabled={busy} onClick={run}>
        {busy ? "Asking Rent Manager…" : "Test the connection"}
      </button>

      {failed && <p className="err">{failed}</p>}

      {out && !out.configured && (
        <p className="notice">{out.hint}</p>
      )}

      {out?.configured && out.signedIn === false && (
        <div className="rmresult">
          <p className="err">
            Signed in to <code>{out.base}</code> — refused
            {out.status ? ` (HTTP ${out.status})` : ""}.
          </p>
          {out.detail && <pre className="rmraw">{out.detail}</pre>}
          <p className="hint">{out.hint}</p>
        </div>
      )}

      {out?.signedIn && (
        <div className="rmresult">
          <p className="okmsg">
            Signed in to {out.base}. {out.open} of {out.tried} endpoints answered.
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
                  /* The field names are the map. This is what says whether
                     their "Unit" has the lot number we key everything on, and
                     what it is called when it does. */
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
            No resident data was fetched — one record per endpoint, and only
            the field names are shown.
          </p>
        </div>
      )}
    </>
  );
}
