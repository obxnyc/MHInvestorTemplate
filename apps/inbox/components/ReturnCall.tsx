"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Logs who returned the call, then hands off to the phone's dialer. The log
 *  entry is what makes "did anyone call them back?" answerable later. */
export default function ReturnCall({ callId, phone }: { callId: string; phone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    await fetch("/api/calls/return", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId }),
    });
    setBusy(false);
    router.refresh();
    window.location.href = `tel:${phone}`;
  }

  return (
    <button className="mini primary" onClick={go} disabled={busy}>
      {busy ? "…" : "Call back"}
    </button>
  );
}
