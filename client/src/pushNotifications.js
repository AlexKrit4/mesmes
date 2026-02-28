import api from './api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function subscribeToPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Wait for SW to be active (up to 10 sec)
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('SW timeout')), 10000)),
    ]);

    // Always get a fresh subscription to avoid stale endpoints on Android
    let subscription = await reg.pushManager.getSubscription();

    if (!subscription) {
      const { data } = await api.get('/users/vapid-public-key');
      const applicationServerKey = urlBase64ToUint8Array(data.publicKey);
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    // Always send to server (keeps it updated)
    await api.post('/users/push-subscribe', subscription.toJSON());
  } catch (err) {
    console.warn('Push subscription failed:', err.message);
  }
}

// Re-subscribe when user returns to the app (handles stale subscriptions on Android)
export function setupPushKeepAlive() {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      subscribeToPush().catch(() => {});
    }
  });
}
