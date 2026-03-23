const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const webpush = require('web-push');
const { encryptMessageContent, decryptMessageContent } = require('../messageCrypto');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';

// Helper: check if user has active premium
function isPremium(userId) {
  const u = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(userId);
  if (!u || !u.premium_until) return false;
  return new Date(u.premium_until) > new Date();
}

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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Только изображения (jpg, png, webp, gif)'));
  },
});

// Message image upload
const msgStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `msg_${req.userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const msgUpload = multer({
  storage: msgStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // technical safety cap
});

function isUsersBlocked(userA, userB) {
  const row = db.prepare(
    'SELECT id FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1'
  ).get(userA, userB, userB, userA);
  return !!row;
}

// Middleware: require auth
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Нет токена' });
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // check session validity in DB (if missing, consider invalidated, unless it's from before migration)
    const sessionExists = db.prepare('SELECT id FROM sessions WHERE token = ?').get(token);
    const userHasSessions = db.prepare('SELECT id FROM sessions WHERE user_id = ? LIMIT 1').get(payload.userId);
    
    // If the user has sessions (meaning they logged in after migration) but this token isn't there, it's invalid.
    if (userHasSessions && !sessionExists) {
       return res.status(401).json({ error: 'Сессия завершена' });
    }
    
    // Keep activity fresh for active-devices screen.
    if (sessionExists) {
      db.prepare('UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE id = ?').run(sessionExists.id);
    }

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
  const { username, public_id, bio, phone, hide_last_seen } = req.body;
  if (username === undefined && public_id === undefined && bio === undefined && phone === undefined && hide_last_seen === undefined) {
    return res.status(400).json({ error: 'Нет данных для обновления' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const newUsername = username ? username.trim() : user.username;
  const newPublicId = public_id ? public_id.trim().toLowerCase() : user.public_id;

  // Handle bio update
  if (req.body.bio !== undefined) {
    const newBio = String(req.body.bio).slice(0, 200);
    db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(newBio, req.userId);
  }

  // Handle phone update
  if (req.body.phone !== undefined) {
    const newPhone = String(req.body.phone).replace(/[^0-9+]/g, '').slice(0, 20);
    if (newPhone && newPhone !== (user.phone || '')) {
      // Rate limit: once per 30 days
      if (user.last_phone_change) {
        const diff = Date.now() - new Date(user.last_phone_change.endsWith('Z') ? user.last_phone_change : user.last_phone_change + 'Z').getTime();
        if (diff < 30 * 24 * 60 * 60 * 1000) {
          const daysLeft = Math.ceil((30 * 24 * 60 * 60 * 1000 - diff) / 86400000);
          return res.status(429).json({ error: `Менять номер можно раз в 30 дней. Осталось ${daysLeft} дн.` });
        }
      }
      // Check uniqueness
      const phoneTaken = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(newPhone, req.userId);
      if (phoneTaken) return res.status(409).json({ error: 'Этот номер уже привязан к другому аккаунту' });
      db.prepare('UPDATE users SET phone = ?, last_phone_change = CURRENT_TIMESTAMP WHERE id = ?').run(newPhone, req.userId);
    } else if (!newPhone) {
      db.prepare('UPDATE users SET phone = NULL WHERE id = ?').run(req.userId);
    }
  }

  // Handle hide_last_seen update (premium only)
  if (req.body.hide_last_seen !== undefined) {
    if (!isPremium(req.userId)) {
      return res.status(403).json({ error: 'Скрытие статуса доступно только с mes-premium' });
    }
    db.prepare('UPDATE users SET hide_last_seen = ? WHERE id = ?').run(req.body.hide_last_seen ? 1 : 0, req.userId);
  }

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

  // Only run username/public_id UPDATE if either changed
  const changedId = newPublicId !== user.public_id;
  const changedName = newUsername !== user.username;
  if (changedId) {
    db.prepare('UPDATE users SET username = ?, public_id = ?, last_public_id_change = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newUsername, newPublicId, req.userId);
  } else if (changedName) {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newUsername, req.userId);
  }
  res.json({ username: newUsername, public_id: newPublicId });
});

// GET /api/users/profile/:publicId — public profile
router.get('/profile/:publicId', auth, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, public_id, avatar, bio, last_seen, created_at, premium_until, hide_last_seen FROM users WHERE public_id = ?'
  ).get(req.params.publicId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  // Check friendship
  const friendship = db.prepare(
    `SELECT status FROM friends WHERE
      ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = 'accepted'`
  ).get(req.userId, user.id, user.id, req.userId);
  user.isFriend = !!friendship;
  user.isMe = user.id === req.userId;
  // Return phone only if it's the user's own profile
  if (user.isMe) {
    const full = db.prepare('SELECT phone, last_phone_change, last_public_id_change FROM users WHERE id = ?').get(user.id);
    user.phone = full.phone;
    user.last_phone_change = full.last_phone_change;
    user.last_public_id_change = full.last_public_id_change;
  }
  res.json(user);
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
  const user = db.prepare('SELECT id, username, public_id, avatar, last_seen, last_public_id_change, phone, bio, last_phone_change, premium_until, hide_last_seen FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  // Check active ban
  const ban = db.prepare(
    'SELECT id, reason, expires_at, banned_at FROM bans WHERE user_id = ? AND active = 1 ORDER BY id DESC LIMIT 1'
  ).get(req.userId);
  if (ban) {
    if (ban.expires_at && new Date(ban.expires_at) < new Date()) {
      db.prepare('UPDATE bans SET active = 0 WHERE id = ?').run(ban.id);
    } else {
      return res.status(403).json({ error: 'banned', reason: ban.reason, expires_at: ban.expires_at, banned_at: ban.banned_at });
    }
  }

  res.json(user);
});

// POST /api/users/avatar
router.post('/avatar', auth, (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
    if (!req.file) return res.status(400).json({ error: 'Выберите изображение' });

    // Block GIF avatars for non-premium users
    if (req.file.mimetype === 'image/gif' && !isPremium(req.userId)) {
      // Remove uploaded file
      const fp = path.join(uploadDir, req.file.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      return res.status(403).json({ error: 'GIF-аватар доступен только с mes-premium' });
    }

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

// GET /api/users/search?q=ID or phone
router.get('/search', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const users = db.prepare(
    'SELECT id, username, public_id, avatar, last_seen, premium_until FROM users WHERE (public_id LIKE ? OR phone = ?) AND id != ? LIMIT 10'
  ).all(`%${q}%`, q, req.userId);
  res.json(users);
});

// GET /api/users/friends
router.get('/friends', auth, (req, res) => {
  const friends = db.prepare(`
    SELECT u.id, u.username, u.public_id, u.avatar, u.last_seen, u.premium_until, u.hide_last_seen, f.status,
      (SELECT COUNT(*) FROM messages
         WHERE sender_id = u.id AND receiver_id = ? AND read_at IS NULL
           AND deleted_for_receiver = 0) as unread_count,
      lm.content as last_message,
      lm.file_url as last_message_file,
      lm.sender_id as last_message_sender_id,
      lm.created_at as last_message_at
    FROM friends f
    JOIN users u ON (
      CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END = u.id
    )
    LEFT JOIN messages lm ON lm.id = (
      SELECT m.id FROM messages m
      WHERE ((m.sender_id = ? AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?))
        AND m.deleted_for_receiver = 0
      ORDER BY m.created_at DESC LIMIT 1
    )
    WHERE (f.user_id = ? OR f.friend_id = ?)
    AND f.status = 'accepted'
    ORDER BY COALESCE(lm.created_at, '1970-01-01') DESC
  `).all(req.userId, req.userId, req.userId, req.userId, req.userId, req.userId);

  friends.forEach((friend) => {
    friend.last_message = decryptMessageContent(friend.last_message);
  });

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
  const { public_id, phone } = req.body;
  let target;
  if (phone) {
    target = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (!target) return res.status(404).json({ error: 'Пользователь с таким номером не найден' });
  } else {
    target = db.prepare('SELECT id FROM users WHERE public_id = ?').get(public_id);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  }
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

// GET /api/users/blocks/:friendId — get block status for current chat
router.get('/blocks/:friendId', auth, (req, res) => {
  const friendId = parseInt(req.params.friendId);
  if (!friendId || Number.isNaN(friendId)) return res.status(400).json({ error: 'Некорректный ID' });

  const blockedByMe = !!db.prepare('SELECT id FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.userId, friendId);
  const blockedMe = !!db.prepare('SELECT id FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').get(friendId, req.userId);

  res.json({ blockedByMe, blockedMe, blocked: blockedByMe || blockedMe });
});

// POST /api/users/blocks/:friendId — block user in DM
router.post('/blocks/:friendId', auth, (req, res) => {
  const friendId = parseInt(req.params.friendId);
  if (!friendId || Number.isNaN(friendId)) return res.status(400).json({ error: 'Некорректный ID' });
  if (friendId === req.userId) return res.status(400).json({ error: 'Нельзя заблокировать себя' });

  const friendship = db.prepare(
    `SELECT id FROM friends
     WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
       AND status = 'accepted'`
  ).get(req.userId, friendId, friendId, req.userId);
  if (!friendship) return res.status(403).json({ error: 'Блокировка доступна только для друзей' });

  db.prepare('INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)').run(req.userId, friendId);

  if (req.io && req.onlineUsers) {
    const payload = { by: req.userId, target: friendId, blocked: true };
    if (req.onlineUsers.has(friendId)) {
      req.onlineUsers.get(friendId).forEach((sid) => req.io.to(sid).emit('chat_block_status_changed', payload));
    }
    if (req.onlineUsers.has(req.userId)) {
      req.onlineUsers.get(req.userId).forEach((sid) => req.io.to(sid).emit('chat_block_status_changed', payload));
    }
  }

  res.json({ success: true, blockedByMe: true });
});

// DELETE /api/users/blocks/:friendId — unblock user in DM
router.delete('/blocks/:friendId', auth, (req, res) => {
  const friendId = parseInt(req.params.friendId);
  if (!friendId || Number.isNaN(friendId)) return res.status(400).json({ error: 'Некорректный ID' });

  db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.userId, friendId);

  if (req.io && req.onlineUsers) {
    const payload = { by: req.userId, target: friendId, blocked: false };
    if (req.onlineUsers.has(friendId)) {
      req.onlineUsers.get(friendId).forEach((sid) => req.io.to(sid).emit('chat_block_status_changed', payload));
    }
    if (req.onlineUsers.has(req.userId)) {
      req.onlineUsers.get(req.userId).forEach((sid) => req.io.to(sid).emit('chat_block_status_changed', payload));
    }
  }

  res.json({ success: true, blockedByMe: false });
});

// GET /api/users/messages/:friendId
router.get('/messages/:friendId', auth, (req, res) => {
  const friendId = parseInt(req.params.friendId);
  const messages = db.prepare(`
    SELECT m.id, m.sender_id, m.receiver_id, m.content, m.file_url, m.reply_to_id, m.created_at, m.read_at,
           m.edited, m.is_pinned, u.username as sender_username
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

  // Enrich messages with reply_to data and reactions
  const enriched = messages.map((msg) => {
    msg.content = decryptMessageContent(msg.content);
    if (msg.reply_to_id) {
      const rm = db.prepare('SELECT id, content, sender_id, file_url FROM messages WHERE id = ?').get(msg.reply_to_id);
      if (rm) {
        const rmSender = db.prepare('SELECT username FROM users WHERE id = ?').get(rm.sender_id);
        msg.reply_to = {
          id: rm.id,
          content: decryptMessageContent(rm.content),
          sender_id: rm.sender_id,
          file_url: rm.file_url,
          sender_username: rmSender?.username,
        };
      }
    }
    // Attach reactions
    const reactionRows = db.prepare('SELECT emoji, user_id FROM message_reactions WHERE message_id = ?').all(msg.id);
    const grouped = {};
    for (const r of reactionRows) {
      if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, me: false };
      grouped[r.emoji].count++;
      if (r.user_id === req.userId) grouped[r.emoji].me = true;
    }
    msg.reactions = grouped;
    return msg;
  });

  res.json(enriched);
});

