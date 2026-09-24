"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type OpenWork = { id: string; summary: string; status: string };

/** Closing a thread is a normal, frequent action — one button, in the header.
 *  The only friction is when real work is still outstanding. */
export default function CloseButton(
  { conversationId, isClosed }: { conversationId: string; isClosed: boolean },
) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [blocking, setBlocking] = useState<OpenWork[] | null>(null);

  async function send(body: object) {
    const res = await fetch(`/api/conversations/${conversationId}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 409) { setBlocking((await res.json()).workOrders); return; }
    setBlocking(null);
    start(() => router.refresh());
  }

  if (blocking) {
    return (
      <div className="closewarn">
        <p>
          {blocking.length === 1 ? "A work order is" : `${blocking.length} work orders are`}
          {" "}still open on this: {blocking.map((w) => w.summary).join("; ")}.
        </p>
        <div className="acts">
          <button onClick={() => setBlocking(null)}>Keep it open</button>
          <button className="danger" onClick={() => send({ force: true })}>
            Close anyway
          </button>
        </div>
      </div>
    );
  }

  return (
    <button className={isClosed ? "btn" : "btn close"} disabled={pending}
            onClick={() => send({ reopen: isClosed })}>
      {isClosed ? "Reopen" : "Close"}
    </button>
  );
}
