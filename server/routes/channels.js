const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../database');
const { auth } = require('./users');

const router = express.Router();

// Channel avatar upload
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `ch_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Только изображения'));
  },
});

// Message image upload for channels
const msgStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `chmsg_${req.userId}_${Date.now()}${ext}`);
  },
});
const msgUpload = multer({
  storage: msgStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Только изображения'));
  },
});

// POST /api/channels — create channel
router.post('/', auth, (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Название обязательно' });
  if (name.trim().length > 50) return res.status(400).json({ error: 'Максимум 50 символов' });

  const inviteCode = crypto.randomBytes(6).toString('hex');
  const result = db.prepare(
    'INSERT INTO channels (name, description, owner_id, invite_code) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), (description || '').trim(), req.userId, inviteCode);

  const channelId = result.lastInsertRowid;

  // Owner auto-joins
  db.prepare('INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)').run(channelId, req.userId);

  res.json({
    id: channelId,
    name: name.trim(),
    description: (description || '').trim(),
    avatar: null,
    owner_id: req.userId,
    invite_code: inviteCode,
  });
});

// POST /api/channels/:id/avatar — upload channel avatar
router.post('/:id/avatar', auth, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(parseInt(req.params.id));
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });
  if (ch.owner_id !== req.userId) return res.status(403).json({ error: 'Только владелец' });

  upload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Выберите изображение' });

    // Delete old
    if (ch.avatar) {
      const oldPath = path.join(uploadDir, path.basename(ch.avatar));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const avatarUrl = `/uploads/${req.file.filename}`;
    db.prepare('UPDATE channels SET avatar = ? WHERE id = ?').run(avatarUrl, ch.id);
    res.json({ avatar: avatarUrl });
  });
});

// GET /api/channels/my — list channels I'm a member of
router.get('/my', auth, (req, res) => {
  const channels = db.prepare(`
    SELECT c.id, c.name, c.description, c.avatar, c.owner_id, c.invite_code, c.created_at,
      lm.content as last_message,
      lm.file_url as last_message_file,
      lm.created_at as last_message_at
    FROM channels c
    JOIN channel_members cm ON cm.channel_id = c.id
    LEFT JOIN channel_messages lm ON lm.id = (
      SELECT cm2.id FROM channel_messages cm2
      WHERE cm2.channel_id = c.id
      ORDER BY cm2.created_at DESC LIMIT 1
    )
    WHERE cm.user_id = ?
    ORDER BY COALESCE(lm.created_at, c.created_at) DESC
  `).all(req.userId);
  res.json(channels);
});

// GET /api/channels/:id — get channel info
router.get('/:id', auth, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(parseInt(req.params.id));
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });

  const memberCount = db.prepare('SELECT COUNT(*) as cnt FROM channel_members WHERE channel_id = ?').get(ch.id).cnt;
  const isMember = !!db.prepare('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?').get(ch.id, req.userId);

  res.json({ ...ch, member_count: memberCount, is_member: isMember });
});

// GET /api/channels/invite/:code — get channel by invite code
router.get('/invite/:code', auth, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE invite_code = ?').get(req.params.code);
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });

  const memberCount = db.prepare('SELECT COUNT(*) as cnt FROM channel_members WHERE channel_id = ?').get(ch.id).cnt;
  const isMember = !!db.prepare('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?').get(ch.id, req.userId);

  res.json({ ...ch, member_count: memberCount, is_member: isMember });
});

// POST /api/channels/:id/join — join channel
router.post('/:id/join', auth, (req, res) => {
  const ch = db.prepare('SELECT id FROM channels WHERE id = ?').get(parseInt(req.params.id));
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });

  const already = db.prepare('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?').get(ch.id, req.userId);
  if (already) return res.json({ success: true, already: true });

  db.prepare('INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)').run(ch.id, req.userId);
  res.json({ success: true });
});

// POST /api/channels/:id/leave — leave channel
router.post('/:id/leave', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const ch = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(chId);
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });
  if (ch.owner_id === req.userId) return res.status(400).json({ error: 'Владелец не может отписаться' });

  db.prepare('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?').run(chId, req.userId);
  res.json({ success: true });
});

// PATCH /api/channels/:id — update description
router.patch('/:id', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(chId);
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });
  if (ch.owner_id !== req.userId) return res.status(403).json({ error: 'Только владелец' });

  const { description } = req.body;
  if (description !== undefined) {
    db.prepare('UPDATE channels SET description = ? WHERE id = ?').run(description.trim(), chId);
  }
  res.json({ success: true });
});

// GET /api/channels/:id/messages — get channel messages
router.get('/:id/messages', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const messages = db.prepare(`
    SELECT cm.id, cm.channel_id, cm.sender_id, cm.content, cm.file_url, cm.created_at, cm.edited,
           u.username as sender_username
    FROM channel_messages cm
    JOIN users u ON cm.sender_id = u.id
    WHERE cm.channel_id = ?
    ORDER BY cm.created_at ASC
    LIMIT 500
  `).all(chId);

  // Attach reactions to each message
  const msgIds = messages.map(m => m.id);
  if (msgIds.length > 0) {
    const allReactions = db.prepare(
      `SELECT message_id, emoji, COUNT(*) as count FROM channel_reactions WHERE message_id IN (${msgIds.join(',')}) GROUP BY message_id, emoji`
    ).all();
    const myReactions = db.prepare(
      `SELECT message_id, emoji FROM channel_reactions WHERE message_id IN (${msgIds.join(',')}) AND user_id = ?`
    ).all(req.userId);
    const reactMap = {};
    allReactions.forEach(r => {
      if (!reactMap[r.message_id]) reactMap[r.message_id] = {};
      reactMap[r.message_id][r.emoji] = { count: r.count, me: false };
    });
    myReactions.forEach(r => {
      if (reactMap[r.message_id]?.[r.emoji]) reactMap[r.message_id][r.emoji].me = true;
    });
    messages.forEach(m => {
      m.reactions = reactMap[m.id] || {};
    });
  } else {
    messages.forEach(m => { m.reactions = {}; });
  }

  res.json(messages);
});

// POST /api/channels/:id/messages — post message (owner only)
router.post('/:id/messages', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const ch = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(chId);
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });
  if (ch.owner_id !== req.userId) return res.status(403).json({ error: 'Только владелец может писать' });

  const { content, file_url, file_urls } = req.body;
  const trimContent = (content || '').trim();
  const storedFileUrl = file_urls && file_urls.length > 0 ? JSON.stringify(file_urls) : file_url || null;
  if (!trimContent && !storedFileUrl) return res.status(400).json({ error: 'Пустое сообщение' });

  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO channel_messages (channel_id, sender_id, content, file_url, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(chId, req.userId, trimContent, storedFileUrl, now);

  const sender = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);

  const message = {
    id: result.lastInsertRowid,
    channel_id: chId,
    sender_id: req.userId,
    content: trimContent,
    file_url: storedFileUrl,
    created_at: now,
    sender_username: sender?.username,
  };

  // Broadcast to all online channel members
  const members = db.prepare('SELECT user_id FROM channel_members WHERE channel_id = ?').all(chId);
  if (req.io && req.onlineUsers) {
    members.forEach(({ user_id }) => {
      if (req.onlineUsers.has(user_id)) {
        req.onlineUsers.get(user_id).forEach((sid) => {
          req.io.to(sid).emit('channel_message', message);
        });
      }
    });
  }

  res.json(message);
});

// POST /api/channels/:id/messages/file — upload images for channel message (up to 5)
router.post('/:id/messages/file', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const ch = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(chId);
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });
  if (ch.owner_id !== req.userId) return res.status(403).json({ error: 'Только владелец' });

  msgUpload.array('files', 5)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Выберите изображение' });
    const urls = req.files.map(f => `/uploads/${f.filename}`);
    res.json({ file_urls: urls });
  });
});

// DELETE /api/channels/:id/messages/:msgId — delete channel message (owner only)
router.delete('/:id/messages/:msgId', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const msgId = parseInt(req.params.msgId);
  const ch = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(chId);
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });
  if (ch.owner_id !== req.userId) return res.status(403).json({ error: 'Только владелец' });

  const msg = db.prepare('SELECT * FROM channel_messages WHERE id = ? AND channel_id = ?').get(msgId, chId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });

  db.prepare('DELETE FROM channel_reactions WHERE message_id = ?').run(msgId);
  db.prepare('DELETE FROM channel_messages WHERE id = ?').run(msgId);

  // Broadcast deletion to all online members
  const members = db.prepare('SELECT user_id FROM channel_members WHERE channel_id = ?').all(chId);
  if (req.io && req.onlineUsers) {
    members.forEach(({ user_id }) => {
      if (req.onlineUsers.has(user_id)) {
        req.onlineUsers.get(user_id).forEach((sid) => {
          req.io.to(sid).emit('channel_message_deleted', { channel_id: chId, messageId: msgId });
        });
      }
    });
  }

  res.json({ success: true });
});

// PATCH /api/channels/:id/messages/:msgId — edit channel message (owner only)
router.patch('/:id/messages/:msgId', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const msgId = parseInt(req.params.msgId);
  const ch = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(chId);
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });
  if (ch.owner_id !== req.userId) return res.status(403).json({ error: 'Только владелец' });

  const msg = db.prepare('SELECT * FROM channel_messages WHERE id = ? AND channel_id = ?').get(msgId, chId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });

  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Пустое сообщение' });

  db.prepare('UPDATE channel_messages SET content = ?, edited = 1 WHERE id = ?').run(content.trim(), msgId);

  // Broadcast edit to online members
  const members = db.prepare('SELECT user_id FROM channel_members WHERE channel_id = ?').all(chId);
  if (req.io && req.onlineUsers) {
    members.forEach(({ user_id }) => {
      if (req.onlineUsers.has(user_id)) {
        req.onlineUsers.get(user_id).forEach((sid) => {
          req.io.to(sid).emit('channel_message_edited', { channel_id: chId, messageId: msgId, content: content.trim() });
        });
      }
    });
  }

  res.json({ success: true });
});

// POST /api/channels/:id/messages/:msgId/react — toggle reaction
router.post('/:id/messages/:msgId/react', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const msgId = parseInt(req.params.msgId);
  const { emoji } = req.body;
  const ALLOWED = ['❤️', '👍', '👎'];
  if (!ALLOWED.includes(emoji)) return res.status(400).json({ error: 'Недопустимая реакция' });

  // Check membership
  const member = db.prepare('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?').get(chId, req.userId);
  if (!member) return res.status(403).json({ error: 'Вы не участник канала' });

  const existing = db.prepare('SELECT id, emoji as existingEmoji FROM channel_reactions WHERE message_id = ? AND user_id = ?').get(msgId, req.userId);

  if (existing) {
    if (existing.existingEmoji === emoji) {
      // Remove reaction (toggle off)
      db.prepare('DELETE FROM channel_reactions WHERE id = ?').run(existing.id);
    } else {
      // Switch emoji
      db.prepare('UPDATE channel_reactions SET emoji = ? WHERE id = ?').run(emoji, existing.id);
    }
  } else {
    db.prepare('INSERT INTO channel_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(msgId, req.userId, emoji);
  }

  // Return updated reactions for this message
  const reactions = db.prepare('SELECT emoji, COUNT(*) as count FROM channel_reactions WHERE message_id = ? GROUP BY emoji').all(msgId);
  const myReaction = db.prepare('SELECT emoji FROM channel_reactions WHERE message_id = ? AND user_id = ?').get(msgId, req.userId);
  const result = {};
  reactions.forEach(r => {
    result[r.emoji] = { count: r.count, me: myReaction?.emoji === r.emoji };
  });

  res.json({ reactions: result });
});

module.exports = router;
