"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { threadChanged } from "@/lib/refresh";
import { joinTyping, sendTyping, TYPING_TTL } from "@/lib/typing";
import type { RealtimeChannel } from "@supabase/supabase-js";

export default function Composer(
  { conversationId, myName, sendsIn }:
  { conversationId: string; myName?: string; sendsIn?: string | null },
) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  // Announced, not stored. A keystroke tells the rest of the team you are on
  // this one, so two people do not answer the same tenant from the same number
  // thirty seconds apart -- which reads, from the outside, as an office that
  // does not talk to itself.
  const channel = useRef<RealtimeChannel | null>(null);
  const lastSent = useRef(0);
  useEffect(() => {
    if (!myName) return;
    const ch = joinTyping(conversationId, () => {});
    channel.current = ch;
    return () => { ch.unsubscribe(); channel.current = null; };
  }, [conversationId, myName]);

  function announceTyping() {
    // Throttled to well inside the window a keystroke buys, so a fast typist
    // sends a handful of tiny messages a minute rather than one per character.
    const now = Date.now();
    if (!channel.current || !myName || now - lastSent.current < TYPING_TTL / 3) return;
    lastSent.current = now;
    sendTyping(channel.current, myName);
  }

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
    start(() => (threadChanged(), router.refresh()));
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
          value={text}
          onChange={(e) => { setText(e.target.value); if (mode === "reply") announceTyping(); }}
          rows={1}
          placeholder={mode === "reply"
            ? (sendsIn ? `Message — sends in ${sendsIn}` : "Message")
            : "Note for your team — not sent"}
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
