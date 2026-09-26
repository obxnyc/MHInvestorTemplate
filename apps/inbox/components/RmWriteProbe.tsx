"use client";
import { useState } from "react";

type Call = {
  path: string; status: number; ok: boolean;
  count: number | null; shape: string[] | null; detail: string | null;
};
type Write = {
  method: string; path: string; status: number; ok: boolean;
  body: string; id: number | null;
};
type Result = {
  signedIn: boolean; stage?: "look" | "try";
  looked?: Call[]; tried?: Write[];
  cleanedUp?: Write | null; litter?: string | null; clean?: boolean;
};

/**
 * Finding out whether a group can be created, before creating a real one.
 *
 * Two buttons because they are two different promises. Looking touches
 * nothing. Trying writes exactly one disposable record and then removes it,
 * and says plainly whether the removal worked -- a test record left behind
 * in a live system is litter in the one place we said we would not touch.
 */
export default function RmWriteProbe() {
  const [out, setOut] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"" | "look" | "try">("");

  async function run(stage: "look" | "try") {
    setBusy(stage); setOut(null);
    try {
      const res = await fetch("/api/rentmanager/probe/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      setOut(await res.json());
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <div className="acts" style={{ justifyContent: "flex-start" }}>
        <button className="btn" disabled={busy !== ""} onClick={() => run("look")}>
          {busy === "look" ? "Looking…" : "Look — reads only"}
        </button>
        {out?.looked && (
          <button className="btn danger" disabled={busy !== ""}
                  onClick={() => run("try")}>
            {busy === "try" ? "Trying…" : "Try one disposable write"}
          </button>
        )}
      </div>
      <p className="hint">
        Looking touches nothing. Trying creates one group called{" "}
        <code>ZZ DELETE ME — connection test</code> and deletes it again,
        then tells you whether the deletion worked.
      </p>

      {out && out.signedIn === false && (
        <p className="err">Not signed in. Run the connection test first.</p>
      )}

      {out?.looked && (
        <ul className="rmlist">
          {out.looked.map((c) => (
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
      )}

      {out?.tried && (
        <div className="rmresult">
          {out.litter
            ? <p className="err">{out.litter}</p>
            : out.clean
              ? <p className="okmsg">Nothing was left behind.</p>
              : null}
          <ul className="rmlist">
            {out.tried.map((w, i) => (
              <li key={i} className={w.ok ? "ok" : "no"}>
                <span className="rmpath">{w.method} {w.path}</span>
                <span className="rmstatus">HTTP {w.status || "—"}</span>
                {w.body && <pre className="rmraw">{w.body}</pre>}
              </li>
            ))}
            {out.cleanedUp && (
              <li className={out.cleanedUp.ok ? "ok" : "no"}>
                <span className="rmpath">
                  {out.cleanedUp.method} {out.cleanedUp.path}
                </span>
                <span className="rmstatus">HTTP {out.cleanedUp.status || "—"}</span>
                {out.cleanedUp.body && <pre className="rmraw">{out.cleanedUp.body}</pre>}
              </li>
            )}
          </ul>
        </div>
      )}
    </>
  );
}
