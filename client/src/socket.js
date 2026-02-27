import { io } from 'socket.io-client';

let socket = null;
let _visHandler = null;

export function getSocket() {
  return socket;
}

export function connectSocket() {
  const token = localStorage.getItem('token');
  if (!token) return null;

  if (socket?.connected) return socket;

  socket = io('/', {
    auth: { token },
    transports: ['websocket'],
    reconnectionAttempts: 10,
    reconnectionDelay: 1500,
  });

  // Track page visibility — tell server when user goes away / comes back
  if (_visHandler) document.removeEventListener('visibilitychange', _visHandler);
  _visHandler = () => {
    if (!socket?.connected) return;
    if (document.visibilityState === 'hidden') {
      socket.emit('user_away');
    } else {
      socket.emit('user_active');
    }
  };
  document.addEventListener('visibilitychange', _visHandler);

  // Global: if banned while online, force logout
  socket.on('you_are_banned', (data) => {
    localStorage.clear();
    const reason = data?.reason || 'Нарушение правил';
    const expires = data?.expires_at;
    const params = new URLSearchParams({ banned: '1', reason });
    if (expires) params.set('expires_at', expires);
    window.location.href = '/login?' + params.toString();
  });

  return socket;
}

export function disconnectSocket() {
  if (_visHandler) {
    document.removeEventListener('visibilitychange', _visHandler);
    _visHandler = null;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
