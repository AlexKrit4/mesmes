const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const webpush = require('web-push');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';

// Avatar upload setup
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `avatar_${req.userId}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Только изображения (jpg, png, webp, gif)'));
  },
});

// Middleware: require auth
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Нет токена' });
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

// GET /api/users/vapid-public-key
router.get('/vapid-public-key', (req, res) => {
  res.json({
    publicKey: process.env.VAPID_PUBLIC_KEY || 'BJlNwVA-s2DA1Xy-yFB3Pyi1J1lCWv8cQpRSyTCKT_OONE0XHmJewsLGHcjysdz1H0v6Ju-epgIU0FBjXlcUkZg',
  });
});

// GET /api/users/push-debug (check subscriptions for current user)
router.get('/push-debug', auth, (req, res) => {
  const subs = db.prepare('SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id = ?').all(req.userId);
  res.json({ userId: req.userId, subscriptions: subs });
});

// POST /api/users/push-subscribe
router.post('/push-subscribe', auth, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  try {
    db.prepare(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
    `).run(req.userId, endpoint, keys.p256dh, keys.auth);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/me — update username and/or public_id
router.patch('/me', auth, (req, res) => {
  const { username, public_id } = req.body;
  if (!username && !public_id) return res.status(400).json({ error: 'Нет данных для обновления' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const newUsername = username ? username.trim() : user.username;
  const newPublicId = public_id ? public_id.trim().toLowerCase() : user.public_id;

  if (newPublicId !== user.public_id) {
    if (!/^[a-z0-9_]{3,24}$/.test(newPublicId)) return res.status(400).json({ error: 'ID: только a-z, 0-9, _ (3-24 символа)' });
    const exists = db.prepare('SELECT id FROM users WHERE public_id = ? AND id != ?').get(newPublicId, req.userId);
    if (exists) return res.status(400).json({ error: 'Этот ID уже занят' });
    // Rate limit: once per day
    if (user.last_public_id_change) {
      const diff = Date.now() - new Date(user.last_public_id_change).getTime();
      if (diff < 24 * 60 * 60 * 1000) {
        const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - diff) / 3600000);
        return res.status(429).json({ error: `Менять ID можно раз в сутки. Следующая смена через ${hoursLeft} ч.` });
      }
    }
  }
  if (newUsername.length < 2 || newUsername.length > 32) {
    return res.status(400).json({ error: 'Имя: от 2 до 32 символов' });
  }

  const changedId = newPublicId !== user.public_id;
  if (changedId) {
    db.prepare('UPDATE users SET username = ?, public_id = ?, last_public_id_change = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newUsername, newPublicId, req.userId);
  } else {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newUsername, req.userId);
  }
  res.json({ username: newUsername, public_id: newPublicId });
});

// DELETE /api/users/me — delete account
router.delete('/me', auth, (req, res) => {
  const uid = req.userId;
  db.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(uid, uid);
  db.prepare('DELETE FROM friends WHERE user_id = ? OR friend_id = ?').run(uid, uid);
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  res.json({ success: true });
});

// GET /api/users/me
router.get('/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, username, public_id, avatar, last_seen, last_public_id_change FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(user);
});

// POST /api/users/avatar
router.post('/avatar', auth, (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
    if (!req.file) return res.status(400).json({ error: 'Выберите изображение' });

    // Delete old avatar file
    const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.userId);
    if (old?.avatar) {
      const oldPath = path.join(uploadDir, path.basename(old.avatar));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const avatarUrl = `/uploads/${req.file.filename}`;
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, req.userId);
    res.json({ avatar: avatarUrl });
  });
});

// GET /api/users/search?q=ID
router.get('/search', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const users = db.prepare(
    'SELECT id, username, public_id, avatar, last_seen FROM users WHERE public_id LIKE ? AND id != ? LIMIT 10'
  ).all(`%${q}%`, req.userId);
  res.json(users);
});

// GET /api/users/friends
router.get('/friends', auth, (req, res) => {
  const friends = db.prepare(`
    SELECT u.id, u.username, u.public_id, u.avatar, u.last_seen, f.status,
      (SELECT COUNT(*) FROM messages
         WHERE sender_id = u.id AND receiver_id = ? AND read_at IS NULL
           AND deleted_for_receiver = 0) as unread_count
    FROM friends f
    JOIN users u ON (
      CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END = u.id
    )
    WHERE (f.user_id = ? OR f.friend_id = ?)
    AND f.status = 'accepted'
  `).all(req.userId, req.userId, req.userId, req.userId);
  res.json(friends);
});

// GET /api/users/requests — входящие заявки
router.get('/requests', auth, (req, res) => {
  const requests = db.prepare(`
    SELECT u.id, u.username, u.public_id, u.avatar, f.id as request_id
    FROM friends f
    JOIN users u ON f.user_id = u.id
    WHERE f.friend_id = ? AND f.status = 'pending'
  `).all(req.userId);
  res.json(requests);
});