// POST /api/users/messages/:messageId/pin — toggle pin message
router.post('/messages/:messageId/pin', auth, (req, res) => {
  const msgId = parseInt(req.params.messageId);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });

  // Pinner must be sender or receiver
  if (msg.sender_id !== req.userId && msg.receiver_id !== req.userId) {
    return res.status(403).json({ error: 'Нет доступа' });
  }

  const newState = msg.is_pinned ? 0 : 1;
  db.prepare('UPDATE messages SET is_pinned = ? WHERE id = ?').run(newState, msgId);

  // Notify both
  if (req.io) {
    [msg.sender_id, msg.receiver_id].forEach(uid => {
      if (req.onlineUsers?.has(uid)) {
        req.onlineUsers.get(uid).forEach(sid => req.io.to(sid).emit('message_updated', { messageId: msgId, is_pinned: newState }));
      }
    });
  }

  res.json({ success: true, is_pinned: newState });
});

// PATCH /api/users/messages/:messageId — edit message
router.patch('/messages/:messageId', auth, (req, res) => {
  const msgId = parseInt(req.params.messageId);
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Пустое сообщение' });
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
  if (msg.sender_id !== req.userId) return res.status(403).json({ error: 'Можно редактировать только свои сообщения' });
  if (isUsersBlocked(msg.sender_id, msg.receiver_id)) {
    return res.status(403).json({ error: 'Отправка сообщений недоступна из-за блокировки' });
  }
  const newContent = content.trim();
  db.prepare('UPDATE messages SET content = ?, edited = 1 WHERE id = ?').run(encryptMessageContent(newContent), msgId);
  res.json({ success: true, messageId: msgId, content: newContent, receiverId: msg.receiver_id });
});

