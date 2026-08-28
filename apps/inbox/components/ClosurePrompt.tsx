"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * The recycle prompt. Appears on a thread that has gone quiet and cannot lapse
 * on its own — maintenance, or a tenant conversation with nothing written on it.
 *
 * There is no "dismiss". The only ways out are closing it or saying what is
 * still outstanding, because a prompt you can wave away is a prompt everyone
 * waves away.
 */
export default function ClosurePrompt(
  { conversationId, daysQuiet, prompts, needsNote }:
  { conversationId: string; daysQuiet: number; prompts: number; needsNote: boolean },
) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function close() {
    const res = await fetch(`/api/conversations/${conversationId}/close`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.status === 409) { setError("A work order is still open on this."); return; }
    start(() => router.refresh());
  }

  async function stillOpen() {
    setError(null);
    const res = await fetch(`/api/conversations/${conversationId}/still-open`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (!res.ok) { setError("Add a line about what's outstanding."); return; }
    setWriting(false); setNote("");
    start(() => router.refresh());
  }

  const insistent = prompts >= 3;

  return (
    <div className={insistent ? "recycle loud" : "recycle"}>
      <div className="head">
        <strong>Quiet for {daysQuiet} days. Is this finished?</strong>
        {prompts > 1 && (
          <span className="count">
            asked {prompts}&times;
          </span>
        )}
      </div>
      <p>
        {needsNote
          ? "Tenant conversations need a note before they can close themselves — so what happened is written down while someone still remembers."
          : "Maintenance never closes on its own. Someone has to say the work is done."}
      </p>

      {writing ? (
        <div className="writing">
          <textarea
            rows={2} value={note} autoFocus
            onChange={(e) => setNote(e.target.value)}
            placeholder="What's still outstanding? e.g. waiting on the part, tech booked Thursday"
          />
          <div className="acts">
            <button onClick={() => setWriting(false)}>Cancel</button>
            <button className="primary" disabled={pending || !note.trim()} onClick={stillOpen}>
              Save &amp; ask again in a week
            </button>
          </div>
        </div>
      ) : (
        <div className="acts">
          <button onClick={() => setWriting(true)}>Still open&hellip;</button>
          <button className="primary" disabled={pending} onClick={close}>
            Yes, close it
          </button>
        </div>
      )}
      {error && <p className="err">{error}</p>}
    </div>
  );
}
