require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const webpush = require('web-push');

// Configure VAPID
webpush.setVapidDetails(
  process.env.VAPID_EMAIL || 'mailto:admin@mesmes.ru',
  process.env.VAPID_PUBLIC_KEY || 'BJlNwVA-s2DA1Xy-yFB3Pyi1J1lCWv8cQpRSyTCKT_OONE0XHmJewsLGHcjysdz1H0v6Ju-epgIU0FBjXlcUkZg',
  process.env.VAPID_PRIVATE_KEY || '69EkioB7lm-KUvvuOmGoeVD0rLgMLzrD1DNhpwiacpI'
);

const db = require('./database');
const authRoutes = require('./routes/auth');
const { router: usersRouter, auth } = require('./routes/users');

const app = express();
const server = http.createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';
const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// Socket.io with CORS
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

// Serve uploaded avatars
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const fs = require('fs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// TWA Digital Asset Links — required for fullscreen (no browser bar)
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'ru.mesmes.twa',
      sha256_cert_fingerprints: [
        '99:6C:F2:1F:B1:68:AC:A1:9B:69:35:13:44:A4:36:DD:67:38:54:C1:49:64:E0:AB:47:13:C8:32:95:D0:BC:AE',
      ],
    },
  }]);
});

// Make io & onlineUsers available to routes
app.use((req, res, next) => {
  req.io = io;
  req.onlineUsers = onlineUsers;
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRouter);

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// ─── Socket.io ───────────────────────────────────────────────────────────────

// Map: userId -> Set of socketIds
const onlineUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Нет токена'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userId = payload.userId;
    next();
  } catch {
    next(new Error('Недействительный токен'));
  }
});

io.on('connection', (socket) => {
  const uid = socket.userId;

  // Track online
  if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
  onlineUsers.get(uid).add(socket.id);

  // Notify friends that user is online
  broadcastPresence(uid, true);

  // ── Отправка сообщения ──────────────────────────────────────────────────
  socket.on('send_message', ({ to, content }) => {
    if (!to || !content || !content.trim()) return;

    // Check they are friends
    const areFriends = db.prepare(`
      SELECT id FROM friends
      WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
      AND status = 'accepted'
    `).get(uid, to, to, uid);

    if (!areFriends) return socket.emit('error', { msg: 'Вы не друзья' });

    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO messages (sender_id, receiver_id, content, created_at) VALUES (?, ?, ?, ?)'
    ).run(uid, to, content.trim(), now);

    const sender = db.prepare('SELECT username FROM users WHERE id = ?').get(uid);

    const message = {
      id: result.lastInsertRowid,
      sender_id: uid,
      receiver_id: to,
      content: content.trim(),
      created_at: now,
      read_at: null,
      sender_username: sender.username,
    };

    // Send to recipient if online
    if (onlineUsers.has(to)) {
      onlineUsers.get(to).forEach((sid) => io.to(sid).emit('new_message', message));
    } else {
      // Recipient is offline — send push notification
      try {
        const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(to);
        const senderName = sender.username;
        for (const sub of subs) {
          const pushPayload = JSON.stringify({
            title: `МесМес: ${senderName}`,
            body: content.trim().length > 80 ? content.trim().slice(0, 80) + '…' : content.trim(),
            tag: `chat-${uid}`,
            url: `https://mesmes.ru/chat/${uid}`,
          });
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            pushPayload
          ).catch((err) => {
            // Remove invalid subscription
            if (err.statusCode === 410 || err.statusCode === 404) {
              db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
            }
          });
        }
      } catch (pushErr) {
        console.error('Push error:', pushErr.message);
      }
    }

    // Echo back to sender (in case multiple tabs)
    onlineUsers.get(uid).forEach((sid) => {
      if (sid !== socket.id) io.to(sid).emit('new_message', message);
    });

    socket.emit('message_sent', message);
  });
  // ── Удаление сообщения ──────────────────────────────────────────────────────────
  socket.on('delete_message', ({ messageId }) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND sender_id = ?').get(messageId, uid);
    if (!msg) return;
    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    const target = msg.receiver_id;
    // Уведомить получателя
    if (onlineUsers.has(target)) {
      onlineUsers.get(target).forEach((sid) => io.to(sid).emit('message_deleted', { messageId }));
    }
    // Уведомить себя (другие вкладки)
    onlineUsers.get(uid)?.forEach((sid) => io.to(sid).emit('message_deleted', { messageId }));
  });
  // ── Печатает ────────────────────────────────────────────────────────────
  socket.on('typing', ({ to }) => {
    if (onlineUsers.has(to)) {
      onlineUsers.get(to).forEach((sid) => io.to(sid).emit('user_typing', { from: uid }));
    }
  });

  socket.on('stop_typing', ({ to }) => {
    if (onlineUsers.has(to)) {
      onlineUsers.get(to).forEach((sid) => io.to(sid).emit('user_stop_typing', { from: uid }));
    }
  });

  // ── Прочитано ──────────────────────────────────────────────────────────
  socket.on('mark_read', ({ friendId }) => {
    if (!friendId) return;
    const now = new Date().toISOString();
    const updated = db.prepare(
      'UPDATE messages SET read_at = ? WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL'
    ).run(now, friendId, uid);
    // Notify the sender that their messages were read
    if (updated.changes > 0 && onlineUsers.has(friendId)) {
      onlineUsers.get(friendId).forEach((sid) => {
        io.to(sid).emit('messages_read', { by: uid, at: now });
      });
    }
  });

  // ── Пользователь заходил ────────────────────────────────────────────────
  socket.on('disconnect', () => {
    onlineUsers.get(uid)?.delete(socket.id);
    if (onlineUsers.get(uid)?.size === 0) {
      onlineUsers.delete(uid);
      const now = new Date().toISOString();
      db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, uid);
      broadcastPresence(uid, false, now);
    }
  });
});

function broadcastPresence(userId, online, lastSeen) {
  // Get all friends of this user
  const friends = db.prepare(`
    SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END as friend_id
    FROM friends WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'
  `).all(userId, userId, userId);

  friends.forEach(({ friend_id }) => {
    if (onlineUsers.has(friend_id)) {
      onlineUsers.get(friend_id).forEach((sid) =>
        io.to(sid).emit('presence', { userId, online, lastSeen })
      );
    }
  });
}

server.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
});