// POST /api/users/messages/file — upload files for message
router.post('/messages/file', auth, (req, res) => {
  msgUpload.array('files', 5)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Файл слишком велик (технический лимит 500 МБ)' });
      }
      return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
    }
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Выберите файл' });

    const user = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(req.userId);
    const isPremium = user && user.premium_until && new Date(user.premium_until) > new Date();
    const nonImageMaxSize = isPremium ? 5000 * 1024 * 1024 : 1000 * 1024 * 1024;

    for (const f of req.files) {
      const isImage = String(f.mimetype || '').startsWith('image/');
      if (!isImage && f.size > nonImageMaxSize) {
        // delete all just uploaded
        for (const cf of req.files) fs.unlink(cf.path, () => {});
        return res.status(413).json({ 
          error: isPremium
            ? 'Максимальный размер файла (кроме фото) для Premium 50 МБ'
            : 'Максимальный размер файла (кроме фото) 10 МБ. Приобретите Premium для отправки до 50 МБ.',
          limitExceeded: true,
          maxAllowed: nonImageMaxSize
        });
      }
    }

    const filesData = req.files.map(f => ({
      url: `/uploads/${f.filename}`,
      name: f.originalname,
      type: f.mimetype,
      size: f.size
    }));
    
    // Fallback to array of URLs for backward compat on clients if any, 
    // but store raw JSON object array string in file_url
    res.json({ file_url: JSON.stringify(filesData), filesData });
  });
});

