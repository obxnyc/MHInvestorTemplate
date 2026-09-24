"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function Composer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/conversations/${conversationId}/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
    setBusy(false);
    if (!res.ok) { setError("Didn't send. Try again."); return; }
    setText("");
    start(() => router.refresh());
  }

  return (
    <form className={`composer ${mode}`} onSubmit={submit}>
      <div className="modes">
        <button type="button" className={mode === "reply" ? "on" : ""}
                onClick={() => setMode("reply")}>Text</button>
        <button type="button" className={mode === "note" ? "on" : ""}
                onClick={() => setMode("note")}>Note</button>
      </div>
      <div className="inputrow">
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={1}
          placeholder={mode === "reply" ? "Message" : "Note for your team — not sent"}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — phone-app behaviour.
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e); }
          }}
        />
        <button type="submit" className="sendbtn" disabled={busy || !text.trim()}
                aria-label={mode === "reply" ? "Send message" : "Save note"}>↑</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
