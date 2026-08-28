/* Service worker: receives push, and on Android lets someone act straight from
   the notification shade.

   Action buttons are Chrome/Android only — iOS Safari ignores the actions array
   and just shows the notification. That degrades cleanly: tapping the body
   opens the thread on every platform, so nothing needs special-casing. */

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let p;
  try { p = event.data.json(); }
  catch { p = { title: "Larabee", body: event.data.text(), url: "/" }; }

  const actions = (p.actions || []).slice(0, 2); // Chrome shows at most two

  event.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Same tag replaces the earlier notification for a thread rather than
      // stacking five of them for one conversation.
      tag: p.tag || p.url,
      renotify: true,
      // An urgent job stays in the shade until it is dealt with, and buzzes
      // distinctly. Both are Android-only and ignored elsewhere.
      requireInteraction: !!p.urgent,
      vibrate: p.urgent ? [200, 100, 200, 100, 200] : [100],
      actions,
      data: { url: p.url || "/", conversationId: p.conversationId || null },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const { url, conversationId } = event.notification.data || {};
  event.notification.close();

  // Acting from the shade. Same-origin fetch, so the session cookie rides
  // along and the reply is attributed to the right person.
  if (event.action && conversationId) {
    event.waitUntil(handleAction(event.action, conversationId, url));
    return;
  }
  event.waitUntil(openApp(url || "/"));
});

async function handleAction(action, conversationId, url) {
  try {
    if (action === "claim") {
      const res = await fetch(`/api/conversations/${conversationId}/claim`, {
        method: "POST", credentials: "same-origin",
      });
      if (res.status === 409) {
        const { heldBy } = await res.json();
        // Losing the race is information, not an error worth swallowing.
        return self.registration.showNotification("Already taken", {
          body: `${heldBy} picked it up first.`,
          icon: "/icon-192.png", tag: `conflict:${conversationId}`,
          data: { url },
        });
      }
      return self.registration.showNotification("You've got it", {
        body: "Opened on your phone when you're ready.",
        icon: "/icon-192.png", tag: `claimed:${conversationId}`,
        data: { url },
      });
    }

    if (action === "close") {
      const res = await fetch(`/api/conversations/${conversationId}/close`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.status === 409) {
        // A work order is still open. That decision needs a screen, not a
        // notification button.
        return openApp(url);
      }
      return self.registration.showNotification("Closed", {
        body: "Marked finished.", icon: "/icon-192.png",
        tag: `closed:${conversationId}`, data: { url: "/" },
      });
    }
  } catch {
    // Offline or signed out — fall back to opening the app.
    return openApp(url || "/");
  }
  return openApp(url || "/");
}

async function openApp(target) {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of list) {
    if ("focus" in client) { client.navigate(target); return client.focus(); }
  }
  return self.clients.openWindow(target);
}