// POST /api/users/messages/:messageId/react — toggle reaction on DM
router.post('/messages/:messageId/react', auth, (req, res) => {
  const msgId = parseInt(req.params.messageId);
  const { emoji } = req.body;
  const allowed = ['❤️', '👍', '👎', '😂', '😮', '😢'];
  if (!allowed.includes(emoji)) return res.status(400).json({ error: 'Неизвестная реакция' });

  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
  if (msg.sender_id !== req.userId && msg.receiver_id !== req.userId) {
    return res.status(403).json({ error: 'Нет доступа' });
  }

  const existing = db.prepare('SELECT * FROM message_reactions WHERE message_id = ? AND user_id = ?').get(msgId, req.userId);
  if (existing) {
    if (existing.emoji === emoji) {
      db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
    } else {
      db.prepare('UPDATE message_reactions SET emoji = ? WHERE id = ?').run(emoji, existing.id);
    }
  } else {
    db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(msgId, req.userId, emoji);
  }

  // Get updated reactions for this message
  const reactions = db.prepare('SELECT emoji, user_id FROM message_reactions WHERE message_id = ?').all(msgId);
  const grouped = {};
  for (const r of reactions) {
    if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, me: false };
    grouped[r.emoji].count++;
    if (r.user_id === req.userId) grouped[r.emoji].me = true;
  }

  // Notify the other user via socket
  const otherId = msg.sender_id === req.userId ? msg.receiver_id : msg.sender_id;
  if (req.io && req.onlineUsers?.has(otherId)) {
    req.onlineUsers.get(otherId).forEach((sid) => {
      req.io.to(sid).emit('message_reaction', { messageId: msgId, reactions: grouped });
    });
  }
  // Also notify self (other tabs)
  if (req.io && req.onlineUsers?.has(req.userId)) {
    req.onlineUsers.get(req.userId).forEach((sid) => {
      req.io.to(sid).emit('message_reaction', { messageId: msgId, reactions: grouped });
    });
  }

  res.json({ reactions: grouped });
});

