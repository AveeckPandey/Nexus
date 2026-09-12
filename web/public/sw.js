self.addEventListener('push', (event) => {
  let data = { title: 'Nexus', body: 'New message', data: {} };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* plain text payload */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon.png',
      badge: '/badge.png',
      data: data.data,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conv = event.notification.data && event.notification.data.conversationId;
  const url = conv ? `/?conversation=${conv}` : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((windows) => {
      for (const w of windows) {
        if ('focus' in w) return w.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
