"use client";
import { useState } from "react";

export default function CancelShowing({ token }: { token: string }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function cancel() {
    setBusy(true); setSaid(null);
    const res = await fetch("/api/showings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ manage: token, action: "cancel" }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!res || !res.ok) { setSaid(out.error ?? "That didn't go through. Please try again."); return; }
    setDone(true);
  }

  if (done) return <p className="lede">Cancelled. Thanks for letting us know.</p>;
  return (
    <div className="showcancel">
      {sure ? (
        <>
          <p>Cancel this showing?</p>
          <button className="btn danger" disabled={busy} onClick={cancel}>
            {busy ? "Cancelling…" : "Yes, cancel it"}
          </button>{" "}
          <button className="btn" disabled={busy} onClick={() => setSure(false)}>Keep it</button>
        </>
      ) : (
        <button className="btn" onClick={() => setSure(true)}>I can&rsquo;t make it</button>
      )}
      {said ? <p className="error">{said}</p> : null}
    </div>
  );
}