// DELETE /api/users/messages/:messageId
router.delete('/messages/:messageId', auth, (req, res) => {
  const msgId = parseInt(req.params.messageId);
  const { deleteForBoth, deleteForReceiver } = req.body || {};
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });

  const isSender = msg.sender_id === req.userId;
  const isReceiver = msg.receiver_id === req.userId;

  if (!isSender && !isReceiver) return res.status(403).json({ error: 'Нет доступа' });

  if (isReceiver && !isSender) {
    // Recipient deleting from their view only
    db.prepare('UPDATE messages SET deleted_for_receiver = 1 WHERE id = ?').run(msgId);
    return res.json({ success: true, deletedId: msgId, deleteForBoth: false });
  }

  // Sender deleting
  if (deleteForBoth) {
    db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);
  } else {
    db.prepare('UPDATE messages SET deleted_for_sender = 1 WHERE id = ?').run(msgId);
  }
  res.json({ success: true, deletedId: msgId, receiverId: msg.receiver_id, deleteForBoth: !!deleteForBoth });
});

// ─── Chat Wallpapers (premium) ───────────────────────────────────────────────

// Wallpaper upload
const wallpaperStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `wallpaper_${req.userId}_${Date.now()}${ext}`);
  },
});
const wallpaperUpload = multer({
  storage: wallpaperStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Только изображения (jpg, png, webp)'));
  },
});

// POST /api/users/wallpaper/:friendId — set wallpaper for chat
router.post('/wallpaper/:friendId', auth, (req, res) => {
  if (!isPremium(req.userId)) {
    return res.status(403).json({ error: 'Обои чата доступны только с mes-premium' });
  }
  const friendId = parseInt(req.params.friendId);
  wallpaperUpload.single('wallpaper')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
    if (!req.file) return res.status(400).json({ error: 'Выберите изображение' });

    // Delete old wallpaper file
    const old = db.prepare('SELECT wallpaper_url FROM chat_wallpapers WHERE user_id = ? AND friend_id = ?').get(req.userId, friendId);
    if (old?.wallpaper_url) {
      const oldPath = path.join(uploadDir, path.basename(old.wallpaper_url));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const wallpaperUrl = `/uploads/${req.file.filename}`;
    db.prepare(`INSERT INTO chat_wallpapers (user_id, friend_id, wallpaper_url) VALUES (?, ?, ?)
      ON CONFLICT(user_id, friend_id) DO UPDATE SET wallpaper_url = excluded.wallpaper_url`
    ).run(req.userId, friendId, wallpaperUrl);
    res.json({ wallpaper_url: wallpaperUrl });
  });
});

