import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Activate new SW immediately — don't wait for old tabs to close
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Cache API requests
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({ cacheName: 'api-cache' })
);

// Track which chat the user is viewing (set via postMessage from the app)
let currentViewingChat = null;

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'VIEWING_CHAT') {
    currentViewingChat = event.data.friendId || null;
  }
});

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  // Extract senderId from tag like "chat-123"
  const senderId = data.tag ? data.tag.replace('chat-', '') : null;

  // If user is currently viewing this sender's chat, suppress the notification
  if (senderId && currentViewingChat && String(currentViewingChat) === String(senderId)) {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'МесМес', {
      body: data.body || 'Новое сообщение',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'message',
      renotify: true,
      data: { url: data.url || '/' },
    })
  );
});

// Click on notification — open app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.url || '/';
  // Must be absolute URL so Android routes to TWA instead of Chrome
  const url = path.startsWith('http') ? path : 'https://mesmes.ru' + path;
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});
