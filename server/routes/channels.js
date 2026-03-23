const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../database');
const { encryptMessageContent, decryptMessageContent } = require('../messageCrypto');
const { auth } = require('./users');

const router = express.Router();

function getChannelById(channelId) {
  return db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
}

function requireChannelOwner(req, res, next) {
  const chId = parseInt(req.params.id);
  const ch = getChannelById(chId);
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });
  if (ch.owner_id !== req.userId) return res.status(403).json({ error: 'Только владелец' });
  req.channel = ch;
  req.channelId = chId;
  next();
}

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
  limits: { fileSize: 500 * 1024 * 1024 }, // technical safety cap
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
      cm.notifications_enabled,
      cm.last_read_at,
      (
        SELECT COUNT(*)
        FROM channel_messages cmu
        WHERE cmu.channel_id = c.id
          AND cmu.sender_id != ?
          AND (cm.last_read_at IS NULL OR cmu.created_at > cm.last_read_at)
      ) as unread_count,
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
  `).all(req.userId, req.userId);

  channels.forEach((channel) => {
    channel.last_message = decryptMessageContent(channel.last_message);
  });

  res.json(channels);
});

// GET /api/channels/:id — get channel info
router.get('/:id', auth, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(parseInt(req.params.id));
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });

  const memberCount = db.prepare('SELECT COUNT(*) as cnt FROM channel_members WHERE channel_id = ?').get(ch.id).cnt;
  const memberRow = db.prepare('SELECT id, notifications_enabled FROM channel_members WHERE channel_id = ? AND user_id = ?').get(ch.id, req.userId);
  const isMember = !!memberRow;

  res.json({ ...ch, member_count: memberCount, is_member: isMember, notifications_enabled: memberRow?.notifications_enabled ?? 1 });
});

// POST /api/channels/:id/read — mark channel as read for current user
router.post('/:id/read', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const member = db.prepare('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?').get(chId, req.userId);
  if (!member) return res.status(403).json({ error: 'Вы не участник канала' });

  const now = new Date().toISOString();
  db.prepare('UPDATE channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?').run(now, chId, req.userId);
  res.json({ success: true, read_at: now });
});

// GET /api/channels/:id/notification — get notification setting for current user
router.get('/:id/notification', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const member = db.prepare('SELECT notifications_enabled FROM channel_members WHERE channel_id = ? AND user_id = ?').get(chId, req.userId);
  if (!member) return res.status(403).json({ error: 'Вы не участник канала' });
  res.json({ notifications_enabled: member.notifications_enabled ? 1 : 0 });
});

// PATCH /api/channels/:id/notification — set notification setting for current user
router.patch('/:id/notification', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const member = db.prepare('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?').get(chId, req.userId);
  if (!member) return res.status(403).json({ error: 'Вы не участник канала' });

  const enabled = req.body?.enabled ? 1 : 0;
  db.prepare('UPDATE channel_members SET notifications_enabled = ? WHERE channel_id = ? AND user_id = ?').run(enabled, chId, req.userId);
  res.json({ success: true, notifications_enabled: enabled });
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

  const activeBan = db.prepare('SELECT id FROM channel_bans WHERE channel_id = ? AND user_id = ? AND active = 1 LIMIT 1').get(ch.id, req.userId);
  if (activeBan) return res.status(403).json({ error: 'Вы заблокированы в этом канале' });

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

// GET /api/channels/:id/subscribers — owner-only list subscribers
router.get('/:id/subscribers', auth, requireChannelOwner, (req, res) => {
  const subscribers = db.prepare(`
    SELECT u.id, u.username, u.public_id, u.avatar, cm.joined_at,
           CASE WHEN c.owner_id = u.id THEN 1 ELSE 0 END as is_owner
    FROM channel_members cm
    JOIN users u ON u.id = cm.user_id
    JOIN channels c ON c.id = cm.channel_id
    WHERE cm.channel_id = ?
    ORDER BY is_owner DESC, cm.joined_at ASC
  `).all(req.channelId);

  res.json(subscribers);
});

// GET /api/channels/:id/bans — owner-only list active bans
router.get('/:id/bans', auth, requireChannelOwner, (req, res) => {
  const bans = db.prepare(`
    SELECT cb.id, cb.channel_id, cb.user_id, cb.reason, cb.active, cb.banned_at, cb.unbanned_at,
           u.username, u.public_id, u.avatar,
           b.username as banned_by_username
    FROM channel_bans cb
    JOIN users u ON u.id = cb.user_id
    LEFT JOIN users b ON b.id = cb.banned_by
    WHERE cb.channel_id = ? AND cb.active = 1
    ORDER BY cb.banned_at DESC
  `).all(req.channelId);

  res.json(bans);
});

// POST /api/channels/:id/subscribers/:userId/ban — owner-only permanent ban
router.post('/:id/subscribers/:userId/ban', auth, requireChannelOwner, (req, res) => {
  const targetUserId = parseInt(req.params.userId);
  const reason = String(req.body?.reason || '').trim();

  if (!targetUserId) return res.status(400).json({ error: 'Некорректный userId' });
  if (targetUserId === req.userId) return res.status(400).json({ error: 'Нельзя заблокировать владельца канала' });

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

  db.prepare('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?').run(req.channelId, targetUserId);

  const existing = db.prepare('SELECT id FROM channel_bans WHERE channel_id = ? AND user_id = ?').get(req.channelId, targetUserId);
  if (existing) {
    db.prepare(`
      UPDATE channel_bans
      SET active = 1,
          banned_by = ?,
          reason = ?,
          banned_at = CURRENT_TIMESTAMP,
          unbanned_at = NULL
      WHERE id = ?
    `).run(req.userId, reason || 'Заблокирован владельцем канала', existing.id);
  } else {
    db.prepare(`
      INSERT INTO channel_bans (channel_id, user_id, banned_by, reason, active)
      VALUES (?, ?, ?, ?, 1)
    `).run(req.channelId, targetUserId, req.userId, reason || 'Заблокирован владельцем канала');
  }

  res.json({ success: true });
});

// POST /api/channels/:id/subscribers/:userId/unban — owner-only remove channel ban
router.post('/:id/subscribers/:userId/unban', auth, requireChannelOwner, (req, res) => {
  const targetUserId = parseInt(req.params.userId);
  if (!targetUserId) return res.status(400).json({ error: 'Некорректный userId' });

  const activeBan = db.prepare('SELECT id FROM channel_bans WHERE channel_id = ? AND user_id = ? AND active = 1').get(req.channelId, targetUserId);
  if (!activeBan) return res.status(404).json({ error: 'Активный бан не найден' });

  db.prepare('UPDATE channel_bans SET active = 0, unbanned_at = CURRENT_TIMESTAMP WHERE id = ?').run(activeBan.id);
  res.json({ success: true });
});

// GET /api/channels/:id/messages — get channel messages
router.get('/:id/messages', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const messages = db.prepare(`
    SELECT cm.id, cm.channel_id, cm.sender_id, cm.content, cm.file_url, cm.created_at, cm.edited, cm.is_pinned,
           u.username as sender_username,
           (SELECT COUNT(*) FROM channel_post_comments cpc WHERE cpc.message_id = cm.id) as comment_count
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

  messages.forEach((m) => {
    m.content = decryptMessageContent(m.content);
  });

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
  const encryptedContent = encryptMessageContent(trimContent);
  const storedFileUrl = file_urls && file_urls.length > 0 ? JSON.stringify(file_urls) : file_url || null;
  if (!trimContent && !storedFileUrl) return res.status(400).json({ error: 'Пустое сообщение' });

  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO channel_messages (channel_id, sender_id, content, file_url, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(chId, req.userId, encryptedContent, storedFileUrl, now);

  const sender = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);

  const message = {
    id: result.lastInsertRowid,
    channel_id: chId,
    sender_id: req.userId,
    content: trimContent,
    file_url: storedFileUrl,
    created_at: now,
    comment_count: 0,
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
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Файл слишком велик (технический лимит 500 МБ)' });
      return res.status(400).json({ error: err.message });
    }
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Выберите файл' });

    const user = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(req.userId);
    const isPremium = user && user.premium_until && new Date(user.premium_until) > new Date();
    const nonImageMaxSize = isPremium ? 50 * 1024 * 1024 : 10 * 1024 * 1024;

    for (const f of req.files) {
      const isImage = String(f.mimetype || '').startsWith('image/');
      if (!isImage && f.size > nonImageMaxSize) {
        for (const cf of req.files) fs.unlink(cf.path, () => {});
        return res.status(413).json({ 
          error: isPremium
            ? 'Максимальный размер файла (кроме фото) для Premium 50 МБ'
            : 'Максимальный размер файла (кроме фото) 10 МБ. Приобретите Premium для отправки до 50 МБ.'
        });
      }
    }

    const filesData = req.files.map(f => ({
      url: `/uploads/${f.filename}`,
      name: f.originalname,
      type: f.mimetype,
      size: f.size
    }));
    res.json({ file_url: JSON.stringify(filesData), file_urls: filesData });
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