// GET /api/users/wallpaper/:friendId — get wallpaper for chat
router.get('/wallpaper/:friendId', auth, (req, res) => {
  const friendId = parseInt(req.params.friendId);
  const row = db.prepare('SELECT wallpaper_url FROM chat_wallpapers WHERE user_id = ? AND friend_id = ?').get(req.userId, friendId);
  res.json({ wallpaper_url: row?.wallpaper_url || null });
});

// DELETE /api/users/wallpaper/:friendId — remove wallpaper
router.delete('/wallpaper/:friendId', auth, (req, res) => {
  const friendId = parseInt(req.params.friendId);
  const old = db.prepare('SELECT wallpaper_url FROM chat_wallpapers WHERE user_id = ? AND friend_id = ?').get(req.userId, friendId);
  if (old?.wallpaper_url) {
    const oldPath = path.join(uploadDir, path.basename(old.wallpaper_url));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  db.prepare('DELETE FROM chat_wallpapers WHERE user_id = ? AND friend_id = ?').run(req.userId, friendId);
  res.json({ success: true });
});

// ─── Video Stories (premium) ─────────────────────────────────────────────────

const storyStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `story_${req.userId}_${Date.now()}${ext}`);
  },
});
const storyUpload = multer({
  storage: storyStorage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
  fileFilter: (req, file, cb) => {
    if (/^video\/(mp4|webm|quicktime)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Только видео (mp4, webm)'));
  },
});

// POST /api/users/stories — upload a story
router.post('/stories', auth, (req, res) => {
  if (!isPremium(req.userId)) {
    return res.status(403).json({ error: 'Видео-истории доступны только с mes-premium' });
  }
  storyUpload.single('video')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
    if (!req.file) return res.status(400).json({ error: 'Выберите видео' });
    const videoUrl = `/uploads/${req.file.filename}`;
    const result = db.prepare('INSERT INTO stories (user_id, video_url) VALUES (?, ?)').run(req.userId, videoUrl);
    res.json({ id: result.lastInsertRowid, video_url: videoUrl, created_at: new Date().toISOString() });
  });
});

// GET /api/users/stories/:userId — get stories for user
router.get('/stories/:userId', auth, (req, res) => {
  const userId = parseInt(req.params.userId);
  const stories = db.prepare('SELECT id, video_url, created_at FROM stories WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  res.json(stories);
});

// DELETE /api/users/stories/:storyId — delete own story
router.delete('/stories/:storyId', auth, (req, res) => {
  const storyId = parseInt(req.params.storyId);
  const story = db.prepare('SELECT * FROM stories WHERE id = ? AND user_id = ?').get(storyId, req.userId);
  if (!story) return res.status(404).json({ error: 'История не найдена' });
  // Delete file
  const filePath = path.join(uploadDir, path.basename(story.video_url));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM stories WHERE id = ?').run(storyId);
  res.json({ success: true });
});


// GET /api/users/sessions -> list active sessions
router.get('/sessions', auth, (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  const sessions = db.prepare('SELECT id, device_info, ip_address, last_active, created_at, (token = ?) as is_current FROM sessions WHERE user_id = ? ORDER BY last_active DESC').all(token, req.userId);
  res.json(sessions);
});

// DELETE /api/users/sessions/:id -> terminate session
router.delete('/sessions/:id', auth, (req, res) => {
  const sessionId = parseInt(req.params.id);
  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, req.userId);
  res.json({ success: true });
});

