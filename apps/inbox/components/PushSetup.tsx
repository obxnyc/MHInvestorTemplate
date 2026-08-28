"use client";
import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** iOS only delivers web push to a PWA that has been added to the Home Screen
 *  — not from a Safari tab — so detect that and say so plainly rather than
 *  showing an Enable button that silently cannot work. */
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

export default function PushSetup() {
  const [state, setState] = useState<"checking" | "on" | "off" | "blocked" | "ios-install" | "unsupported">("checking");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      if (isIOS() && !isStandalone()) setState("ios-install");
      else setState("unsupported");
      return;
    }
    if (isIOS() && !isStandalone()) { setState("ios-install"); return; }
    if (Notification.permission === "denied") { setState("blocked"); return; }

    navigator.serviceWorker.register("/sw.js").then(async (reg) => {
      const existing = await reg.pushManager.getSubscription();
      setState(existing ? "on" : "off");
    }).catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { setState("blocked"); return; }

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

  if (state === "checking" || state === "on") return null;

  if (state === "ios-install") {
    return (
      <div className="pushbar">
        <span>
          To get alerts on iPhone, tap <strong>Share</strong> then{" "}
          <strong>Add to Home Screen</strong>, and open it from there.
        </span>
      </div>
    );
  }
  if (state === "blocked") {
    return (
      <div className="pushbar">
        <span>Notifications are blocked. Turn them back on in your browser settings for this site.</span>
      </div>
    );
  }
  if (state === "unsupported") return null;

  return (
    <div className="pushbar">
      <span>Get alerted when something comes in.</span>
      <button onClick={enable}>Turn on alerts</button>
    </div>
  );
}
