"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { threadChanged } from "@/lib/refresh";
import { joinTyping, sendTyping, TYPING_TTL } from "@/lib/typing";
import type { RealtimeChannel } from "@supabase/supabase-js";

export default function Composer(
  { conversationId, myName, sendsIn, insert, onSent }:
  { conversationId: string; myName?: string; sendsIn?: string | null;
    /** Awaited after a send, so the thread reloads because this asked it to
     *  rather than because an event happened to be heard. */
    onSent?: () => void | Promise<void>;
    /** Text pushed in from outside -- a suggested question. `n` increments on
     *  every push so the same question twice still arrives twice. */
    insert?: { text: string; n: number } },
) {
  const router = useRouter();
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
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

  // Appended rather than replacing, so picking three questions builds a
  // message instead of overwriting the last one. Focus follows, because the
  // next thing anybody does is edit what just landed.
  const lastInsert = useRef(0);
  useEffect(() => {
    if (!insert || insert.n === lastInsert.current) return;
    lastInsert.current = insert.n;
    setText((t) => (t.trim() ? `${t.replace(/\s+$/, "")}\n\n${insert.text}` : insert.text));
    box.current?.focus();
  }, [insert]);

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
    const out = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) { setError("Didn't send. Try again."); return; }

    // The reply route answers 200 with ok:false when the carrier REJECTED the
    // message -- it records the attempt and moves on, which is right, but the
    // box was only checking the HTTP status. So a rejected text cleared the
    // box and looked exactly like a sent one. The row is written either way,
    // so this is about telling the person who typed it.
    if (out.ok === false) {
      setError(out.status === "failed"
        ? "Written to the thread, but the carrier rejected it. It did not go out."
        : "Didn't send. Try again.");
    } else {
      setText("");
    }

    // Reload first and wait for it, so the message is on screen before anything
    // else happens. The event and the router refresh stay for everyone else
    // listening, but this no longer depends on either arriving.
    await onSent?.();
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
          ref={box}
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