// POST /api/channels/:id/messages/:msgId/pin — pin/unpin channel message
router.post('/:id/messages/:msgId/pin', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const msgId = parseInt(req.params.msgId);
  const ch = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(chId);
  // Optional: check if they are the owner or admin
  const action = req.body.action || 'pin'; // 'pin' or 'unpin'
  const isPinned = action === 'pin' ? 1 : 0;
  log(`[Channels] Setting pin=${isPinned} for msgId=${msgId} in chl ${chId}`);

  const stmt = db.prepare('UPDATE channel_messages SET is_pinned = ? WHERE id = ? AND channel_id = ?');
  const info = stmt.run(isPinned, msgId, chId);
  
  if (info.changes > 0) {
    const updated = db.prepare(`
      SELECT 
        cm.*, 
        u.username, u.avatar_url,
        (SELECT COUNT(*) FROM channel_message_reactions cmr WHERE cmr.message_id = cm.id) as reactionCount,
        (SELECT GROUP_CONCAT(user_id) FROM channel_message_reactions cmr WHERE cmr.message_id = cm.id) as reactedUsers
      FROM channel_messages cm
      JOIN users u ON cm.user_id = u.id
      WHERE cm.id = ?
    `).get(msgId);
    
    // Broadcast
    const members = db.prepare('SELECT user_id FROM channel_members WHERE channel_id = ?').all(chId);
    members.forEach(({ user_id }) => {
      if (req.onlineUsers.has(user_id)) {
        req.onlineUsers.get(user_id).forEach((sid) => {
          req.io.to(sid).emit('channel_message_updated', updated);
        });
      }
    });
    res.json({ success: true, message: updated });
  } else {
    res.status(404).json({ error: 'Message not found' });
  }
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

  db.prepare('UPDATE channel_messages SET content = ?, edited = 1 WHERE id = ?').run(encryptMessageContent(content.trim()), msgId);

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

// GET /api/channels/:id/messages/:msgId/comments — post + comments
router.get('/:id/messages/:msgId/comments', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const msgId = parseInt(req.params.msgId);

  const member = db.prepare('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?').get(chId, req.userId);
  if (!member) return res.status(403).json({ error: 'Вы не участник канала' });

  const post = db.prepare(`
    SELECT cm.id, cm.channel_id, cm.sender_id, cm.content, cm.file_url, cm.created_at, cm.edited, cm.is_pinned,
           u.username as sender_username
    FROM channel_messages cm
    JOIN users u ON u.id = cm.sender_id
    WHERE cm.id = ? AND cm.channel_id = ?
  `).get(msgId, chId);

  if (!post) return res.status(404).json({ error: 'Пост не найден' });
  post.content = decryptMessageContent(post.content);

  const comments = db.prepare(`
    SELECT c.id, c.channel_id, c.message_id, c.user_id, c.content, c.created_at,
           u.username, u.public_id, u.avatar
    FROM channel_post_comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.channel_id = ? AND c.message_id = ?
    ORDER BY c.created_at ASC
  `).all(chId, msgId);

  comments.forEach((comment) => {
    comment.content = decryptMessageContent(comment.content);
  });

  res.json({ post, comments });
});

