"use client";

/**
 * Are you sure.
 *
 * Only for what cannot be undone. A confirmation on something reversible is
 * noise, and a person who is asked to confirm six harmless things a day stops
 * reading the seventh -- which is the one that mattered.
 *
 * So: it names the thing, says what will happen to it in plain words, and the
 * destructive button is the one that does NOT have focus. Cancel is first in
 * the DOM and gets the Enter key, because the muscle memory that got somebody
 * here by accident is the same muscle memory that dismisses a dialog.
 */
export default function Confirm(
  { what, detail, confirmLabel = "Delete", busy, onConfirm, onCancel }:
  {
    what: string;
    detail?: string;
    confirmLabel?: string;
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  },
) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Delete ${what}`}
         onClick={onCancel}
         onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Delete {what}?</h3>
        <p>{detail ?? "This cannot be undone."}</p>
        <div className="acts">
          <button className="btn" autoFocus onClick={onCancel}>Keep it</button>
          <button className="btn danger" disabled={busy} onClick={onConfirm}>
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
