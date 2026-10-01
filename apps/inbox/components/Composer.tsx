"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { threadChanged } from "@/lib/refresh";
import { joinTyping, sendTyping, TYPING_TTL } from "@/lib/typing";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { AttachStrip, AttachButton } from "./Attach";
import { useAttachments } from "./useAttachments";

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
  const [dragging, setDragging] = useState(false);
  const [, start] = useTransition();

  const files = useAttachments(`/api/conversations/${conversationId}/attach`);
  // A text carries only what a carrier will carry; a note carries anything.
  const unsendable = mode === "reply" && files.items.some((f) => !f.sendable);
  const hasSomething = text.trim().length > 0 || files.items.length > 0;

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

  /** Files off a paste or a drop. A clipboard carries a screenshot as an
   *  item with no name, which is exactly the case this exists for. */
  function fromTransfer(list: DataTransferItemList | null, fallback: FileList | null): File[] {
    const out: File[] = [];
    for (const item of list ?? []) {
      if (item.kind !== "file") continue;
      const f = item.getAsFile();
      if (f) out.push(f);
    }
    if (!out.length) out.push(...(fallback ?? []));
    return out;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // A photograph with no caption is a whole message. What is not a message
    // is nothing at all, or a spreadsheet aimed at a phone.
    if (!hasSomething || unsendable || files.busy > 0) return;
    setBusy(true); setError(null);
    const res = await fetch(`/api/conversations/${conversationId}/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text, media: files.items.map((f) => f.path) }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) { setError(out.error ?? "Didn't send. Try again."); return; }

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
      // Cleared only on a send that stuck. Losing the picture along with the
      // message would mean picking it off a phone a second time.
      files.clear();
      if (out.warning) setError(out.warning);
    }

    // Reload first and wait for it, so the message is on screen before anything
    // else happens. The event and the router refresh stay for everyone else
    // listening, but this no longer depends on either arriving.
    await onSent?.();
    start(() => (threadChanged(), router.refresh()));
  }

  return (
    <form
      className={`composer ${mode}${dragging ? " dragging" : ""}`}
      onSubmit={submit}
      // Dropped anywhere on the composer, not only on the paperclip: dragging
      // a photo at a 2 cm target is a thing people miss.
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault(); setDragging(false);
        void files.take(fromTransfer(e.dataTransfer.items, e.dataTransfer.files));
      }}
    >
      <div className="modes">
        <button type="button" className={mode === "reply" ? "on" : ""}
                onClick={() => setMode("reply")}>Text</button>
        <button type="button" className={mode === "note" ? "on" : ""}
                onClick={() => setMode("note")}>Note</button>
      </div>
      <AttachStrip
        items={files.items} busy={files.busy} problem={files.problem}
        onRemove={files.remove} sendableOnly={mode === "reply"}
      />
      <div className="inputrow">
        <AttachButton onPick={(picked) => void files.take(picked)}
                      disabled={busy || files.busy > 0} />
        <textarea
          ref={box}
          value={text}
          onChange={(e) => { setText(e.target.value); if (mode === "reply") announceTyping(); }}
          // The whole reason this was worth building. A screenshot of an
          // account goes Cmd+Shift+4 then Cmd+V, with no file on a disk
          // anywhere in between.
          onPaste={(e) => {
            const picked = fromTransfer(e.clipboardData?.items ?? null, e.clipboardData?.files ?? null);
            if (picked.length) { e.preventDefault(); void files.take(picked); }
          }}
          rows={1}
          placeholder={mode === "reply"
            ? (sendsIn ? `Message — sends in ${sendsIn}` : "Message")
            : "Note for your team — not sent"}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — phone-app behaviour.
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e); }
          }}
        />
        <button type="submit" className="sendbtn"
                disabled={busy || !hasSomething || unsendable || files.busy > 0}
                aria-label={mode === "reply" ? "Send message" : "Save note"}>↑</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