// POST /api/channels/:id/messages/:msgId/comments — create comment
router.post('/:id/messages/:msgId/comments', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const msgId = parseInt(req.params.msgId);
  const content = String(req.body?.content || '').trim();

  if (!content) return res.status(400).json({ error: 'Комментарий пустой' });

  const member = db.prepare('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?').get(chId, req.userId);
  if (!member) return res.status(403).json({ error: 'Вы не участник канала' });

  const post = db.prepare('SELECT id FROM channel_messages WHERE id = ? AND channel_id = ?').get(msgId, chId);
  if (!post) return res.status(404).json({ error: 'Пост не найден' });

  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO channel_post_comments (channel_id, message_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(chId, msgId, req.userId, encryptMessageContent(content), now);

  const user = db.prepare('SELECT username, public_id, avatar FROM users WHERE id = ?').get(req.userId);
  const comment = {
    id: result.lastInsertRowid,
    channel_id: chId,
    message_id: msgId,
    user_id: req.userId,
    content,
    created_at: now,
    username: user?.username,
    public_id: user?.public_id,
    avatar: user?.avatar,
  };

  if (req.io && req.onlineUsers) {
    const members = db.prepare('SELECT user_id FROM channel_members WHERE channel_id = ?').all(chId);
    members.forEach(({ user_id }) => {
      if (!req.onlineUsers.has(user_id)) return;
      req.onlineUsers.get(user_id).forEach((sid) => {
        req.io.to(sid).emit('channel_post_comment', comment);
      });
    });
  }

  res.json(comment);
});

