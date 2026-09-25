"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import CategoryPicker from "./CategoryPicker";

export type RowTarget = {
  id: string;
  name: string;
  phone: string | null;
  claimed: boolean;
  mine: boolean;
  /** The person behind the thread, for naming them without opening it. */
  contactId: string | null;
  party: string;
  unitId: string | null;
  language: string | null;
  named: boolean;
  category: string;
  x: number;
  y: number;
};

/**
 * Right-click a conversation and do the thing, without opening it first.
 *
 * The work these replace is all "open it, do one thing, go back": claiming a
 * run of new threads, passing a leak to the plumber, closing three that are
 * finished. On a list of twenty that is sixty navigations, and it is why
 * things sit unclaimed.
 *
 * It is an addition, not a replacement. Right-click is not discoverable and it
 * does not exist on a phone, so nothing here is the only way to do anything --
 * every item has a home inside the thread as well.
 */
export default function RowMenu(
  { at, onClose, onOpen, onForward, onEditContact, onChanged }:
  {
    at: RowTarget;
    onClose: () => void;
    onOpen: (id: string) => void;
    onForward: (t: RowTarget) => void;
    onEditContact: (t: RowTarget) => void;
    onChanged: () => void;
  },
) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Measured and nudged back inside before it paints. A menu opened near the
  // bottom of the window otherwise runs off the edge, and the items that fall
  // off are the ones at the end -- which is where Close is.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.max(pad, Math.min(at.x, window.innerWidth - r.width - pad)),
      top: Math.max(pad, Math.min(at.y, window.innerHeight - r.height - pad)),
    });
  }, [at.x, at.y]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  async function call(url: string, method = "POST", body?: unknown) {
    setBusy(true); setError(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      setError(out.error ?? "That didn't work.");
      return false;
    }
    onChanged();
    onClose();
    return true;
  }

  return (
    <>
      {/* Catches the click that dismisses, including a second right-click. */}
      <div className="menuveil" onClick={onClose} onContextMenu={(e) => {
        e.preventDefault(); onClose();
      }} />
      <div ref={box} className="rowmenu" style={pos} role="menu"
           onContextMenu={(e) => e.preventDefault()}>
        <span className="ovlabel">{at.name}</span>

        <button className="ovitem" role="menuitem"
                onClick={() => { onOpen(at.id); onClose(); }}>
          Open
        </button>
        {/* The row is a real link, and replacing the browser's own menu took
            its "open in new tab" away. Put it back. */}
        <button className="ovitem" role="menuitem"
                onClick={() => { window.open(`/c/${at.id}`, "_blank", "noopener"); onClose(); }}>
          Open in a new tab
        </button>

        <div className="ovsep" />

        {at.contactId && (
          <button className="ovitem" role="menuitem"
                  onClick={() => onEditContact(at)}>
            {/* Most of these threads are a bare phone number for weeks. Naming
                one is the commonest thing anybody wants to do to a row, and it
                used to mean opening the thread to find the pencil. */}
            {at.named ? "Edit contact…" : "Save contact…"}
          </button>
        )}

        <label className="ovpick">
          <span>Category</span>
          <CategoryPicker conversationId={at.id} category={at.category} />
        </label>

        <div className="ovsep" />

        <button className="ovitem" role="menuitem" disabled={busy}
                onClick={() => onForward(at)}>
          Forward to someone…
        </button>

        {at.mine ? (
          <button className="ovitem" role="menuitem" disabled={busy}
                  onClick={() => call(`/api/conversations/${at.id}/claim`, "DELETE")}>
            Let go of it
          </button>
        ) : (
          <button className="ovitem" role="menuitem" disabled={busy}
                  onClick={() => call(`/api/conversations/${at.id}/claim`)}>
            {at.claimed ? "Take it over" : "Pick it up"}
          </button>
        )}

        <button className="ovitem" role="menuitem" disabled={busy}
                onClick={() => call(`/api/conversations/${at.id}/close`, "POST", { force: true })}>
          Close it
        </button>

        {at.phone && (
          <>
            <div className="ovsep" />
            <button className="ovitem" role="menuitem"
                    onClick={() => {
                      navigator.clipboard?.writeText(at.phone!);
                      onClose();
                    }}>
              Copy number
            </button>
          </>
        )}

        {error && <p className="err menuerr">{error}</p>}
      </div>
    </>
  );
}
