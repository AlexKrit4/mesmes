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

    const reg = await navigator.serviceWorker.ready;

    // Get VAPID public key from server
    const { data } = await api.get('/users/vapid-public-key');
    const applicationServerKey = urlBase64ToUint8Array(data.publicKey);

    // Subscribe
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    // Send subscription to server
    await api.post('/users/push-subscribe', subscription.toJSON());
  } catch (err) {
    // Notifications not supported or denied — silently ignore
    console.warn('Push subscription failed:', err.message);
  }
}
