"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function ClaimBar(
  { conversationId, holderName, isMine }:
  { conversationId: string; holderName: string | null; isMine: boolean },
) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [conflict, setConflict] = useState<string | null>(null);

  async function claim() {
    setConflict(null);
    const res = await fetch(`/api/conversations/${conversationId}/claim`, { method: "POST" });
    if (res.status === 409) {
      // Somebody beat us to it by a fraction of a second. Say so plainly
      // rather than pretending the tap did nothing.
      const { heldBy } = await res.json();
      setConflict(`${heldBy} picked this up first.`);
    }
    start(() => router.refresh());
  }

  async function release() {
    await fetch(`/api/conversations/${conversationId}/claim`, { method: "DELETE" });
    start(() => router.refresh());
  }

  if (isMine) {
    return (
      <div className="claimbar mine">
        <span>You have this one.</span>
        <button onClick={release} disabled={pending}>Hand back</button>
      </div>
    );
  }
  if (holderName) {
    return (
      <div className="claimbar held">
        <span><strong>{holderName}</strong> is handling this.</span>
        <button onClick={claim} disabled={pending}>Take over</button>
      </div>
    );
  }
  return (
    <div className="claimbar open">
      <span>{conflict ?? "Nobody has picked this up."}</span>
      <button className="primary" onClick={claim} disabled={pending}>I've got this</button>
    </div>
  );
}