// POST /api/users/report -> create user report
router.post('/report', auth, (req, res) => {
  const { reported_id, reason, comment } = req.body;
  if (!reported_id || !reason) {
    return res.status(400).json({ error: 'Необходимо указать ID пользователя и причину(reason)' });
  }

  // Check if same user reported this user in last hour
  const lastHourReport = db.prepare(`
    SELECT id FROM reports 
    WHERE reporter_id = ? AND reported_id = ? 
    AND created_at >= datetime('now', '-1 hour')
  `).get(req.userId, reported_id);

  if (lastHourReport) {
    return res.status(429).json({ error: 'Вы уже отправляли жалобу на этого пользователя в течение последнего часа.' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO reports (reporter_id, reported_id, reason, comment)
      VALUES (?, ?, ?, ?)
    `).run(req.userId, reported_id, reason, comment || '');
    
    res.json({ success: true, report_id: result.lastInsertRowid });
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Ошибка при отправке жалобы' });
  }
});

 // POST /api/users/voice-circles/file — upload voice circle (video message, premium only)
 const voiceCircleStorage = multer.diskStorage({
   destination: (req, file, cb) => cb(null, uploadDir),
   filename: (req, file, cb) => {
     const ext = path.extname(file.originalname) || '.webm';
     cb(null, `voice_circle_${req.userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
   },
 });
 const voiceCircleUpload = multer({
   storage: voiceCircleStorage,
   limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
   fileFilter: (req, file, cb) => {
     // Accept video and audio formats
     const type = String(file.mimetype || '').toLowerCase();
     if (type.startsWith('video/') || type.startsWith('audio/')) cb(null, true);
     else cb(new Error('Только видео или аудио файлы'));
   },
 });

 router.post('/voice-circles/file', auth, (req, res) => {
   // Check premium status
   const user = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(req.userId);
   const hasVoiceCircles = user && user.premium_until && new Date(user.premium_until) > new Date();
   
   if (!hasVoiceCircles) {
     return res.status(403).json({ error: 'Голосовые кружки доступны только премиум пользователям' });
   }

   voiceCircleUpload.fields([{ name: 'voiceCircle', maxCount: 1 }, { name: 'file', maxCount: 1 }])(req, res, (err) => {
     if (err) {
       if (err.code === 'LIMIT_FILE_SIZE') {
         return res.status(413).json({ error: 'Видео слишком велико (макс. 50 МБ)' });
       }
       return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
     }

     const uploadedFile = req.files?.voiceCircle?.[0] || req.files?.file?.[0] || null;
     if (!uploadedFile) return res.status(400).json({ error: 'Выберите видеофайл' });
     
     const receiverId = req.body.receiverId ? parseInt(req.body.receiverId) : null;
     const channelId = req.body.channelId ? parseInt(req.body.channelId) : null;
     const duration = req.body.duration ? parseFloat(req.body.duration) : 0;
     
     if (!receiverId && !channelId) {
       fs.unlink(uploadedFile.path, () => {});
       return res.status(400).json({ error: 'Укажите получателя или канал' });
     }
     
     try {
       const result = db.prepare(`
         INSERT INTO voice_circles (sender_id, receiver_id, channel_id, file_url, duration)
         VALUES (?, ?, ?, ?, ?)
       `).run(req.userId, receiverId, channelId, `/uploads/${uploadedFile.filename}`, duration);
       
       res.json({
         id: result.lastInsertRowid,
         file_url: `/uploads/${uploadedFile.filename}`,
         duration,
         created_at: new Date().toISOString(),
       });
     } catch (err) {
       fs.unlink(uploadedFile.path, () => {});
       console.error('Voice circle insert error:', err);
       res.status(500).json({ error: 'Ошибка сохранения' });
     }
   });
 });

 // GET /api/users/messages/:friendId/voice-circles — get voice circles in a chat
 router.get('/messages/:friendId/voice-circles', auth, (req, res) => {
   const friendId = parseInt(req.params.friendId);
   
   try {
     const circles = db.prepare(`
       SELECT * FROM voice_circles
       WHERE (
         (sender_id = ? AND receiver_id = ?) OR
         (sender_id = ? AND receiver_id = ?)
       )
       ORDER BY created_at DESC
       LIMIT 100
     `).all(req.userId, friendId, friendId, req.userId);
     
     res.json(circles || []);
   } catch (err) {
     console.error('Get voice circles error:', err);
     res.status(500).json({ error: 'Ошибка получения кружков' });
   }
 });

module.exports = { router, auth };


