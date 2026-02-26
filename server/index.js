require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');

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

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

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

    const result = db.prepare(
      'INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)'
    ).run(uid, to, content.trim());

    const sender = db.prepare('SELECT username FROM users WHERE id = ?').get(uid);

    const message = {
      id: result.lastInsertRowid,
      sender_id: uid,
      receiver_id: to,
      content: content.trim(),
      created_at: new Date().toISOString(),
      read_at: null,
      sender_username: sender.username,
    };

    // Send to recipient if online
    if (onlineUsers.has(to)) {
      onlineUsers.get(to).forEach((sid) => io.to(sid).emit('new_message', message));
    }

    // Echo back to sender (in case multiple tabs)
    onlineUsers.get(uid).forEach((sid) => {
      if (sid !== socket.id) io.to(sid).emit('new_message', message);
    });

    socket.emit('message_sent', message);
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

  // ── Пользователь заходил ────────────────────────────────────────────────
  socket.on('disconnect', () => {
    onlineUsers.get(uid)?.delete(socket.id);
    if (onlineUsers.get(uid)?.size === 0) {
      onlineUsers.delete(uid);
      db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(uid);
      broadcastPresence(uid, false);
    }
  });
});

function broadcastPresence(userId, online) {
  // Get all friends of this user
  const friends = db.prepare(`
    SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END as friend_id
    FROM friends WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'
  `).all(userId, userId, userId);

  friends.forEach(({ friend_id }) => {
    if (onlineUsers.has(friend_id)) {
      onlineUsers.get(friend_id).forEach((sid) =>
        io.to(sid).emit('presence', { userId, online })
      );
    }
  });
}

server.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
});
