"use client";
import { useEffect, useRef } from "react";
import { ACTIVITY_KEY, BEAT_MS, HIDDEN_AFTER_MS, IDLE_AFTER_MS } from "@/lib/presence";

/**
 * Tells the server this tab is still open, and whether anybody is at it.
 *
 * No UI. Mounted once in the app shell, so it runs on whatever screen somebody
 * happens to be on.
 *
 * Idle is decided here rather than on the server because the keyboard is here.
 * A server can only ever know the last time a request arrived, which makes
 * somebody reading a long thread look like somebody who went to lunch.
 *
 * Two things this gets wrong if written the obvious way, and both of them
 * showed up as an amber dot next to somebody sitting right there:
 *
 * Every tab writes to the same row. A second window left open in the
 * background would beat "idle" every forty-five seconds and overwrite the
 * window actually being worked in. So the last real interaction is shared
 * between tabs through localStorage, and every tab reports the most recent
 * one rather than its own.
 *
 * And moving the mouse is using the computer. Counting only clicks and keys
 * meant reading a page for five minutes was indistinguishable from leaving.
 */
export default function Heartbeat() {
  const lastInput = useRef(Date.now());
  const wrote = useRef(0);
  const said = useRef<"active" | "idle" | null>(null);

  useEffect(() => {
    let alive = true;

    /** The newest interaction in ANY tab of this browser. */
    function newest() {
      let shared = 0;
      try { shared = Number(localStorage.getItem(ACTIVITY_KEY) ?? 0) || 0; } catch {
        // Private windows and blocked storage. This tab then speaks only for
        // itself, which is the old behaviour and still correct for one tab.
      }
      return Math.max(lastInput.current, shared);
    }

    const touched = () => {
      const now = Date.now();
      lastInput.current = now;
      // Throttled: mousemove fires hundreds of times a minute and this is a
      // synchronous write other tabs will be woken by.
      if (now - wrote.current > 5_000) {
        wrote.current = now;
        try { localStorage.setItem(ACTIVITY_KEY, String(now)); } catch { /* see above */ }
      }
      // Coming back should turn the dot green now, not at the next beat.
      if (said.current === "idle") beat();
    };

    const events = ["pointerdown", "pointermove", "keydown", "wheel",
                    "touchstart", "scroll", "focus"] as const;
    for (const e of events) window.addEventListener(e, touched, { passive: true });

    async function beat() {
      if (!alive) return;
      const quiet = Date.now() - newest();
      const idle = quiet > (document.hidden ? HIDDEN_AFTER_MS : IDLE_AFTER_MS);
      const state = idle ? "idle" : "active";
      const changed = said.current !== state;
      said.current = state;
      try {
        await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state }),
          keepalive: true,
        });
        // Nudge the panel, if one is on screen, rather than making it wait out
        // its own polling interval to notice you came back.
        if (changed) window.dispatchEvent(new Event("presence:changed"));
      } catch {
        // A missed beat is not worth a console line. Several in a row is what
        // "offline" means, and working that out is the server's job.
      }
    }

    beat();
    const timer = setInterval(beat, BEAT_MS);
    const onShow = () => { if (!document.hidden) { touched(); beat(); } };
    document.addEventListener("visibilitychange", onShow);

    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      for (const e of events) window.removeEventListener(e, touched);
    };
  }, []);

  return null;
}
