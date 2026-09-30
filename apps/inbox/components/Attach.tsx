"use client";
import { useRef } from "react";
import type { Attached } from "./useAttachments";

/**
 * What is attached, and how to get rid of it.
 *
 * Two pieces rather than one because they belong in two places: the strip of
 * thumbnails sits above the text box, where it can be as tall as it needs to
 * be, and the paperclip sits inside the row next to the send button. A single
 * component would have put a growing list inside a flex row and pushed the
 * send button off a phone.
 *
 * Both are views. Picking, shrinking and uploading live in useAttachments,
 * because the composer also feeds it pastes and drops.
 */
export function AttachStrip(
  { items, busy, problem, onRemove, sendableOnly }:
  {
    items: Attached[];
    busy: number;
    problem: string | null;
    onRemove: (path: string) => void;
    /** True on a text message: flag anything a phone cannot receive. */
    sendableOnly: boolean;
  },
) {
  const blocked = items.filter((f) => sendableOnly && !f.sendable);
  if (!items.length && !busy && !problem) return null;

  return (
    <div className="attachbar">
      {(items.length > 0 || busy > 0) && (
        <ul className="attachrow">
          {items.map((f) => (
            <li key={f.path}
                className={`thumb${f.preview ? "" : " doc"}`
                         + `${sendableOnly && !f.sendable ? " nogo" : ""}`}>
              {f.preview
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={f.preview} alt={f.name} />
                : <span className="docname" title={f.name}>{f.name}</span>}
              <button
                type="button" className="rm" aria-label={`Remove ${f.name}`}
                onClick={() => onRemove(f.path)}
              >×</button>
            </li>
          ))}
          {busy > 0 && <li className="thumb loading" aria-label="Uploading">…</li>}
        </ul>
      )}

      {blocked.length > 0 && (
        <p className="attachwarn">
          {blocked.map((f) => f.name).join(", ")} can&rsquo;t be texted.
          Switch to <strong>Note</strong> to keep {blocked.length === 1 ? "it" : "them"} on
          the conversation, or send a PDF.
        </p>
      )}
      {problem && <p className="attachwarn">{problem}</p>}
    </div>
  );
}

export function AttachButton(
  { onPick, disabled }: { onPick: (files: File[]) => void; disabled?: boolean },
) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input} type="file" multiple hidden
        // Deliberately not restricted to images. Half of what wants attaching
        // is a PDF of a lease or a spreadsheet of a ledger; the server decides
        // what is acceptable and says so by name.
        onChange={(e) => {
          onPick([...(e.target.files ?? [])]);
          // Cleared so choosing the same file twice in a row still fires.
          e.target.value = "";
        }}
      />
      <button
        type="button" className="clip" disabled={disabled}
        onClick={() => input.current?.click()}
        aria-label="Attach a photo or file" title="Attach a photo or file"
      >
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"
             fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.18 5.18l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.59l8.49-8.48" />
        </svg>
      </button>
    </>
  );
}