// Voice circle upload for channels (premium only)
const voiceCircleStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    const type = String(file.mimetype || '').toLowerCase();
    const kind = type.startsWith('audio/') ? 'ch_audio_circle' : 'ch_video_circle';
    cb(null, `${kind}_${req.userId}_${Date.now()}${ext}`);
  },
});
const voiceCircleUpload = multer({
  storage: voiceCircleStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const type = String(file.mimetype || '').toLowerCase();
    if (type.startsWith('video/') || type.startsWith('audio/')) cb(null, true);
    else cb(new Error('Только видео или аудио файлы'));
  },
});

// POST /api/channels/:id/voice-circles/file — upload voice circle to channel
router.post('/:id/voice-circles/file', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const ch = getChannelById(chId);
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });
  
  // Check if user is a member
  const isMember = db.prepare('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?')
    .get(chId, req.userId);
  if (!isMember) return res.status(403).json({ error: 'Вы не являетесь членом этого канала' });
  
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
    
    const duration = req.body.duration ? parseFloat(req.body.duration) : 0;
    
    try {
      const result = db.prepare(`
        INSERT INTO voice_circles (sender_id, channel_id, file_url, duration)
        VALUES (?, ?, ?, ?)
      `).run(req.userId, chId, `/uploads/${uploadedFile.filename}`, duration);
      
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

// GET /api/channels/:id/voice-circles — get voice circles in a channel
router.get('/:id/voice-circles', auth, (req, res) => {
  const chId = parseInt(req.params.id);
  const ch = getChannelById(chId);
  if (!ch) return res.status(404).json({ error: 'Канал не найден' });
  
  // Check if user is a member
  const isMember = db.prepare('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?')
    .get(chId, req.userId);
  if (!isMember) return res.status(403).json({ error: 'Вы не являетесь членом этого канала' });
  
  try {
    const circles = db.prepare(`
      SELECT * FROM voice_circles
      WHERE channel_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(chId);
    
    res.json(circles || []);
  } catch (err) {
    console.error('Get voice circles error:', err);
    res.status(500).json({ error: 'Ошибка получения кружков' });
  }
});

module.exports = router;
