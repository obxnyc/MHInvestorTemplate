"use client";
import { useEffect, useRef } from "react";
import { BEAT_MS, IDLE_AFTER_MS } from "@/lib/presence";

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
 * A hidden tab counts as idle immediately -- it is a tab they left open, not a
 * person at a desk -- and the beat keeps going anyway, slowed by the browser,
 * which is how "away" stays distinguishable from "gone home".
 */
export default function Heartbeat() {
  const lastInput = useRef(Date.now());

  useEffect(() => {
    let alive = true;

    const touched = () => { lastInput.current = Date.now(); };
    // Passive: these fire constantly and none of them is ever cancelled.
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "focus"] as const;
    for (const e of events) window.addEventListener(e, touched, { passive: true });

    async function beat() {
      if (!alive) return;
      const idle = document.hidden
        || Date.now() - lastInput.current > IDLE_AFTER_MS;
      try {
        await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: idle ? "idle" : "active" }),
          keepalive: true,
        });
      } catch {
        // A missed beat is not worth a console line. Three of them in a row is
        // what "offline" means, and that is the server's job to notice.
      }
    }

    beat();
    const timer = setInterval(beat, BEAT_MS);
    // Coming back to the tab should light the dot straight away rather than
    // up to forty-five seconds later.
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
