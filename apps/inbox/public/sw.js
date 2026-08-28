/* Service worker: receives push and focuses the right thread on tap. */

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: "Larabee", body: event.data.text(), url: "/" }; }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Same tag replaces an earlier notification for the same thread instead
      // of stacking five of them for one conversation.
      tag: payload.tag || payload.url,
      renotify: true,
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // Reuse an open tab if there is one; opening a fifth copy of the app is
      // its own kind of annoying.
      for (const client of list) {
        if ("focus" in client) { client.navigate(target); return client.focus(); }
      }
      return self.clients.openWindow(target);
    }),
  );
});
