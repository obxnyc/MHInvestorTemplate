"use client";
import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports as a Mac; the touch points give it away.
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (window.navigator as unknown as { standalone?: boolean }).standalone === true;

type State =
  | "checking" | "on" | "off" | "blocked"
  | "ios-install"     // iOS only delivers push to a home-screen app
  | "android-hint"    // working, but installing makes it more reliable
  | "unsupported";

/**
 * The two platforms genuinely differ, so the prompt does too.
 *
 * Android: web push works straight from the browser tab — one tap, no install.
 * iOS: push is delivered only to a PWA added to the Home Screen, never from a
 * Safari tab, so an Enable button there would silently do nothing.
 */
export default function PushSetup() {
  const [state, setState] = useState<State>("checking");
  const [installable, setInstallable] = useState(false);

  useEffect(() => {
    if (isIOS() && !isStandalone()) { setState("ios-install"); return; }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported"); return;
    }
    if (Notification.permission === "denied") { setState("blocked"); return; }

    navigator.serviceWorker.register("/sw.js")
      .then(async (reg) => {
        const existing = await reg.pushManager.getSubscription();
        if (!existing) { setState("off"); return; }
        // Subscribed and working. Nudge Android users to install only if they
        // have not, since a background tab can be evicted under memory pressure.
        setState(!isIOS() && !isStandalone() && installable ? "android-hint" : "on");
      })
      .catch(() => setState("unsupported"));

    const onPrompt = (e: Event) => { e.preventDefault(); setInstallable(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [installable]);

  async function enable() {
    if (await Notification.requestPermission() !== "granted") {
      setState("blocked"); return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
    });
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub),
    });
    setState("on");
  }

  if (state === "checking" || state === "on" || state === "unsupported") return null;

  if (state === "ios-install") {
    return (
      <div className="pushbar">
        <span>
          <strong>iPhone:</strong> tap <strong>Share</strong> &rarr;{" "}
          <strong>Add to Home Screen</strong>, then open it from the icon.
          Apple only sends alerts to the installed app, not to a Safari tab.
        </span>
      </div>
    );
  }
  if (state === "blocked") {
    return (
      <div className="pushbar">
        <span>
          Alerts are blocked for this site. Turn them back on in your browser
          settings, then reload.
        </span>
      </div>
    );
  }
  if (state === "android-hint") {
    return (
      <div className="pushbar quiet">
        <span>
          Alerts are on. For the most reliable delivery, use your browser menu
          to <strong>Install app</strong> &mdash; a background tab can get shut
          down when the phone is low on memory.
        </span>
      </div>
    );
  }
  return (
    <div className="pushbar">
      <span>Get alerted the moment something comes in.</span>
      <button onClick={enable}>Turn on alerts</button>
    </div>
  );
}
