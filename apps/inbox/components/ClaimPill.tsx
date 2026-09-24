"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const initials = (n: string) =>
  n.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

/** One tap, in the header, the way a phone app would do it — not a banner
 *  across the conversation. Two people tapping at the same instant resolve to
 *  one winner server-side; the loser is told who beat them. */
export default function ClaimPill(
  { conversationId, holderName, isMine }:
  { conversationId: string; holderName: string | null; isMine: boolean },
) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [conflict, setConflict] = useState<string | null>(null);

  async function claim() {
    setConflict(null);
    const res = await fetch(`/api/conversations/${conversationId}/claim`, { method: "POST" });
    if (res.status === 409) setConflict((await res.json()).heldBy);
    start(() => router.refresh());
  }
  async function release() {
    await fetch(`/api/conversations/${conversationId}/claim`, { method: "DELETE" });
    start(() => router.refresh());
  }

  if (isMine) {
    return <button className="takepill mine" onClick={release} disabled={pending}>
      You have it ✓
    </button>;
  }
  if (conflict) {
    return <button className="takepill other" onClick={claim} disabled={pending}>
      {conflict} got there first · Take over
    </button>;
  }
  if (holderName) {
    return <button className="takepill other" onClick={claim} disabled={pending}>
      {initials(holderName)} has it · Take over
    </button>;
  }
  return <button className="takepill" onClick={claim} disabled={pending}>Take it</button>;
}
