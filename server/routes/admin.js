const express = require('express');
const db = require('../database');
const { auth } = require('./users');

const router = express.Router();

// Middleware: require admin
function requireAdmin(req, res, next) {
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.userId);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  next();
}

// GET /api/admin/check — check if current user is admin
router.get('/check', auth, (req, res) => {
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.userId);
  res.json({ isAdmin: !!(user && user.is_admin) });
});

// GET /api/admin/users — list all users
router.get('/users', auth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.public_id, u.email, u.avatar, u.created_at, u.last_seen, u.is_admin, u.premium_until,
      (SELECT COUNT(*) FROM messages WHERE sender_id = u.id) as message_count,
      (SELECT b.id FROM bans b WHERE b.user_id = u.id AND b.active = 1 LIMIT 1) as active_ban_id
    FROM users u
    ORDER BY u.id ASC
  `).all();
  res.json(users);
});

// GET /api/admin/users/:userId/messages — all messages by user (including deleted)
router.get('/users/:userId/messages', auth, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.userId);
  const messages = db.prepare(`
    SELECT m.id, m.sender_id, m.receiver_id, m.content, m.file_url, m.created_at,
           m.edited, m.deleted_for_sender, m.deleted_for_receiver,
           s.username as sender_username, s.public_id as sender_public_id,
           r.username as receiver_username, r.public_id as receiver_public_id
    FROM messages m
    JOIN users s ON m.sender_id = s.id
    JOIN users r ON m.receiver_id = r.id
    WHERE m.sender_id = ?
    ORDER BY m.created_at DESC
    LIMIT 500
  `).all(userId);
  res.json(messages);
});

// POST /api/admin/ban — ban a user
router.post('/ban', auth, requireAdmin, (req, res) => {
  const { user_id, reason, duration_hours } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id обязателен' });

  // Can't ban another admin
  const target = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user_id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.is_admin) return res.status(400).json({ error: 'Нельзя забанить администратора' });

  // Deactivate old bans
  db.prepare('UPDATE bans SET active = 0 WHERE user_id = ? AND active = 1').run(user_id);

  const expiresAt = duration_hours
    ? new Date(Date.now() + duration_hours * 3600000).toISOString()
    : null; // null = permanent

  db.prepare(
    'INSERT INTO bans (user_id, reason, expires_at, banned_by) VALUES (?, ?, ?, ?)'
  ).run(user_id, reason || 'Нарушение правил', expiresAt, req.userId);

  // Kick user in real-time if online
  if (req.io && req.onlineUsers?.has(user_id)) {
    req.onlineUsers.get(user_id).forEach((sid) => {
      req.io.to(sid).emit('you_are_banned', {
        reason: reason || 'Нарушение правил',
        expires_at: expiresAt,
      });
    });
  }

  res.json({ success: true });
});

// POST /api/admin/unban — unban a user
router.post('/unban', auth, requireAdmin, (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id обязателен' });
  db.prepare('UPDATE bans SET active = 0 WHERE user_id = ? AND active = 1').run(user_id);
  res.json({ success: true });
});

// GET /api/admin/bans/:userId — get ban history for user
router.get('/bans/:userId', auth, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.userId);
  const bans = db.prepare(`
    SELECT b.*, a.username as banned_by_name
    FROM bans b
    LEFT JOIN users a ON b.banned_by = a.id
    WHERE b.user_id = ?
    ORDER BY b.banned_at DESC
  `).all(userId);
  res.json(bans);
});

// POST /api/admin/premium/grant — grant premium for N months
router.post('/premium/grant', auth, requireAdmin, (req, res) => {
  const { user_id, months } = req.body;
  if (!user_id || !months || months < 1) return res.status(400).json({ error: 'user_id и months обязательны' });
  const target = db.prepare('SELECT id, premium_until FROM users WHERE id = ?').get(user_id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  // If already premium, extend from current end date; otherwise from now
  const baseDate = target.premium_until && new Date(target.premium_until) > new Date() ? new Date(target.premium_until) : new Date();
  const newDate = new Date(baseDate);
  newDate.setMonth(newDate.getMonth() + parseInt(months));
  const premiumUntil = newDate.toISOString();
  db.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(premiumUntil, user_id);
  res.json({ success: true, premium_until: premiumUntil });
});

// POST /api/admin/premium/revoke — revoke premium
router.post('/premium/revoke', auth, requireAdmin, (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id обязателен' });
  db.prepare('UPDATE users SET premium_until = NULL WHERE id = ?').run(user_id);
  res.json({ success: true });
});

module.exports = router;
