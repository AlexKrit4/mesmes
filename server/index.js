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
        'C0:F7:65:5A:87:6A:D0:E8:EE:84:F2:EE:A3:71:E9:8B:46:EB:BD:FC:BE:55:C7:C0:13:EC:8B:33:68:75:B3:A0',
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

  // Track which chat this socket is currently viewing (null = none)
  socket.viewingChat = null;

  // Notify friends that user is online
  broadcastPresence(uid, true);

  // ── Отправка сообщения ──────────────────────────────────────────────────
  socket.on('send_message', ({ to, content, file_url, reply_to_id }) => {
    const trimContent = (content || '').trim();
    if (!to || (!trimContent && !file_url)) return;

    // Check they are friends
    const areFriends = db.prepare(`
      SELECT id FROM friends
      WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
      AND status = 'accepted'
    `).get(uid, to, to, uid);

    if (!areFriends) return socket.emit('error', { msg: 'Вы не друзья' });

    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO messages (sender_id, receiver_id, content, file_url, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(uid, to, trimContent, file_url || null, reply_to_id || null, now);

    const sender = db.prepare('SELECT username FROM users WHERE id = ?').get(uid);

    // Fetch replied-to message if exists
    let reply_to = null;
    if (reply_to_id) {
      const rm = db.prepare('SELECT id, content, sender_id, file_url FROM messages WHERE id = ?').get(reply_to_id);
      if (rm) {
        const rmSender = db.prepare('SELECT username FROM users WHERE id = ?').get(rm.sender_id);
        reply_to = { id: rm.id, content: rm.content, sender_id: rm.sender_id, file_url: rm.file_url, sender_username: rmSender?.username };
      }
    }

    const message = {
      id: result.lastInsertRowid,
      sender_id: uid,
      receiver_id: to,
      content: trimContent,
      file_url: file_url || null,
      reply_to_id: reply_to_id || null,
      reply_to,
      created_at: now,
      read_at: null,
      sender_username: sender.username,
    };

    // Send to recipient if online
    if (onlineUsers.has(to)) {
      onlineUsers.get(to).forEach((sid) => io.to(sid).emit('new_message', message));
    }

    // Always send push notification if subscription exists
    // (handles background/closed app — push shows even if socket is alive)
    try {
      const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(to);
      if (subs.length > 0) {
        const senderName = sender.username;
        const pushPayload = JSON.stringify({
          title: `МесМес: ${senderName}`,
          body: file_url ? '\ud83d\uddbc\ufe0f Изображение' : (trimContent.length > 80 ? trimContent.slice(0, 80) + '\u2026' : trimContent),
          tag: `chat-${uid}`,
          url: `https://mesmes.ru/chat/${uid}`,
        });
        for (const sub of subs) {
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            pushPayload
          ).catch((err) => {
            console.error('Push send error:', err.statusCode, err.message);
            if (err.statusCode === 410 || err.statusCode === 404) {
              db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
            }
          });
        }
      }
    } catch (pushErr) {
      console.error('Push error:', pushErr.message);
    }

    // Echo back to sender (in case multiple tabs)
    onlineUsers.get(uid).forEach((sid) => {
      if (sid !== socket.id) io.to(sid).emit('new_message', message);
    });

    socket.emit('message_sent', message);
  });
  // ── Удаление сообщения ──────────────────────────────────────────────────────────
  // DB deletion is handled by REST API; socket just propagates the event
  socket.on('delete_message', ({ messageId, friendId, deleteForBoth }) => {
    if (deleteForBoth) {
      // Notify recipient
      if (onlineUsers.has(friendId)) {
        onlineUsers.get(friendId).forEach((sid) => io.to(sid).emit('message_deleted', { messageId }));
      }
    }
    // Always notify own other tabs
    onlineUsers.get(uid)?.forEach((sid) => {
      if (sid !== socket.id) io.to(sid).emit('message_deleted', { messageId });
    });
  });

  // ── Редактирование сообщения ────────────────────────────────────────────────────
  socket.on('edit_message', ({ messageId, content, friendId }) => {
    if (!content || !content.trim()) return;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND sender_id = ?').get(messageId, uid);
    if (!msg) return;
    const newContent = content.trim();
    db.prepare('UPDATE messages SET content = ?, edited = 1 WHERE id = ?').run(newContent, messageId);
    const payload = { messageId, content: newContent };
    // Notify recipient
    if (onlineUsers.has(friendId)) {
      onlineUsers.get(friendId).forEach((sid) => io.to(sid).emit('message_edited', payload));
    }
    // Notify own other tabs
    onlineUsers.get(uid)?.forEach((sid) => {
      if (sid !== socket.id) io.to(sid).emit('message_edited', payload);
    });
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
  // ── Viewing chat tracking (suppress push when user is looking at the chat) ──
  socket.on('viewing_chat', ({ friendId }) => {
    socket.viewingChat = friendId || null;
  });

  // ── Activity tracking (realistic online status) ──────────────────────────
  socket.isAway = false;

  socket.on('user_away', () => {
    socket.isAway = true;
    // If ALL sockets for this user are away, broadcast offline
    const allAway = [...(onlineUsers.get(uid) || [])].every((sid) => {
      const s = io.sockets.sockets.get(sid);
      return s && s.isAway;
    });
    if (allAway) {
      const now = new Date().toISOString();
      db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, uid);
      broadcastPresence(uid, false, now);
    }
  });

  socket.on('user_active', () => {
    const wasAllAway = [...(onlineUsers.get(uid) || [])].every((sid) => {
      const s = io.sockets.sockets.get(sid);
      return s && s.isAway;
    });
    socket.isAway = false;
    if (wasAllAway) {
      broadcastPresence(uid, true);
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