// POST /api/users/friend-request
router.post('/friend-request', auth, (req, res) => {
  const { public_id } = req.body;
  const target = db.prepare('SELECT id FROM users WHERE public_id = ?').get(public_id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.id === req.userId) return res.status(400).json({ error: 'Нельзя добавить себя' });

  const exists = db.prepare(
    'SELECT id FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)'
  ).get(req.userId, target.id, target.id, req.userId);
  if (exists) return res.status(409).json({ error: 'Заявка уже существует или уже друзья' });

  db.prepare('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)').run(req.userId, target.id, 'pending');

  // Real-time: notify target about new friend request
  const sender = db.prepare('SELECT id, username, public_id, avatar FROM users WHERE id = ?').get(req.userId);
  const lastRow = db.prepare('SELECT last_insert_rowid() as id').get();
  if (req.io && req.onlineUsers?.has(target.id)) {
    req.onlineUsers.get(target.id).forEach((sid) => {
      req.io.to(sid).emit('friend_request_received', {
        request_id: Number(lastRow.id),
        id: sender.id,
        username: sender.username,
        public_id: sender.public_id,
        avatar: sender.avatar,
      });
    });
  }

  res.json({ success: true });
});

// POST /api/users/accept-request
router.post('/accept-request', auth, (req, res) => {
  const { request_id } = req.body;
  const request = db.prepare('SELECT * FROM friends WHERE id = ? AND friend_id = ?').get(request_id, req.userId);
  if (!request) return res.status(404).json({ error: 'Заявка не найдена' });
  db.prepare('UPDATE friends SET status = ? WHERE id = ?').run('accepted', request_id);

  // Real-time: notify both users about new friendship
  const myInfo = db.prepare('SELECT id, username, public_id, avatar, last_seen FROM users WHERE id = ?').get(req.userId);
  const theirInfo = db.prepare('SELECT id, username, public_id, avatar, last_seen FROM users WHERE id = ?').get(request.user_id);

  if (req.io) {
    // Notify the person who sent the request
    if (req.onlineUsers?.has(request.user_id)) {
      req.onlineUsers.get(request.user_id).forEach((sid) => {
        req.io.to(sid).emit('friend_request_accepted', { friend: myInfo });
      });
    }
    // Notify myself (other tabs)
    if (req.onlineUsers?.has(req.userId)) {
      req.onlineUsers.get(req.userId).forEach((sid) => {
        req.io.to(sid).emit('friend_request_accepted', { friend: theirInfo });
      });
    }
  }

  res.json({ success: true });
});

// POST /api/users/reject-request
router.post('/reject-request', auth, (req, res) => {
  const { request_id } = req.body;
  const request = db.prepare('SELECT * FROM friends WHERE id = ? AND friend_id = ?').get(request_id, req.userId);
  db.prepare('DELETE FROM friends WHERE id = ? AND friend_id = ?').run(request_id, req.userId);

  // Real-time: notify sender that their request was rejected
  if (request && req.io && req.onlineUsers?.has(request.user_id)) {
    req.onlineUsers.get(request.user_id).forEach((sid) => {
      req.io.to(sid).emit('friend_request_rejected', { by: req.userId });
    });
  }

  res.json({ success: true });
});

// DELETE /api/users/friends/:friendId — remove friend
router.delete('/friends/:friendId', auth, (req, res) => {
  const friendId = parseInt(req.params.friendId);
  db.prepare(
    'DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)'
  ).run(req.userId, friendId, friendId, req.userId);
  // Notify friend in realtime
  if (req.io && req.onlineUsers?.has(friendId)) {
    req.onlineUsers.get(friendId).forEach((sid) => {
      req.io.to(sid).emit('friend_removed', { by: req.userId });
    });
  }
  res.json({ success: true });
});

// GET /api/users/messages/:friendId
router.get('/messages/:friendId', auth, (req, res) => {
  const friendId = parseInt(req.params.friendId);
  const messages = db.prepare(`
    SELECT m.id, m.sender_id, m.receiver_id, m.content, m.created_at, m.read_at,
           m.edited, u.username as sender_username
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
      AND NOT (m.sender_id = ? AND m.deleted_for_sender = 1)
      AND NOT (m.receiver_id = ? AND m.deleted_for_receiver = 1)
    ORDER BY m.created_at ASC
    LIMIT 200
  `).all(req.userId, friendId, friendId, req.userId, req.userId, req.userId);

  // Mark as read and notify sender in real-time
  const now = new Date().toISOString();
  const updated = db.prepare(
    'UPDATE messages SET read_at = ? WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL'
  ).run(now, friendId, req.userId);

  if (updated.changes > 0 && req.io && req.onlineUsers?.has(friendId)) {
    req.onlineUsers.get(friendId).forEach((sid) => {
      req.io.to(sid).emit('messages_read', { by: req.userId, at: now });
    });
  }

  res.json(messages);
});

// PATCH /api/users/messages/:messageId — edit message
router.patch('/messages/:messageId', auth, (req, res) => {
  const msgId = parseInt(req.params.messageId);
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Пустое сообщение' });
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
  if (msg.sender_id !== req.userId) return res.status(403).json({ error: 'Можно редактировать только свои сообщения' });
  const newContent = content.trim();
  db.prepare('UPDATE messages SET content = ?, edited = 1 WHERE id = ?').run(newContent, msgId);
  res.json({ success: true, messageId: msgId, content: newContent, receiverId: msg.receiver_id });
});

// DELETE /api/users/messages/:messageId
router.delete('/messages/:messageId', auth, (req, res) => {
  const msgId = parseInt(req.params.messageId);
  const { deleteForBoth } = req.body || {};
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
  if (msg.sender_id !== req.userId) return res.status(403).json({ error: 'Можно удалять только свои сообщения' });
  if (deleteForBoth) {
    db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);
  } else {
    db.prepare('UPDATE messages SET deleted_for_sender = 1 WHERE id = ?').run(msgId);
  }
  res.json({ success: true, deletedId: msgId, receiverId: msg.receiver_id, deleteForBoth: !!deleteForBoth });
});

module.exports = { router, auth };
